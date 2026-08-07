// Paint-by-number mode. Implements the mode-manager interface
// (start/stop/getState) plus markRevealed(), which routes/pbn.js's colour
// action calls to keep the live panel in sync.
//
// Holds the session's working state in memory (palette, per-block correct
// answers, and progress) so rendering is cheap. progress is ALSO persisted
// to pbn_sessions.progress_json on every correct move (in routes/pbn.js,
// which owns the database write) - colouring takes days, and that
// persistence is the whole reason SQLite is in the stack for this mode.
//
// Rendering: unrevealed blocks show a dimmed version of their target
// palette colour (a hint); revealed blocks show the real pixels from
// full_res_path (the reveal effect). Only sent to the renderer when
// something changed (dirty flag) - same discipline as the drawing render
// loop, just on a slower cadence since block colouring is a discrete,
// human-paced action, not a continuous stream like drawing strokes.

const fs = require("fs");

const WIDTH = 128;
const HEIGHT = 128;
const FRAME_BYTES = WIDTH * HEIGHT * 3;
const RENDER_INTERVAL_MS = 100; // 10fps - plenty for human-paced block colouring
const HINT_DIM_FACTOR = 0.35; // placeholder brightness for hint blocks - tunable, pending real hardware calibration

function createPaintByNumberMode({ db, rendererClient }) {
  let renderTimer = null;
  let dirty = false;

  let sessionId = null;
  let gridWidth = 0;
  let gridHeight = 0;
  let palette = []; // [[r,g,b], ...], index is the "number"
  let blockColors = []; // palette index per block, length gridWidth*gridHeight
  let progress = []; // boolean per block - true once correctly coloured
  let fullRes = null; // Buffer, 49152 bytes - the reveal source, or null if unreadable

  function getActiveSessionId() {
    const row = db.prepare("SELECT value FROM app_state WHERE key = 'active_pbn_session'").get();
    const value = row ? row.value : "";
    return value === "" ? null : Number(value);
  }

  function loadSession(id) {
    const row = db.prepare("SELECT * FROM pbn_sessions WHERE id = ?").get(id);
    if (!row) return false;

    sessionId = row.id;
    gridWidth = row.grid_width;
    gridHeight = row.grid_height;
    palette = JSON.parse(row.palette_json);
    blockColors = JSON.parse(row.block_colors_json);
    progress = JSON.parse(row.progress_json);

    try {
      fullRes = fs.readFileSync(row.full_res_path);
    } catch (err) {
      console.log(
        `[paint-by-number] Could not read full_res_path ${row.full_res_path}: ${err.message}`
      );
      fullRes = null;
    }

    return true;
  }

  function composeFrame() {
    const frame = Buffer.alloc(FRAME_BYTES);
    const blockW = WIDTH / gridWidth;
    const blockH = HEIGHT / gridHeight;

    for (let by = 0; by < gridHeight; by++) {
      for (let bx = 0; bx < gridWidth; bx++) {
        const blockIndex = by * gridWidth + bx;
        const revealed = progress[blockIndex] && fullRes !== null;
        const [pr, pg, pb] = palette[blockColors[blockIndex]];

        for (let dy = 0; dy < blockH; dy++) {
          for (let dx = 0; dx < blockW; dx++) {
            const x = bx * blockW + dx;
            const y = by * blockH + dy;
            const offset = (y * WIDTH + x) * 3;

            if (revealed) {
              frame[offset] = fullRes[offset];
              frame[offset + 1] = fullRes[offset + 1];
              frame[offset + 2] = fullRes[offset + 2];
            } else {
              frame[offset] = Math.round(pr * HINT_DIM_FACTOR);
              frame[offset + 1] = Math.round(pg * HINT_DIM_FACTOR);
              frame[offset + 2] = Math.round(pb * HINT_DIM_FACTOR);
            }
          }
        }
      }
    }

    return frame;
  }

  function renderTick() {
    if (!dirty || sessionId === null) return;
    rendererClient.sendFrame(composeFrame());
    dirty = false;
  }

  function start() {
    stop(); // idempotent: clear any previous timer first

    const activeId = getActiveSessionId();
    if (activeId === null || !loadSession(activeId)) {
      console.log("[paint-by-number] No active session (or session not found); waiting.");
      sessionId = null;
    } else {
      dirty = true; // push the initial hint-colour frame once
    }

    renderTimer = setInterval(renderTick, RENDER_INTERVAL_MS);
  }

  function stop() {
    if (renderTimer) {
      clearInterval(renderTimer);
      renderTimer = null;
    }
  }

  // Called by routes/pbn.js's POST /:id/color handler, only when this
  // instance is showing the session the move was applied to. The database
  // write already happened there; this just keeps the in-memory render
  // state (and therefore the panel) in sync without re-reading the whole
  // session back from disk.
  function markRevealed(blockIndex) {
    if (sessionId === null) return;
    progress[blockIndex] = true;
    dirty = true;
  }

  function getState() {
    const totalBlocks = gridWidth * gridHeight;
    const revealedCount = progress.filter(Boolean).length;
    return {
      sessionId,
      gridWidth,
      gridHeight,
      totalBlocks,
      revealedCount,
    };
  }

  return { start, stop, getState, markRevealed };
}

module.exports = { createPaintByNumberMode };
