// Image upload, listing, display, playlist assignment, and re-cropping.
// A factory (not a plain router) because /display needs the already-running
// rendererClient instance from index.js, not a fresh one.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const { db } = require("../db");
const { processImage } = require("../image-processor");
const { FRAME_BYTES } = require("../renderer-client");

const IMAGES_ROOT = path.join(__dirname, "..", "..", "..", "images");
const ORIGINAL_DIR = path.join(IMAGES_ROOT, "original");
const PROCESSED_DIR = path.join(IMAGES_ROOT, "processed");

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

function isValidCropRect(body) {
  const { cropX, cropY, cropW, cropH } = body;
  return (
    Number.isInteger(cropX) &&
    Number.isInteger(cropY) &&
    Number.isInteger(cropW) &&
    Number.isInteger(cropH) &&
    cropX >= 0 &&
    cropY >= 0 &&
    cropW > 0 &&
    cropH > 0
  );
}

function createImagesRouter({ rendererClient }) {
  const router = express.Router();

  // Uploads an image, processes it into a 128x128 raw RGB file via Python,
  // and records both paths in SQLite.
  router.post("/", (req, res) => {
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

  router.get("/", (req, res) => {
    const rows = db.prepare("SELECT * FROM images ORDER BY id").all();
    res.json(rows);
  });

  // Assigns an image to a playlist (or unassigns with playlistId: null) and/or
  // changes its sort_order.
  router.patch("/:id", (req, res) => {
    const row = db.prepare("SELECT * FROM images WHERE id = ?").get(req.params.id);
    if (!row) {
      res.status(404).json({ error: "Image not found." });
      return;
    }

    const { playlistId, sortOrder } = req.body || {};

    if (playlistId !== undefined && playlistId !== null) {
      const playlist = db.prepare("SELECT id FROM playlists WHERE id = ?").get(playlistId);
      if (!playlist) {
        res.status(404).json({ error: "Playlist not found." });
        return;
      }
    }

    const updates = [];
    const values = [];
    if (playlistId !== undefined) {
      updates.push("playlist_id = ?");
      values.push(playlistId);
    }
    if (sortOrder !== undefined) {
      updates.push("sort_order = ?");
      values.push(sortOrder);
    }
    if (updates.length === 0) {
      res.status(400).json({ error: "Nothing to update. Provide playlistId and/or sortOrder." });
      return;
    }

    values.push(row.id);
    db.prepare(`UPDATE images SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    res.json(db.prepare("SELECT * FROM images WHERE id = ?").get(row.id));
  });

  // Re-processes the ORIGINAL file with a new crop rectangle, overwriting
  // processed_path. original_path is never touched, which is the whole
  // reason the two paths are kept separate - the crop can always be redone.
  router.post("/:id/crop", async (req, res) => {
    const row = db.prepare("SELECT * FROM images WHERE id = ?").get(req.params.id);
    if (!row) {
      res.status(404).json({ error: "Image not found." });
      return;
    }

    if (!isValidCropRect(req.body || {})) {
      res
        .status(400)
        .json({ error: "cropX, cropY, cropW, cropH must be non-negative integers (cropW/cropH > 0)." });
      return;
    }

    const { cropX, cropY, cropW, cropH } = req.body;

    try {
      await processImage(row.original_path, row.processed_path, { cropX, cropY, cropW, cropH });
    } catch (processErr) {
      res.status(500).json({ error: `Re-processing failed: ${processErr.message}` });
      return;
    }

    db.prepare(
      `UPDATE images SET crop_x = ?, crop_y = ?, crop_w = ?, crop_h = ? WHERE id = ?`
    ).run(cropX, cropY, cropW, cropH, row.id);

    res.json(db.prepare("SELECT * FROM images WHERE id = ?").get(row.id));
  });

  // The integration test from Phase 2: pulls a processed image back out of
  // SQLite and disk, and pushes it through the renderer client.
  router.post("/:id/display", (req, res) => {
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

  return router;
}

module.exports = { createImagesRouter };
