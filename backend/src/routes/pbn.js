// Paint-by-number session creation, inspection, and the colour-a-block
// action. Stateless/DB-driven by design: progress is persisted on every
// correct move (see paint-by-number.js), so unlike draw mode's ephemeral
// canvas, these endpoints never require paint-by-number mode to be the
// active mode to work. The colour action additionally pokes the live mode
// instance, if any, so the panel updates immediately when it happens to be
// showing this exact session - but that's an optimization, not a
// requirement for correctness.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const { db } = require("../db");
const { analyzePbn, convertRawToPng } = require("../image-processor");

const IMAGES_ROOT = path.join(__dirname, "..", "..", "..", "images");
const ORIGINAL_DIR = path.join(IMAGES_ROOT, "original");
const PROCESSED_DIR = path.join(IMAGES_ROOT, "processed");

const WIDTH = 128;
const HEIGHT = 128;
const FRAME_BYTES = WIDTH * HEIGHT * 3;
const VALID_DIFFICULTIES = ["easy", "medium", "hard"];

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

function loadSessionRow(id) {
  return db.prepare("SELECT * FROM pbn_sessions WHERE id = ?").get(id);
}

// Renders every block at its flat palette colour, full brightness - the
// "pixel art" save. Synthesized directly from already-known small data
// (the palette + per-block answers), the same way index.js's
// buildTestFrame() builds a raw pattern in JS: this isn't decoding or
// transforming a photo, so it doesn't need to go through Python.
function renderPixelArt(gridWidth, gridHeight, palette, blockColors) {
  const frame = Buffer.alloc(FRAME_BYTES);
  const blockW = WIDTH / gridWidth;
  const blockH = HEIGHT / gridHeight;

  for (let by = 0; by < gridHeight; by++) {
    for (let bx = 0; bx < gridWidth; bx++) {
      const [r, g, b] = palette[blockColors[by * gridWidth + bx]];
      for (let dy = 0; dy < blockH; dy++) {
        for (let dx = 0; dx < blockW; dx++) {
          const offset = ((by * blockH + dy) * WIDTH + (bx * blockW + dx)) * 3;
          frame[offset] = r;
          frame[offset + 1] = g;
          frame[offset + 2] = b;
        }
      }
    }
  }

  return frame;
}

// Writes a raw RGB buffer to processed_path and converts it to a viewable
// PNG for original_path, then inserts an images row - the same
// raw-is-canonical, PNG-is-viewable pattern draw mode's save() uses.
async function saveAsImage(rawBuffer) {
  const uuid = crypto.randomUUID();
  const processedPath = path.join(PROCESSED_DIR, `${uuid}.rgb`);
  const originalPath = path.join(ORIGINAL_DIR, `${uuid}.png`);

  fs.writeFileSync(processedPath, rawBuffer);
  await convertRawToPng(processedPath, originalPath);

  const result = db
    .prepare(`INSERT INTO images (original_path, processed_path, source) VALUES (?, ?, 'paint-by-number')`)
    .run(originalPath, processedPath);

  return result.lastInsertRowid;
}

