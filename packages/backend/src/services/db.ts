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
  // Create table - use single line SQL to avoid parsing issues
  await db.exec(
    'CREATE TABLE IF NOT EXISTS Ads (ad_id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, call_to_action TEXT, link_url TEXT, latitude REAL, longitude REAL, expiry DATETIME NOT NULL, min_age INTEGER, max_age INTEGER, location TEXT, interests TEXT, payment_tx TEXT NOT NULL, media_key TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, moderation_score INTEGER NOT NULL DEFAULT 10, visible BOOLEAN NOT NULL DEFAULT 1)'
  );

  // Create indexes separately
  await db.exec('CREATE INDEX IF NOT EXISTS idx_visible_expiry ON Ads(visible, expiry)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_location ON Ads(location)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_interests ON Ads(interests)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_geo ON Ads(latitude, longitude)');
}

/**
 * Create a new ad
 */
export async function createAd(db: D1Database, ad: Ad): Promise<void> {
  await db.prepare(`
    INSERT INTO Ads (
      ad_id, title, description, call_to_action, link_url,
      latitude, longitude, expiry, min_age, max_age,
      location, interests, payment_tx, media_key,
      created_at, moderation_score, visible
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    ad.ad_id,
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

  return {
    ...result,
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

  let ads = (result.results || []).map(ad => ({
    ...ad,
    visible: (ad.visible as number) === 1,
  })) as Ad[];

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
      title = ?, description = ?, call_to_action = ?, link_url = ?,
      latitude = ?, longitude = ?, expiry = ?, min_age = ?, max_age = ?,
      location = ?, interests = ?, media_key = ?,
      moderation_score = ?, visible = ?
    WHERE ad_id = ?
  `).bind(
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

