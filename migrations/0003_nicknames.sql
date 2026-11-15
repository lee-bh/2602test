-- Entries are signed with a nickname each person picks, not their Google name.
-- NULL until they pick one; the site sends them to /me to do that before they can write.
ALTER TABLE users ADD COLUMN nickname TEXT;

-- Two people cannot share a nickname, whatever its letter case. NULLs do not collide.
CREATE UNIQUE INDEX IF NOT EXISTS users_by_nickname ON users(nickname COLLATE NOCASE);
