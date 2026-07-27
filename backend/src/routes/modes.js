// Mode switching endpoints. A factory because it needs the already-running
// modeManager instance from index.js.

const express = require("express");
const { db } = require("../db");

function createModesRouter({ modeManager }) {
  const router = express.Router();

  router.post("/slideshow/start", async (req, res) => {
    const { playlistId } = req.body || {};

    if (playlistId !== undefined) {
      const playlist = db.prepare("SELECT id FROM playlists WHERE id = ?").get(playlistId);
      if (!playlist) {
        res.status(404).json({ error: "Playlist not found." });
        return;
      }
      db.prepare(
        `INSERT INTO app_state (key, value) VALUES ('active_playlist', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).run(String(playlistId));
    }

    try {
      const state = await modeManager.switchMode("slideshow");
      res.json(state);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/slideshow/stop", async (req, res) => {
    const state = await modeManager.switchMode("idle");
    res.json(state);
  });

  router.post("/slideshow/next", (req, res) => {
    if (modeManager.getCurrentModeName() !== "slideshow") {
      res.status(409).json({ error: "Slideshow is not the active mode." });
      return;
    }
    modeManager.getCurrentInstance().next();
    res.json(modeManager.getState());
  });

  router.post("/slideshow/previous", (req, res) => {
    if (modeManager.getCurrentModeName() !== "slideshow") {
      res.status(409).json({ error: "Slideshow is not the active mode." });
      return;
    }
    modeManager.getCurrentInstance().previous();
    res.json(modeManager.getState());
  });

  router.patch("/slideshow/settings", (req, res) => {
    const { intervalSeconds } = req.body || {};
    if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
      res.status(400).json({ error: "intervalSeconds must be a positive number." });
      return;
    }

    db.prepare(
      `INSERT INTO app_state (key, value) VALUES ('slideshow_interval_seconds', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(String(intervalSeconds));

    res.json({ intervalSeconds });
  });

  return router;
}

module.exports = { createModesRouter };
