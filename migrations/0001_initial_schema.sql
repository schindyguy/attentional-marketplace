CREATE TABLE IF NOT EXISTS publishers (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT    NOT NULL UNIQUE,
  website          TEXT,
  geography        TEXT    DEFAULT 'United States',
  primary_category TEXT,
  status           TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')),
  cover_image_url  TEXT,
  notes            TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS handles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  handle_name     TEXT    NOT NULL,
  platform        TEXT    NOT NULL CHECK(platform IN ('fb','ig')),
  brand_name      TEXT    NOT NULL,
  publisher_id    INTEGER NOT NULL REFERENCES publishers(id) ON DELETE RESTRICT,
  profile_url     TEXT,
  categories      TEXT    NOT NULL DEFAULT '[]',
  followers       INTEGER NOT NULL DEFAULT 0,
  geography       TEXT    DEFAULT 'United States',
  property_url    TEXT,
  featured        INTEGER NOT NULL DEFAULT 0 CHECK(featured IN (0,1)),
  status          TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','removed')),
  removal_reason  TEXT,
  removal_notes   TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(handle_name, platform)
);

CREATE INDEX IF NOT EXISTS idx_handles_featured   ON handles(featured);
CREATE INDEX IF NOT EXISTS idx_handles_status     ON handles(status);
CREATE INDEX IF NOT EXISTS idx_handles_publisher  ON handles(publisher_id);
