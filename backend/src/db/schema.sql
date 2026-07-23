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
CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist_id INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
  original_path TEXT NOT NULL,
  processed_path TEXT,
  crop_x INTEGER,
  crop_y INTEGER,
  crop_w INTEGER,
  crop_h INTEGER,
  source TEXT NOT NULL CHECK(source IN ('upload', 'draw', 'paint-by-number')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
