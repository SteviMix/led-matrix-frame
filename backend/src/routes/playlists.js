// Playlist CRUD, plus linking/unlinking images to playlists via the
// playlist_images join table (many-to-many: one image can be in any number
// of playlists). Deleting a playlist never deletes image files or image
// rows - playlist_images has ON DELETE CASCADE on playlist_id, so only the
// LINKS are removed; the images themselves survive, just unlinked.

const express = require("express");
const { db } = require("../db");

const router = express.Router();

// Attaches playlist_ids onto image rows - same helper shape as
// routes/images.js (not shared as a module: it's one query, and this file
// only needs it for the GET /:id nested images, not worth a shared import
// for the routes to stay independently readable).
function attachPlaylistIds(images) {
  if (images.length === 0) return images;

  const placeholders = images.map(() => "?").join(",");
  const links = db
    .prepare(`SELECT image_id, playlist_id FROM playlist_images WHERE image_id IN (${placeholders})`)
    .all(...images.map((image) => image.id));

  const idsByImageId = new Map();
  for (const link of links) {
    if (!idsByImageId.has(link.image_id)) {
      idsByImageId.set(link.image_id, []);
    }
    idsByImageId.get(link.image_id).push(link.playlist_id);
  }

  return images.map((image) => ({
    ...image,
    playlist_ids: idsByImageId.get(image.id) || [],
  }));
}

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
  // COUNT(pi.image_id), not COUNT(*): with the LEFT JOIN, a playlist with no
  // links produces one row with pi.image_id NULL, and COUNT(*) would count
  // that as 1. COUNT(pi.image_id) correctly ignores NULLs, giving 0.
  const rows = db
    .prepare(
      `SELECT p.*, COUNT(pi.image_id) AS image_count
       FROM playlists p
       LEFT JOIN playlist_images pi ON pi.playlist_id = p.id
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
    .prepare(
      `SELECT i.*, pi.sort_order AS sort_order
       FROM images i
       JOIN playlist_images pi ON pi.image_id = i.id
       WHERE pi.playlist_id = ?
       ORDER BY pi.sort_order, i.id`
    )
    .all(playlist.id);
  res.json({ ...playlist, images: attachPlaylistIds(images) });
});

// Links an image to this playlist. 201 on a new link; 409 (not 500) if the
// pair is already linked - the composite PK on playlist_images makes that a
// constraint violation, which we translate to a clear conflict response.
router.post("/:id/images", (req, res) => {
  const playlist = db.prepare("SELECT id FROM playlists WHERE id = ?").get(req.params.id);
  if (!playlist) {
    res.status(404).json({ error: "Playlist not found." });
    return;
  }

  const { imageId } = req.body || {};
  const image = db.prepare("SELECT id FROM images WHERE id = ?").get(imageId);
  if (!image) {
    res.status(404).json({ error: "Image not found." });
    return;
  }

  try {
    db.prepare("INSERT INTO playlist_images (playlist_id, image_id) VALUES (?, ?)").run(
      playlist.id,
      image.id
    );
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
      res.status(409).json({ error: "Image is already in this playlist." });
      return;
    }
    throw err;
  }

  res.status(201).json({ playlistId: playlist.id, imageId: image.id });
});

// Unlinks an image from this playlist. Never deletes the image row or file
// - only removes the join row, so the image can still exist in other
// playlists or unassigned.
router.delete("/:id/images/:imageId", (req, res) => {
  const result = db
    .prepare("DELETE FROM playlist_images WHERE playlist_id = ? AND image_id = ?")
    .run(req.params.id, req.params.imageId);

  if (result.changes === 0) {
    res.status(404).json({ error: "That image is not linked to this playlist." });
    return;
  }

  res.json({ unlinked: true });
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

  // Foreign keys are ON, so this CASCADEs onto playlist_images (schema.sql)
  // and removes only this playlist's links - it does not touch the image
  // rows or files, which may still be linked to other playlists.
  db.prepare("DELETE FROM playlists WHERE id = ?").run(playlist.id);
  res.json({ deleted: playlist.id });
});

module.exports = router;