function createPbnRouter({ modeManager }) {
  const router = express.Router();

  router.post("/create", (req, res) => {
    upload.single("image")(req, res, async (err) => {
      if (err) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: "No image file provided (field name must be 'image')." });
        return;
      }

      const { difficulty } = req.body;
      if (!VALID_DIFFICULTIES.includes(difficulty)) {
        res.status(400).json({ error: `difficulty must be one of: ${VALID_DIFFICULTIES.join(", ")}` });
        return;
      }

      const uuid = crypto.randomUUID();
      const jsonPath = path.join(PROCESSED_DIR, `${uuid}.json`);

      let analysis;
      try {
        analysis = await analyzePbn(req.file.path, difficulty, jsonPath);
      } catch (analyzeErr) {
        res.status(500).json({ error: `Analysis failed: ${analyzeErr.message}` });
        return;
      }

      const totalBlocks = analysis.grid_width * analysis.grid_height;
      const progress = new Array(totalBlocks).fill(false);

      const result = db
        .prepare(
          `INSERT INTO pbn_sessions
             (full_res_path, grid_width, grid_height, palette_json, block_colors_json, progress_json)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          analysis.full_res_path,
          analysis.grid_width,
          analysis.grid_height,
          JSON.stringify(analysis.palette),
          JSON.stringify(analysis.block_colors),
          JSON.stringify(progress)
        );

      res.status(201).json({
        id: result.lastInsertRowid,
        gridWidth: analysis.grid_width,
        gridHeight: analysis.grid_height,
        palette: analysis.palette,
      });
    });
  });

  router.get("/:id", (req, res) => {
    const row = loadSessionRow(req.params.id);
    if (!row) {
      res.status(404).json({ error: "Session not found." });
      return;
    }

    res.json({
      id: row.id,
      gridWidth: row.grid_width,
      gridHeight: row.grid_height,
      palette: JSON.parse(row.palette_json),
      blockColors: JSON.parse(row.block_colors_json),
      progress: JSON.parse(row.progress_json),
      completed: row.completed === 1,
    });
  });

  router.post("/:id/color", (req, res) => {
    const row = loadSessionRow(req.params.id);
    if (!row) {
      res.status(404).json({ error: "Session not found." });
      return;
    }

    const gridWidth = row.grid_width;
    const gridHeight = row.grid_height;
    const totalBlocks = gridWidth * gridHeight;
    const palette = JSON.parse(row.palette_json);
    const blockColors = JSON.parse(row.block_colors_json);

    const body = req.body || {};
    const { paletteIndex } = body;
    let { blockIndex } = body;
    if (
      blockIndex === undefined &&
      Number.isInteger(body.x) &&
      Number.isInteger(body.y) &&
      body.x >= 0 &&
      body.x < gridWidth &&
      body.y >= 0 &&
      body.y < gridHeight
    ) {
      blockIndex = body.y * gridWidth + body.x;
    }

    if (
      !Number.isInteger(blockIndex) ||
      blockIndex < 0 ||
      blockIndex >= totalBlocks ||
      !Number.isInteger(paletteIndex) ||
      paletteIndex < 0 ||
      paletteIndex >= palette.length
    ) {
      res.status(400).json({ error: "blockIndex (or x/y) and paletteIndex must be valid, in-range integers." });
      return;
    }

    if (paletteIndex !== blockColors[blockIndex]) {
      res.json({ correct: false });
      return;
    }

    const progress = JSON.parse(row.progress_json);
    const alreadyRevealed = Boolean(progress[blockIndex]);
    progress[blockIndex] = true;
    const completed = progress.every(Boolean) ? 1 : 0;

    db.prepare("UPDATE pbn_sessions SET progress_json = ?, completed = ? WHERE id = ?").run(
      JSON.stringify(progress),
      completed,
      row.id
    );

    // Keep the live panel in sync if this session happens to be the one
    // currently showing - a no-op if paint-by-number isn't active or is
    // showing a different session.
    if (
      modeManager.getCurrentModeName() === "paint-by-number" &&
      modeManager.getState().sessionId === row.id
    ) {
      modeManager.getCurrentInstance().markRevealed(blockIndex);
    }

    res.json({ correct: true, alreadyRevealed, completed: completed === 1 });
  });

  router.post("/:id/save", async (req, res) => {
    const row = loadSessionRow(req.params.id);
    if (!row) {
      res.status(404).json({ error: "Session not found." });
      return;
    }
    if (row.completed !== 1) {
      res.status(400).json({ error: "Session is not complete yet." });
      return;
    }

    const gridWidth = row.grid_width;
    const gridHeight = row.grid_height;
    const palette = JSON.parse(row.palette_json);
    const blockColors = JSON.parse(row.block_colors_json);

    let fullRes;
    try {
      fullRes = fs.readFileSync(row.full_res_path);
    } catch (readErr) {
      res.status(500).json({ error: `Could not read full_res_path: ${readErr.message}` });
      return;
    }

    try {
      const pixelArt = renderPixelArt(gridWidth, gridHeight, palette, blockColors);
      const pixelArtImageId = await saveAsImage(pixelArt);
      const revealedImageId = await saveAsImage(fullRes);

      const pixelArtRow = db.prepare("SELECT processed_path FROM images WHERE id = ?").get(pixelArtImageId);
      db.prepare("UPDATE pbn_sessions SET pixel_art_path = ? WHERE id = ?").run(
        pixelArtRow.processed_path,
        row.id
      );

      res.status(201).json({ pixelArtImageId, revealedImageId });
    } catch (saveErr) {
      res.status(500).json({ error: `Save failed: ${saveErr.message}` });
    }
  });

  return router;
}

module.exports = { createPbnRouter };
