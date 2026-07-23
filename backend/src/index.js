// Phase 2 step 3: HTTP -> backend -> renderer -> emulator chain.
// No slideshow, drawing, paint-by-number, or database yet.

const express = require("express");
const { createRendererClient, FRAME_BYTES } = require("./renderer-client");

const PORT = 3000;
const WIDTH = 128;
const HEIGHT = 128;
const TOP_BAR_ROWS = 16;

const app = express();
const rendererClient = createRendererClient();
const startTime = Date.now();

app.get("/api/status", (req, res) => {
  res.json({
    rendererConnected: rendererClient.isConnected(),
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
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

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`[index] Listening on 0.0.0.0:${PORT}`);
});

function shutdown() {
  console.log("[index] Shutting down...");
  rendererClient.close();
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
