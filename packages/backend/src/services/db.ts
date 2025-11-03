/**
 * D1 Database service layer
 * Handles all SQL operations for ads
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { Ad, AdQueryParams, AdSearchResult } from '@threead/shared';

/**
 * Initialize database schema
 */
export async function initializeDatabase(db: D1Database): Promise<void> {
  // Create table - includes author and tags from the start (no migrations needed)
  await db.exec(
    'CREATE TABLE IF NOT EXISTS Ads (ad_id TEXT PRIMARY KEY, author TEXT NOT NULL, title TEXT NOT NULL, description TEXT, call_to_action TEXT, link_url TEXT, latitude REAL, longitude REAL, expiry DATETIME NOT NULL, min_age INTEGER, max_age INTEGER, location TEXT, interests TEXT, tags TEXT, payment_tx TEXT NOT NULL, media_key TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, moderation_score INTEGER NOT NULL DEFAULT 10, visible BOOLEAN NOT NULL DEFAULT 1)'
  );

  // Create indexes
  await db.exec('CREATE INDEX IF NOT EXISTS idx_visible_expiry ON Ads(visible, expiry)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_author ON Ads(author)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_location ON Ads(location)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_interests ON Ads(interests)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_tags ON Ads(tags)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_geo ON Ads(latitude, longitude)');

  // Create Impressions table
  await db.exec(
    'CREATE TABLE IF NOT EXISTS Impressions (impression_id TEXT PRIMARY KEY, ad_id TEXT NOT NULL, source TEXT NOT NULL, user_agent TEXT, referrer TEXT, ip_address TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (ad_id) REFERENCES Ads(ad_id) ON DELETE CASCADE)'
  );

  // Create indexes for Impressions
  await db.exec('CREATE INDEX IF NOT EXISTS idx_impressions_ad_id ON Impressions(ad_id)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_impressions_source ON Impressions(source)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_impressions_created_at ON Impressions(created_at)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_impressions_dedup ON Impressions(ad_id, ip_address, user_agent, created_at)');

  // Create Clicks table
  await db.exec(
    'CREATE TABLE IF NOT EXISTS Clicks (click_id TEXT PRIMARY KEY, ad_id TEXT NOT NULL, source TEXT NOT NULL, user_agent TEXT, referrer TEXT, ip_address TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (ad_id) REFERENCES Ads(ad_id) ON DELETE CASCADE)'
  );

  // Create indexes for Clicks
  await db.exec('CREATE INDEX IF NOT EXISTS idx_clicks_ad_id ON Clicks(ad_id)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_clicks_source ON Clicks(source)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_clicks_created_at ON Clicks(created_at)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_clicks_dedup ON Clicks(ad_id, ip_address, user_agent, created_at)');
}

/**
 * Create a new ad
 */
