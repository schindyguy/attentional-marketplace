-- Add schema_version to advertiser_domains so DNA cache can be invalidated
-- when the DNA shape evolves. Existing rows default to 1; current code writes 2
-- (adds audience_gender + age_skew). Reads with version < CURRENT trigger re-analysis.
ALTER TABLE advertiser_domains ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1;
