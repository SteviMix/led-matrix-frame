// Slideshow mode: advances through the active playlist's images on a timer,
// sending each one's processed .rgb file to the renderer unchanged.
//
// Implements the mode-manager interface (start/stop/getState) plus next()
// and previous() for manual navigation, which mode-manager exposes via
// getCurrentInstance() when this mode is active.

const fs = require("fs");

const FRAME_BYTES = 128 * 128 * 3;
const DEFAULT_INTERVAL_SECONDS = 10;

function createSlideshowMode({ db, rendererClient }) {
  let timer = null;
  // Index of the image currently on the panel, or null if none has been shown
  // yet. Every path (timer tick, next, previous) moves it first, then shows
  // the image at the new index - it never means "the one to show next".
  let currentIndex = null;
  let warnedEmptyPlaylist = false;

  function getActivePlaylistId() {
    const row = db.prepare("SELECT value FROM app_state WHERE key = 'active_playlist'").get();
    const value = row ? row.value : "";
    return value === "" ? null : Number(value);
  }

  function getIntervalMs() {
    const row = db
      .prepare("SELECT value FROM app_state WHERE key = 'slideshow_interval_seconds'")
      .get();
    const seconds = row ? Number(row.value) : DEFAULT_INTERVAL_SECONDS;
    return (Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_INTERVAL_SECONDS) * 1000;
  }

  function getPlaylistImages() {
    const playlistId = getActivePlaylistId();
    if (playlistId === null) return [];
    // images.playlist_id no longer exists (many-to-many via playlist_images
    // now) - order is per-playlist, so it must come from the join table's
    // sort_order, not any column on images itself.
    return db
      .prepare(
        `SELECT i.*
         FROM images i
         JOIN playlist_images pi ON pi.image_id = i.id
         WHERE pi.playlist_id = ?
         ORDER BY pi.sort_order, i.id`
      )
      .all(playlistId);
  }

  // Reads the image's processed file and forwards the bytes unchanged - no
  // transformation happens in Node. Any failure here is logged and skipped,
  // never thrown, since this runs off a timer with no caller to report to.
  function sendImage(image) {
    if (!image.processed_path) {
      console.log(`[slideshow] Image ${image.id} has no processed_path yet, skipping.`);
      return;
    }

    let frame;
    try {
      frame = fs.readFileSync(image.processed_path);
    } catch (err) {
      console.log(`[slideshow] Could not read ${image.processed_path}: ${err.message}`);
      return;
    }

    if (frame.length !== FRAME_BYTES) {
      console.log(
        `[slideshow] Skipping image ${image.id}: wrong size (${frame.length} bytes, expected ${FRAME_BYTES})`
      );
      return;
    }

    if (!rendererClient.isConnected()) {
      console.log("[slideshow] Renderer not connected, skipping this tick.");
      return;
    }

    rendererClient.sendFrame(frame);
  }

  function scheduleNext() {
    timer = setTimeout(tick, getIntervalMs());
  }

  // Moves currentIndex by `delta` (wrapping in both directions) and shows the
  // image there. The first step after start always lands on image 0. The
  // double modulo keeps the result in range for negative deltas and for a
  // playlist that shrank since the last step.
  function step(images, delta) {
    const n = images.length;
    currentIndex = currentIndex === null ? 0 : (((currentIndex + delta) % n) + n) % n;
    sendImage(images[currentIndex]);
  }

  function tick() {
    const images = getPlaylistImages();

    if (images.length === 0) {
      if (!warnedEmptyPlaylist) {
        console.log("[slideshow] Active playlist is empty (or unset); waiting.");
        warnedEmptyPlaylist = true;
      }
      scheduleNext();
      return;
    }
    warnedEmptyPlaylist = false;

    step(images, 1);
    scheduleNext();
  }

  function start() {
    stop(); // idempotent: clear any existing timer before starting fresh
    currentIndex = null;
    tick(); // show the first image immediately, then keep advancing on the timer
  }

  function stop() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  // Manual navigation: step once, then restart the timer so the new image
  // gets a full interval on screen instead of whatever was left of the old one.
  function manualStep(delta) {
    const images = getPlaylistImages();
    if (images.length === 0) return;
    step(images, delta);
    stop();
    scheduleNext();
  }

  function next() {
    manualStep(1);
  }

  function previous() {
    manualStep(-1);
  }

  function getState() {
    const images = getPlaylistImages();
    return {
      playlistId: getActivePlaylistId(),
      imageCount: images.length,
      currentIndex: images.length ? currentIndex : null,
      intervalSeconds: getIntervalMs() / 1000,
      running: timer !== null,
    };
  }

  return { start, stop, getState, next, previous };
}

module.exports = { createSlideshowMode };
