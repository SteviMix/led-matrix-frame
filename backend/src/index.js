// Phase 2 step 5: the integration test. Upload -> Python processing ->
// SQLite -> renderer socket, end to end. Still no playlists, crop/pan UI,
// dithering, paint-by-number, or WebSocket - those are Phase 3.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const { createRendererClient, FRAME_BYTES } = require("./renderer-client");
const { db, close: closeDb } = require("./db");
const { processImage } = require("./image-processor");

const PORT = 3000;
const WIDTH = 128;
const HEIGHT = 128;
const TOP_BAR_ROWS = 16;
const TABLE_NAMES = ["playlists", "images", "pbn_sessions", "app_state"];

const IMAGES_ROOT = path.join(__dirname, "..", "..", "images");
const ORIGINAL_DIR = path.join(IMAGES_ROOT, "original");
const PROCESSED_DIR = path.join(IMAGES_ROOT, "processed");

const app = express();
const rendererClient = createRendererClient();
const startTime = Date.now();

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, ORIGINAL_DIR),
    filename: (req, file, cb) => {
      const uniqueName = `${crypto.randomUUID()}${path.extname(file.originalname)}`;
      cb(null, uniqueName);
    },
  }),
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "image/jpeg" || file.mimetype === "image/png") {
      cb(null, true);
    } else {
      cb(new Error("Only JPG and PNG images are accepted."));
    }
  },
});

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

// Uploads an image, processes it into a 128x128 raw RGB file via Python,
// and records both paths in SQLite.
app.post("/api/images", (req, res) => {
  upload.single("image")(req, res, async (err) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "No image file provided (field name must be 'image')." });
      return;
    }

    const originalPath = req.file.path;
    const baseName = path.parse(req.file.filename).name;
    const processedPath = path.join(PROCESSED_DIR, `${baseName}.rgb`);

    try {
      await processImage(originalPath, processedPath);
    } catch (processErr) {
      res.status(500).json({ error: `Image processing failed: ${processErr.message}` });
      return;
    }

    const result = db
      .prepare(
        `INSERT INTO images (original_path, processed_path, source)
         VALUES (?, ?, 'upload')`
      )
      .run(originalPath, processedPath);

    const row = db.prepare("SELECT * FROM images WHERE id = ?").get(result.lastInsertRowid);
    res.status(201).json(row);
  });
});

app.get("/api/images", (req, res) => {
  const rows = db.prepare("SELECT * FROM images ORDER BY id").all();
  res.json(rows);
});

// The integration test: pulls a previously processed image back out of
// SQLite and disk, and pushes it through the same renderer client used by
// /api/test-frame, proving the whole chain works end to end.
app.post("/api/images/:id/display", (req, res) => {
  const row = db.prepare("SELECT * FROM images WHERE id = ?").get(req.params.id);
  if (!row) {
    res.status(404).json({ error: "Image not found." });
    return;
  }

  if (!rendererClient.isConnected()) {
    res.status(503).json({ error: "Renderer is not connected." });
    return;
  }

  let frame;
  try {
    frame = fs.readFileSync(row.processed_path);
  } catch (readErr) {
    res.status(500).json({ error: `Could not read processed file: ${readErr.message}` });
    return;
  }

  if (frame.length !== FRAME_BYTES) {
    res
      .status(500)
      .json({ error: `Processed file has wrong size: ${frame.length} bytes, expected ${FRAME_BYTES}` });
    return;
  }

  const sent = rendererClient.sendFrame(frame);

  db.prepare(
    `INSERT INTO app_state (key, value) VALUES ('current_image', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(String(row.id));

  res.json({ sent, imageId: row.id });
});

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`[index] Listening on 0.0.0.0:${PORT}`);
});

function shutdown() {
  console.log("[index] Shutting down...");
  rendererClient.close();
  closeDb();
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
