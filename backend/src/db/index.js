// Opens the SQLite connection, applies the schema, and seeds default
// app_state. This module owns the db file path and connection lifecycle;
// everything else just imports the exported `db` handle.

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DB_DIR = path.join(__dirname, "..", "..", "db");
const DB_PATH = path.join(DB_DIR, "ledframe.db");
const SCHEMA_PATH = path.join(__dirname, "schema.sql");

const DEFAULT_APP_STATE = {
  current_mode: "slideshow",
  active_playlist: "",
};

fs.mkdirSync(DB_DIR, { recursive: true });

const isNewDatabase = !fs.existsSync(DB_PATH);

const db = new Database(DB_PATH);

// PRAGMAs apply per connection, not once to the file - foreign_keys in
// particular is OFF by default on every new connection, so REFERENCES
// constraints would silently do nothing if this were skipped.
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("synchronous = NORMAL");

const schema = fs.readFileSync(SCHEMA_PATH, "utf8");
db.exec(schema);

const seedAppState = db.prepare(
  "INSERT OR IGNORE INTO app_state (key, value) VALUES (?, ?)"
);
for (const [key, value] of Object.entries(DEFAULT_APP_STATE)) {
  seedAppState.run(key, value);
}

console.log(
  isNewDatabase
    ? `[db] Created new database at ${DB_PATH}`
    : `[db] Opened existing database at ${DB_PATH}`
);

function close() {
  db.close();
}

module.exports = { db, close };
