-- Drop UNIQUE(user_id, entry_date) so a day can hold more than one entry.
-- SQLite cannot remove a constraint in place, so the table is rebuilt.
--
-- images.entry_id references entries(id) ON DELETE SET NULL and DROP TABLE performs an
-- implicit delete, so rebuilding entries can detach every photo. PRAGMA defer_foreign_keys
-- only holds inside a transaction, and whether these statements share one depends on how
-- they are submitted, so the links are also copied out and written back afterwards. That
-- makes the result correct whether or not the pragma takes effect.
PRAGMA defer_foreign_keys = true;

DROP TABLE IF EXISTS images_entry_backup;
CREATE TABLE images_entry_backup AS SELECT id, entry_id FROM images;

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

-- Restore any link the drop cleared. A no-op when the pragma did hold.
UPDATE images SET entry_id = (
  SELECT backup.entry_id FROM images_entry_backup backup WHERE backup.id = images.id
) WHERE entry_id IS NULL;

DROP TABLE images_entry_backup;
