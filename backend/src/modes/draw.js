// Collaborative live-drawing mode. Implements the mode-manager interface
// (start/stop/getState) plus clear()/save()/handleConnection() for the
// WebSocket route and mode-specific endpoints.
//
// Two decoupled rates are the core of this design:
// - Strokes in: applied to the in-memory canvas immediately, at whatever
//   rate clients send them.
// - Frames out: a fixed-cadence render loop (~30fps) sends the canvas to
//   the renderer only if it changed since the last send. Never one frame
//   per stroke - that floods the renderer socket and reintroduces the
//   backpressure problem renderer-client.js already solves.
//
// Strokes never touch SQLite - only save() does. The canvas is pure
// in-memory state and does not survive a mode switch or restart.

const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const { WebSocket } = require("ws");
const { convertRawToPng } = require("../image-processor");

const WIDTH = 128;
const HEIGHT = 128;
const FRAME_BYTES = WIDTH * HEIGHT * 3;
const RENDER_INTERVAL_MS = 33; // ~30fps

const IMAGES_ROOT = path.join(__dirname, "..", "..", "..", "images");
const ORIGINAL_DIR = path.join(IMAGES_ROOT, "original");
const PROCESSED_DIR = path.join(IMAGES_ROOT, "processed");

function isValidPoint(p) {
  return (
    p !== null &&
    typeof p === "object" &&
    Number.isInteger(p.x) && p.x >= 0 && p.x < WIDTH &&
    Number.isInteger(p.y) && p.y >= 0 && p.y < HEIGHT &&
    Number.isInteger(p.r) && p.r >= 0 && p.r <= 255 &&
    Number.isInteger(p.g) && p.g >= 0 && p.g <= 255 &&
    Number.isInteger(p.b) && p.b >= 0 && p.b <= 255
  );
}

function createDrawMode({ db, rendererClient }) {
  let canvas = Buffer.alloc(FRAME_BYTES);
  let dirty = false;
  let renderTimer = null;
  const clients = new Map(); // id -> ws
  let nextClientId = 1;

  function applyPoint(p) {
    const offset = (p.y * WIDTH + p.x) * 3;
    canvas[offset] = p.r;
    canvas[offset + 1] = p.g;
    canvas[offset + 2] = p.b;
  }

  function broadcast(message, excludeId) {
    const payload = JSON.stringify(message);
    for (const [id, ws] of clients) {
      if (id === excludeId) continue;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }

  // Called by index.js's WebSocketServer 'connection' handler, but only
  // when this instance is the mode manager's current draw instance - the
  // dispatch/rejection logic lives there, not here.
  function handleConnection(ws) {
    const id = nextClientId++;
    clients.set(id, ws);

    // A newly connected client needs the current drawing once, then
    // switches to receiving incremental deltas like everyone else.
    ws.send(
      JSON.stringify({
        type: "snapshot",
        width: WIDTH,
        height: HEIGHT,
        pixels: canvas.toString("base64"),
      })
    );

    ws.on("message", (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch (err) {
        return; // drop malformed message, never crash on bad input
      }

      const points = Array.isArray(msg.points) ? msg.points : [msg];
      const validPoints = points.filter(isValidPoint);
      if (validPoints.length === 0) return;

      for (const p of validPoints) applyPoint(p);
      dirty = true;

      // Broadcast to everyone EXCEPT the sender - it already applied these
      // locally, so echoing back would double-draw/flicker.
      broadcast({ type: "stroke", points: validPoints, clientId: id }, id);
    });

    ws.on("close", () => {
      clients.delete(id);
    });

    // Required: an unhandled 'error' event on a ws socket crashes the
    // process, same risk as the Unix socket to the renderer.
    ws.on("error", (err) => {
      console.log(`[draw] Client ${id} socket error: ${err.message}`);
    });
  }

  function renderTick() {
    if (dirty) {
      rendererClient.sendFrame(Buffer.from(canvas)); // copy - canvas keeps mutating
      dirty = false;
    }
  }

  function start() {
    stop(); // idempotent: clear any previous timer/clients first
    canvas = Buffer.alloc(FRAME_BYTES); // fresh blank canvas every time drawing starts
    dirty = true; // push the initial blank frame once
    renderTimer = setInterval(renderTick, RENDER_INTERVAL_MS);
  }

  function stop() {
    if (renderTimer) {
      clearInterval(renderTimer);
      renderTimer = null;
    }
    for (const ws of clients.values()) {
      ws.close(1001, "Draw mode stopped.");
    }
    clients.clear();
  }

  function clear() {
    canvas.fill(0);
    dirty = true;
    broadcast({ type: "clear" });
  }

  // Persists the current canvas: the canvas is already in the exact raw
  // renderer format, so it's written straight to processed_path with no
  // Python involved. original_path needs to be a real decodable image
  // (so /api/images/:id/crop and a future UI can use it like any other
  // image), which does require Python - that's the only processing here.
  async function save() {
    const uuid = crypto.randomUUID();
    const processedPath = path.join(PROCESSED_DIR, `${uuid}.rgb`);
    const originalPath = path.join(ORIGINAL_DIR, `${uuid}.png`);

    fs.writeFileSync(processedPath, canvas);
    await convertRawToPng(processedPath, originalPath);

    const result = db
      .prepare(`INSERT INTO images (original_path, processed_path, source) VALUES (?, ?, 'draw')`)
      .run(originalPath, processedPath);

    return db.prepare("SELECT * FROM images WHERE id = ?").get(result.lastInsertRowid);
  }

  function getState() {
    return { clientCount: clients.size };
  }

  return { start, stop, getState, clear, save, handleConnection };
}

module.exports = { createDrawMode };
