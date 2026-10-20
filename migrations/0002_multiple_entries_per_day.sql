-- Drop UNIQUE(user_id, entry_date) so a day can hold more than one entry.
-- SQLite cannot remove a constraint in place, so the table is rebuilt.
-- images.entry_id references entries(id) ON DELETE SET NULL, and DROP TABLE runs an
-- implicit delete, so foreign keys must be deferred or every photo loses its entry.
PRAGMA defer_foreign_keys = true;

CREATE TABLE entries_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_date TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO entries_new (id, user_id, entry_date, title, body, created_at, updated_at)
  SELECT id, user_id, entry_date, title, body, created_at, updated_at FROM entries;

DROP TABLE entries;

ALTER TABLE entries_new RENAME TO entries;

CREATE INDEX IF NOT EXISTS entries_by_user_date ON entries(user_id, entry_date DESC);