export async function createAd(db: D1Database, ad: Ad): Promise<void> {
  await db.prepare(`
    INSERT INTO Ads (
      ad_id, author, title, description, call_to_action, link_url,
      latitude, longitude, expiry, min_age, max_age,
      location, interests, tags, payment_tx, media_key,
      created_at, moderation_score, visible
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    ad.ad_id,
    ad.author,
    ad.title,
    ad.description || null,
    ad.call_to_action || null,
    ad.link_url || null,
    ad.latitude || null,
    ad.longitude || null,
    ad.expiry,
    ad.min_age || null,
    ad.max_age || null,
    ad.location || null,
    ad.interests || null,
    ad.tags?.join(',') || null,
    ad.payment_tx,
    ad.media_key || null,
    ad.created_at,
    ad.moderation_score,
    ad.visible ? 1 : 0
  ).run();
}

/**
 * Get ad by ID
 */
export async function getAd(db: D1Database, adId: string): Promise<Ad | null> {
  const result = await db.prepare(`
    SELECT * FROM Ads WHERE ad_id = ?
  `).bind(adId).first<Record<string, unknown>>();

  if (!result) return null;

  // Parse tags from comma-separated string to array
  const tags = result.tags
    ? (result.tags as string).split(',').filter(tag => tag.trim().length > 0)
    : undefined;

  return {
    ...result,
    tags,
    visible: (result.visible as number) === 1,
  } as Ad;
}

/**
 * Query ads with filters and geo search
 */
export async function queryAds(
  db: D1Database,
  params: AdQueryParams
): Promise<AdSearchResult> {
  let query = 'SELECT * FROM Ads WHERE visible = 1 AND expiry > datetime("now")';
  const bindings: unknown[] = [];

  // Age filters
  if (params.min_age !== undefined) {
    query += ' AND (min_age IS NULL OR min_age <= ?)';
    bindings.push(params.min_age);
  }
  if (params.max_age !== undefined) {
    query += ' AND (max_age IS NULL OR max_age >= ?)';
    bindings.push(params.max_age);
  }

  // Interests filter
  if (params.interests && params.interests.length > 0) {
    const interestPlaceholders = params.interests.map(() => '?').join(',');
    query += ` AND interests IN (${interestPlaceholders})`;
    bindings.push(...params.interests);
  }

  // Tags filter
  if (params.tags && params.tags.length > 0) {
    // For comma-separated tags, check if any tag matches
    // Using LIKE for pattern matching since tags are comma-separated
    const tagConditions = params.tags.map(() => 'tags LIKE ?').join(' OR ');
    query += ` AND (${tagConditions})`;
    bindings.push(...params.tags.map(tag => `%${tag}%`));
  }

  // Geo distance filter (using Haversine formula approximation)
  if (params.latitude !== undefined && params.longitude !== undefined && params.radius !== undefined) {
    // SQLite doesn't have built-in geo functions, but we can use approximation
    // For exact distance, we'll calculate in JavaScript after fetching
    // For now, we'll do a bounding box filter for performance
    const latRange = params.radius / 111; // ~111 km per degree latitude
    const lonRange = params.radius / (111 * Math.cos(params.latitude * Math.PI / 180));
    
    query += ` AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?`;
    bindings.push(
      params.latitude - latRange,
      params.latitude + latRange,
      params.longitude - lonRange,
      params.longitude + lonRange
    );
  }

  query += ' ORDER BY created_at DESC';
  
  const limit = params.limit || 50;
  const offset = params.offset || 0;
  query += ` LIMIT ? OFFSET ?`;
  bindings.push(limit, offset);

  const result = await db.prepare(query).bind(...bindings).all<Record<string, unknown>>();

  let ads = (result.results || []).map(ad => {
    // Parse tags from comma-separated string to array
    const tags = ad.tags
      ? (ad.tags as string).split(',').filter(tag => tag.trim().length > 0)
      : undefined;

    return {
      ...ad,
      tags,
      visible: (ad.visible as number) === 1,
    } as Ad;
  });

  // Calculate actual distance for geo queries and sort
  if (params.latitude !== undefined && params.longitude !== undefined && params.radius !== undefined) {
    ads = ads
      .map(ad => ({
        ad,
        distance: calculateDistance(
          params.latitude!,
          params.longitude!,
          ad.latitude || 0,
          ad.longitude || 0
        ),
      }))
      .filter(item => item.distance <= params.radius!)
      .sort((a, b) => a.distance - b.distance)
      .map(item => item.ad);
  }

  // Get total count (without pagination)
  const countQuery = query.replace(/SELECT \*/, 'SELECT COUNT(*) as count').replace(/LIMIT \? OFFSET \?/, '').replace(/ORDER BY.*$/, '');
  const countBindings = bindings.slice(0, -2); // Remove limit and offset
  const countResult = await db.prepare(countQuery).bind(...countBindings).first<{ count: number }>();
  const total = countResult?.count || 0;

  return {
    ads,
    total,
    limit,
    offset,
  };
}

/**
 * Calculate distance between two points using Haversine formula
 * Returns distance in kilometers
 */
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Update ad
 */
export async function updateAd(db: D1Database, adId: string, updates: Partial<Ad>): Promise<Ad | null> {
  const existing = await getAd(db, adId);
  if (!existing) return null;

  const updated = { ...existing, ...updates };

  await db.prepare(`
    UPDATE Ads SET
      author = ?, title = ?, description = ?, call_to_action = ?, link_url = ?,
      latitude = ?, longitude = ?, expiry = ?, min_age = ?, max_age = ?,
      location = ?, interests = ?, tags = ?, media_key = ?,
      moderation_score = ?, visible = ?
    WHERE ad_id = ?
  `).bind(
    updated.author,
    updated.title,
    updated.description || null,
    updated.call_to_action || null,
    updated.link_url || null,
    updated.latitude || null,
    updated.longitude || null,
    updated.expiry,
    updated.min_age || null,
    updated.max_age || null,
    updated.location || null,
    updated.interests || null,
    updated.tags?.join(',') || null,
    updated.media_key || null,
    updated.moderation_score,
    updated.visible ? 1 : 0,
    adId
  ).run();

  return updated;
}

/**
 * Delete ad
 */
export async function deleteAd(db: D1Database, adId: string): Promise<boolean> {
  const result = await db.prepare(`
    DELETE FROM Ads WHERE ad_id = ?
  `).bind(adId).run();

  return result.success;
}

/**
 * Cleanup expired ads
 */
export async function cleanupExpired(db: D1Database): Promise<number> {
  const result = await db.prepare(`
    DELETE FROM Ads WHERE expiry < datetime("now")
  `).run();

  return result.meta.changes || 0;
}

/**
 * Impression tracking
 */
export interface ImpressionData {
  ad_id: string;
  source: 'mcp' | 'app';
  user_agent?: string;
  referrer?: string;
  ip_address?: string;
}

/**
 * Record an impression with deduplication
 * Only records if no impression exists for the same ad_id + IP + user_agent within the last 30 minutes
 */
export async function recordImpression(
  db: D1Database,
  data: ImpressionData
): Promise<boolean> {
  // Check for existing impression within 30 minutes (deduplication window)
  if (data.ip_address && data.user_agent) {
    const existing = await db.prepare(`
      SELECT impression_id FROM Impressions
      WHERE ad_id = ? 
        AND ip_address = ? 
        AND user_agent = ?
        AND created_at > datetime('now', '-30 minutes')
      LIMIT 1
    `).bind(data.ad_id, data.ip_address, data.user_agent).first<{ impression_id: string }>();

    // If duplicate found within time window, skip recording
    if (existing) {
      return false;
    }
  }

  // Record new impression
  const impressionId = crypto.randomUUID();
  
  await db.prepare(`
    INSERT INTO Impressions (
      impression_id, ad_id, source, user_agent, referrer, ip_address
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    impressionId,
    data.ad_id,
    data.source,
    data.user_agent || null,
    data.referrer || null,
    data.ip_address || null
  ).run();

  return true;
}

/**
 * Get impression count for an ad
 */
export async function getImpressionCount(
  db: D1Database,
  adId: string,
  source?: 'mcp' | 'app'
): Promise<number> {
  let query = 'SELECT COUNT(*) as count FROM Impressions WHERE ad_id = ?';
  const bindings: unknown[] = [adId];
  
  if (source) {
    query += ' AND source = ?';
    bindings.push(source);
  }
  
  const result = await db.prepare(query).bind(...bindings).first<{ count: number }>();
  return result?.count || 0;
}

/**
 * Batch record impressions (for MCP queries that return multiple ads)
 * Applies deduplication logic to each impression
 */
export async function recordImpressions(
  db: D1Database,
  impressions: ImpressionData[]
): Promise<number> {
  if (impressions.length === 0) return 0;
  
  let recorded = 0;
  
  // Process each impression with deduplication
  for (const data of impressions) {
    const wasRecorded = await recordImpression(db, data);
    if (wasRecorded) {
      recorded++;
    }
  }
  
  return recorded;
}

/**
 * Click tracking
 */
export interface ClickData {
  ad_id: string;
  source: 'mcp' | 'app';
  user_agent?: string;
  referrer?: string;
  ip_address?: string;
}

/**
 * Record a click with deduplication
 * Only records if no click exists for the same ad_id + IP + user_agent within the last 30 minutes
 */
export async function recordClick(
  db: D1Database,
  data: ClickData
): Promise<boolean> {
  // Check for existing click within 30 minutes (deduplication window)
  if (data.ip_address && data.user_agent) {
    const existing = await db.prepare(`
      SELECT click_id FROM Clicks
      WHERE ad_id = ? 
        AND ip_address = ? 
        AND user_agent = ?
        AND created_at > datetime('now', '-30 minutes')
      LIMIT 1
    `).bind(data.ad_id, data.ip_address, data.user_agent).first<{ click_id: string }>();

    // If duplicate found within time window, skip recording but still return true (click happened)
    if (existing) {
      return false;
    }
  }

  // Record new click
  const clickId = crypto.randomUUID();
  
  await db.prepare(`
    INSERT INTO Clicks (
      click_id, ad_id, source, user_agent, referrer, ip_address
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    clickId,
    data.ad_id,
    data.source,
    data.user_agent || null,
    data.referrer || null,
    data.ip_address || null
  ).run();

  return true;
}

/**
 * Get click count for an ad
 */
export async function getClickCount(
  db: D1Database,
  adId: string,
  source?: 'mcp' | 'app'
): Promise<number> {
  let query = 'SELECT COUNT(*) as count FROM Clicks WHERE ad_id = ?';
  const bindings: unknown[] = [adId];
  
  if (source) {
    query += ' AND source = ?';
    bindings.push(source);
  }
  
  const result = await db.prepare(query).bind(...bindings).first<{ count: number }>();
  return result?.count || 0;
}

