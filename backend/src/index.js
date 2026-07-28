// Phase 3 part 2: collaborative live drawing, on top of mode management +
// slideshow. Still no paint-by-number or Angular frontend - those are part
// 3 and Phase 4.

const http = require("http");
const path = require("path");
const express = require("express");
const { WebSocketServer } = require("ws");
const { createRendererClient, FRAME_BYTES } = require("./renderer-client");
const { db, close: closeDb } = require("./db");
const { createModeManager } = require("./modes/mode-manager");
const { createSlideshowMode } = require("./modes/slideshow");
const { createDrawMode } = require("./modes/draw");
const playlistsRouter = require("./routes/playlists");
const { createImagesRouter } = require("./routes/images");
const { createModesRouter } = require("./routes/modes");

const PORT = 3000;
const WIDTH = 128;
const HEIGHT = 128;
const TOP_BAR_ROWS = 16;
const TABLE_NAMES = ["playlists", "images", "pbn_sessions", "app_state"];

const app = express();
app.use(express.json());
// Dev-only test client for the draw WebSocket - there's no Angular frontend
// yet (Phase 4). Not part of the product; just how this mode gets verified
// by hand until then.
app.use(express.static(path.join(__dirname, "..", "public")));

const rendererClient = createRendererClient();
const modeManager = createModeManager({ db });
modeManager.register("slideshow", () => createSlideshowMode({ db, rendererClient }));
modeManager.register("draw", () => createDrawMode({ db, rendererClient }));

const startTime = Date.now();

// Row counts per table - the only way to verify the schema without a DB browser.
function getTableCounts() {
  const counts = {};
  for (const table of TABLE_NAMES) {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
    counts[table] = row.count;
  }
  return counts;
}

app.get("/api/status", (req, res) => {
  res.json({
    rendererConnected: rendererClient.isConnected(),
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    database: {
      connected: db.open,
      rowCounts: getTableCounts(),
    },
    mode: modeManager.getState(),
  });
});

// Builds an asymmetric test frame so orientation bugs (flips, transposes)
// are visually obvious: red bar across the top, green/blue split below it.
function buildTestFrame() {
  const buffer = Buffer.alloc(FRAME_BYTES);

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const offset = (y * WIDTH + x) * 3;
      if (y < TOP_BAR_ROWS) {
        buffer[offset] = 255; // R
        buffer[offset + 1] = 0; // G
        buffer[offset + 2] = 0; // B
      } else if (x < WIDTH / 2) {
        buffer[offset] = 0;
        buffer[offset + 1] = 255;
        buffer[offset + 2] = 0;
      } else {
        buffer[offset] = 0;
        buffer[offset + 1] = 0;
        buffer[offset + 2] = 255;
      }
    }
  }

  return buffer;
}

app.post("/api/test-frame", (req, res) => {
  if (!rendererClient.isConnected()) {
    res.status(503).json({ error: "Renderer is not connected." });
    return;
  }

  const sent = rendererClient.sendFrame(buildTestFrame());
  res.json({ sent });
});

app.use("/api/playlists", playlistsRouter);
app.use("/api/images", createImagesRouter({ rendererClient }));
app.use("/api/modes", createModesRouter({ modeManager }));

// http.createServer(app) instead of app.listen() so the WebSocketServer can
// attach to the same underlying server before we start listening - needed
// because modeManager.resume() (which can start draw mode) runs before we
// call server.listen() below.
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws/draw" });

// A single, permanent listener that dispatches to whichever draw-mode
// instance is currently active (if any). Registering/deregistering this per
// mode-switch would leak a listener on `wss` every time the user switched
// back into draw mode, since mode-manager creates a fresh instance each
// time - so this stays outside the mode's own lifecycle entirely.
wss.on("connection", (ws) => {
  if (modeManager.getCurrentModeName() !== "draw") {
    ws.close(1013, "Draw mode is not active.");
    return;
  }
  modeManager.getCurrentInstance().handleConnection(ws);
});

// Required: an unhandled 'error' event on the WebSocketServer would crash
// the process, same risk as every other socket in this app.
wss.on("error", (err) => {
  console.log(`[index] WebSocket server error: ${err.message}`);
});

async function start() {
  // Resume before accepting HTTP requests, so no request can race a mode
  // that hasn't finished coming back up yet.
  await modeManager.resume();

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[index] Listening on 0.0.0.0:${PORT}`);
  });

  async function shutdown() {
    console.log("[index] Shutting down...");
    await modeManager.shutdown(); // stops any running mode timer without touching current_mode
    wss.close();
    rendererClient.close();
    closeDb();
    server.close(() => {
      process.exit(0);
    });
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start();
