-- Three.ad Database Schema
-- Run with: wrangler d1 execute threead-db --file=scripts/migrate.sql
-- For remote: wrangler d1 execute threead-db --remote --file=scripts/migrate.sql

CREATE TABLE IF NOT EXISTS Ads (
    ad_id TEXT PRIMARY KEY,           -- UUID v4 string
    title TEXT NOT NULL,
    description TEXT,
    call_to_action TEXT,
    link_url TEXT,
    latitude REAL,
    longitude REAL,
    expiry DATETIME NOT NULL,         -- ISO 8601 (e.g., 2025-11-15T00:00:00Z)
    min_age INTEGER,
    max_age INTEGER,
    location TEXT,                    -- for semantics
    interests TEXT,                   -- "pizza,cheap,berkeley" (≤5)
    payment_tx TEXT NOT NULL,         -- Solana tx signature (x402 proof)
    media_key TEXT,                   -- R2 object key
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    moderation_score INTEGER NOT NULL DEFAULT 10,  -- 0–10, AI judged
    visible BOOLEAN NOT NULL DEFAULT 1             -- shadow ban flag
);

-- Index for fast semantic + geo + expiry cleanup
CREATE INDEX IF NOT EXISTS idx_visible_expiry ON Ads(visible, expiry);
CREATE INDEX IF NOT EXISTS idx_location ON Ads(location);
CREATE INDEX IF NOT EXISTS idx_interests ON Ads(interests);
CREATE INDEX IF NOT EXISTS idx_geo ON Ads(latitude, longitude);

