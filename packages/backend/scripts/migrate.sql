-- Three.ad Database Schema
-- Run with: wrangler d1 execute threead-db --file=scripts/migrate.sql
-- For remote: wrangler d1 execute threead-db --remote --file=scripts/migrate.sql

CREATE TABLE IF NOT EXISTS Ads (
    ad_id TEXT PRIMARY KEY,           -- UUID v4 string
    author TEXT NOT NULL,             -- Solana public key (wallet address) of ad creator
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
    tags TEXT,                        -- AI-generated tags, comma-separated (≤5), e.g., "job,services,product"
    payment_tx TEXT NOT NULL,         -- Solana tx signature (x402 proof)
    media_key TEXT,                   -- R2 object key
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    moderation_score INTEGER NOT NULL DEFAULT 10,  -- 0–10, AI judged
    visible BOOLEAN NOT NULL DEFAULT 1             -- shadow ban flag
);

-- Index for fast semantic + geo + expiry cleanup
CREATE INDEX IF NOT EXISTS idx_visible_expiry ON Ads(visible, expiry);
CREATE INDEX IF NOT EXISTS idx_author ON Ads(author);
CREATE INDEX IF NOT EXISTS idx_location ON Ads(location);
CREATE INDEX IF NOT EXISTS idx_interests ON Ads(interests);
CREATE INDEX IF NOT EXISTS idx_tags ON Ads(tags);
CREATE INDEX IF NOT EXISTS idx_geo ON Ads(latitude, longitude);

-- Unique index on payment_tx for idempotency (prevents duplicate ad creation from same payment)
-- This is a safety net for race conditions - should not trigger in normal flow
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_tx ON Ads(payment_tx);

-- Impressions tracking table
CREATE TABLE IF NOT EXISTS Impressions (
    impression_id TEXT PRIMARY KEY,      -- UUID v4 string
    ad_id TEXT NOT NULL,                 -- Foreign key to Ads.ad_id
    source TEXT NOT NULL,                 -- 'mcp' or 'app'
    user_agent TEXT,                     -- Browser/agent string
    referrer TEXT,                       -- Referrer URL
    ip_address TEXT,                     -- Client IP (hashed for privacy)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (ad_id) REFERENCES Ads(ad_id) ON DELETE CASCADE
);

-- Indexes for impressions queries
CREATE INDEX IF NOT EXISTS idx_impressions_ad_id ON Impressions(ad_id);
CREATE INDEX IF NOT EXISTS idx_impressions_source ON Impressions(source);
CREATE INDEX IF NOT EXISTS idx_impressions_created_at ON Impressions(created_at);
-- Composite index for deduplication: check same ad_id + ip_address + user_agent within time window
CREATE INDEX IF NOT EXISTS idx_impressions_dedup ON Impressions(ad_id, ip_address, user_agent, created_at);

-- Clicks tracking table (tracks when users click the ad link)
CREATE TABLE IF NOT EXISTS Clicks (
    click_id TEXT PRIMARY KEY,            -- UUID v4 string
    ad_id TEXT NOT NULL,                 -- Foreign key to Ads.ad_id
    source TEXT NOT NULL,                 -- 'mcp' or 'app'
    user_agent TEXT,                     -- Browser/agent string
    referrer TEXT,                       -- Referrer URL
    ip_address TEXT,                      -- Client IP (hashed for privacy)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (ad_id) REFERENCES Ads(ad_id) ON DELETE CASCADE
);

-- Indexes for clicks queries
CREATE INDEX IF NOT EXISTS idx_clicks_ad_id ON Clicks(ad_id);
CREATE INDEX IF NOT EXISTS idx_clicks_source ON Clicks(source);
CREATE INDEX IF NOT EXISTS idx_clicks_created_at ON Clicks(created_at);
-- Composite index for click deduplication (optional - same logic as impressions if needed)
CREATE INDEX IF NOT EXISTS idx_clicks_dedup ON Clicks(ad_id, ip_address, user_agent, created_at);

