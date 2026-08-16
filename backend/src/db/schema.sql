-- Schema for ledframe.db. Applied with CREATE TABLE IF NOT EXISTS on every
-- startup, so re-running this file is always safe.

-- Image collections.
CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- All images regardless of origin (upload, drawing, paint-by-number export).
-- No playlist_id here: an image can belong to any number of playlists (or
-- none), so that link lives in playlist_images below, not as a column here.
-- No sort_order here either: an image's position only makes sense within a
-- given playlist (the same image could be 3rd in one playlist and 1st in
-- another), so ordering lives on playlist_images.sort_order, not here.
CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  original_path TEXT NOT NULL,
  processed_path TEXT,
  crop_x INTEGER,
  crop_y INTEGER,
  crop_w INTEGER,
  crop_h INTEGER,
  source TEXT NOT NULL CHECK(source IN ('upload', 'draw', 'paint-by-number')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Many-to-many link between playlists and images, with per-playlist ordering.
-- CASCADE on both sides: deleting a playlist removes its links (the images
-- themselves survive, just unlinked from that playlist); deleting an image
-- removes its links (no orphaned join rows). Composite PK blocks the same
-- image being linked twice to the same playlist.
CREATE TABLE IF NOT EXISTS playlist_images (
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  image_id    INTEGER NOT NULL REFERENCES images(id)    ON DELETE CASCADE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (playlist_id, image_id)
);

-- Paint-by-number progress. Must survive power loss, so every block coloured
-- is persisted here rather than kept only in memory.
CREATE TABLE IF NOT EXISTS pbn_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_res_path TEXT NOT NULL,
  pixel_art_path TEXT,
  grid_width INTEGER NOT NULL,
  grid_height INTEGER NOT NULL,
  palette_json TEXT NOT NULL,
  block_colors_json TEXT NOT NULL,
  progress_json TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Global key/value state (current mode, active playlist, etc).
CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
