// Playlist CRUD. Deleting a playlist never deletes image files or image
// rows - see the schema.sql comment on images.playlist_id (ON DELETE SET
// NULL): an image can exist outside any playlist, so it is orphaned, not
// removed, when its playlist goes away.

const express = require("express");
const { db } = require("../db");

const router = express.Router();

router.post("/", (req, res) => {
  const { name } = req.body || {};
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "name is required." });
    return;
  }

  const result = db.prepare("INSERT INTO playlists (name) VALUES (?)").run(name);
  const row = db.prepare("SELECT * FROM playlists WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(row);
});

router.get("/", (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*, COUNT(i.id) AS image_count
       FROM playlists p
       LEFT JOIN images i ON i.playlist_id = p.id
       GROUP BY p.id
       ORDER BY p.sort_order, p.id`
    )
    .all();
  res.json(rows);
});

router.get("/:id", (req, res) => {
  const playlist = db.prepare("SELECT * FROM playlists WHERE id = ?").get(req.params.id);
  if (!playlist) {
    res.status(404).json({ error: "Playlist not found." });
    return;
  }

  const images = db
    .prepare("SELECT * FROM images WHERE playlist_id = ? ORDER BY sort_order, id")
    .all(playlist.id);
  res.json({ ...playlist, images });
});

router.patch("/:id", (req, res) => {
  const playlist = db.prepare("SELECT * FROM playlists WHERE id = ?").get(req.params.id);
  if (!playlist) {
    res.status(404).json({ error: "Playlist not found." });
    return;
  }

  const { name, sortOrder } = req.body || {};
  const updates = [];
  const values = [];
  if (name !== undefined) {
    updates.push("name = ?");
    values.push(name);
  }
  if (sortOrder !== undefined) {
    updates.push("sort_order = ?");
    values.push(sortOrder);
  }
  if (updates.length === 0) {
    res.status(400).json({ error: "Nothing to update. Provide name and/or sortOrder." });
    return;
  }

  values.push(playlist.id);
  db.prepare(`UPDATE playlists SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  res.json(db.prepare("SELECT * FROM playlists WHERE id = ?").get(playlist.id));
});

router.delete("/:id", (req, res) => {
  const playlist = db.prepare("SELECT * FROM playlists WHERE id = ?").get(req.params.id);
  if (!playlist) {
    res.status(404).json({ error: "Playlist not found." });
    return;
  }

  // Foreign keys are ON, so this SET NULLs playlist_id on the playlist's
  // images (schema.sql) - it does not touch the image rows or files.
  db.prepare("DELETE FROM playlists WHERE id = ?").run(playlist.id);
  res.json({ deleted: playlist.id });
});

module.exports = router;
