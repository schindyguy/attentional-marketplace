CREATE TABLE IF NOT EXISTS advertiser_domains (
  domain      TEXT PRIMARY KEY,
  dna_json    TEXT NOT NULL,
  analyzed_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS admin_discover_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO admin_discover_settings (key, value) VALUES
  ('result_count',       '10'),
  ('pinned_brand_keys',  '[]');
