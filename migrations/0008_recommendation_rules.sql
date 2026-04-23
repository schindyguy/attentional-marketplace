-- Rules engine: configurable if/then logic layered on top of category scoring.
-- Unifies the old pinned_brand_keys concept — a pinned brand is just a rule
-- with conditions_json='[]' and action='force_include'.
CREATE TABLE IF NOT EXISTS recommendation_rules (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  priority        INTEGER NOT NULL DEFAULT 100,
  enabled         INTEGER NOT NULL DEFAULT 1,
  conditions_json TEXT NOT NULL DEFAULT '[]',
  action          TEXT NOT NULL CHECK (action IN ('force_include','exclude','boost')),
  brand_keys_json TEXT NOT NULL DEFAULT '[]',
  boost_points    INTEGER NOT NULL DEFAULT 0,
  notes           TEXT,
  scope_domain    TEXT,
  fire_count      INTEGER NOT NULL DEFAULT 0,
  last_fired_at   INTEGER,
  deleted_at      INTEGER,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_rules_active_priority
  ON recommendation_rules(enabled, priority)
  WHERE deleted_at IS NULL;

-- Lightweight recent-recommendations log for debugging / audit.
-- Retention: trimmed periodically (or by TTL query) to ~30 days.
CREATE TABLE IF NOT EXISTS recommendation_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  domain            TEXT NOT NULL,
  dna_json          TEXT NOT NULL,
  triggered_rules   TEXT NOT NULL DEFAULT '[]',
  excluded_brands   TEXT NOT NULL DEFAULT '[]',
  result_keys       TEXT NOT NULL DEFAULT '[]',
  created_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_reclog_domain_created
  ON recommendation_log(domain, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reclog_created
  ON recommendation_log(created_at DESC);
