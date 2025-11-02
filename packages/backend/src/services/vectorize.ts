/**
 * Vectorize service for semantic search
 * Uses Cloudflare Workers AI for embeddings and Vectorize for storage
 */

import type { Env } from '../types/env';
import type { Ad } from '@threead/shared';

/**
 * Generate embedding vector for text using Cloudflare Workers AI
 * Uses @cf/meta/all-minilm-l6-v2 model (384 dimensions)
 * Note: Model name may not be in type definitions, so we use type assertion
 */
async function generateEmbedding(env: Env, text: string): Promise<number[]> {
  // Cloudflare Workers AI binding (AI) is available in env
  // Use the text embedding model
  // Type assertion needed as model may not be in type definitions yet
  const response = await (env.AI.run as any)('@cf/baai/bge-small-en-v1.5', {
    text: [text],
  });

  // Extract the embedding vector from the response
  // Workers AI embedding models return embeddings in various formats:
  // - Direct array: number[]
  // - Nested array: number[][]
  // - Wrapped: { shape: [1, 384], data: number[][] }
  
  // Try direct array first (most common)
  if (Array.isArray(response)) {
    if (response.length > 0 && typeof response[0] === 'number') {
      // It's a flat array of numbers
      return response as number[];
    }
    if (response.length > 0 && Array.isArray(response[0])) {
      // It's an array of arrays, take the first one
      return response[0] as number[];
    }
  }
  
  // Try data field (wrapped format)
  if (response && typeof response === 'object' && 'data' in response) {
    const data = (response as { data: unknown }).data;
    if (Array.isArray(data)) {
      if (data.length > 0 && typeof data[0] === 'number') {
        return data as number[];
      }
      if (data.length > 0 && Array.isArray(data[0])) {
        return data[0] as number[];
      }
    }
  }

  throw new Error(`Failed to extract embedding from Workers AI response. Got: ${JSON.stringify(response).substring(0, 200)}`);
}

/**
 * Build text representation of ad for semantic search
 * Combines title, description, location, interests, and tags
 */
function buildAdText(ad: Ad): string {
  const parts: string[] = [];
  
  if (ad.title) parts.push(ad.title);
  if (ad.description) parts.push(ad.description);
  if (ad.location) parts.push(ad.location);
  if (ad.interests) parts.push(ad.interests);
  if (ad.call_to_action) parts.push(ad.call_to_action);
  if (ad.tags && ad.tags.length > 0) parts.push(ad.tags.join(' '));
  
  return parts.join(' ').trim();
}

/**
 * Index an ad in Vectorize for semantic search
 * Creates an embedding and stores it with metadata
 */
export async function indexAd(env: Env, ad: Ad): Promise<void> {
  try {
    // Verify Vectorize binding is available
    if (!env.VECTORIZE) {
      throw new Error('VECTORIZE binding is not available. Make sure to run wrangler dev with --experimental-vectorize-bind-to-prod flag');
    }

    // Build text representation
    const adText = buildAdText(ad);
    if (!adText) {
      console.warn(`Ad ${ad.ad_id} has no text content to index`);
      return;
    }

    // Generate embedding
    const embedding = await generateEmbedding(env, adText);

    // Prepare metadata for filtering
    // VectorizeVectorMetadata = VectorizeVectorMetadataValue | Record<string, VectorizeVectorMetadataValue>
    // where VectorizeVectorMetadataValue = string | number | boolean | string[]
    // Note: Vectorize may accept null in practice even if types don't include it
    const metadata: Record<string, string | number | boolean | string[] | null> = {
      ad_id: ad.ad_id,
      visible: ad.visible ? 1 : 0,
      expiry: ad.expiry,
      min_age: ad.min_age ?? null,
      max_age: ad.max_age ?? null,
      latitude: ad.latitude ?? null,
      longitude: ad.longitude ?? null,
      interests: ad.interests ?? null,
      tags: ad.tags && ad.tags.length > 0 ? ad.tags.join(',') : null,
      moderation_score: ad.moderation_score,
    };

    // Upsert into Vectorize
    // Using ad_id as the id for easy updates
    // Type assertion needed as metadata may contain null which types don't officially support
    // Vectorize upsert completes synchronously, but getByIds may have eventual consistency
    // We verify indexing via successful upsert completion (no error thrown)
    await env.VECTORIZE.upsert([
      {
        id: ad.ad_id,
        values: embedding,
        metadata: metadata as any,
      },
    ]);
    
    // Log success - upsert completion means the vector is indexed
    // Note: getByIds may have eventual consistency in remote Vectorize, so we don't verify via getByIds
    // Indexing is verified by successful upsert (no exception thrown)
    console.log(`Successfully indexed ad ${ad.ad_id} in Vectorize. Embedding dims: ${embedding.length}`);
  } catch (error) {
    // Log full error details for debugging
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error(`Failed to index ad ${ad.ad_id} in Vectorize:`, errorMsg, errorStack);
    // Don't throw - ad creation should succeed even if indexing fails
    // Vectorize is for search optimization, not critical path
  }
}

/**
 * Query Vectorize for semantically similar ads
 * Returns ad IDs ranked by similarity
 */
export async function semanticSearch(
  env: Env,
  query: string,
  options: {
    topK?: number;
    filter?: {
      visible?: boolean;
      min_age?: number;
      max_age?: number;
      interests?: string[];
      tags?: string[];
      latitude?: number;
      longitude?: number;
      radius?: number; // in km
    };
  } = {}
): Promise<Array<{ id: string; score: number; metadata: Record<string, unknown> }>> {
  try {
    // Verify Vectorize binding is available
    if (!env.VECTORIZE) {
      throw new Error('VECTORIZE binding is not available. Make sure to run wrangler dev with --experimental-vectorize-bind-to-prod flag');
    }

    // Generate embedding for query
    const queryEmbedding = await generateEmbedding(env, query);

    // Build filter for Vectorize query
    // Metadata indexes must be created first (see wrangler.toml for commands)
    // Vectors upserted before metadata index creation won't be filterable on that field
    // Reference: https://developers.cloudflare.com/vectorize/reference/metadata-filtering/
    const vectorizeFilter: Record<string, string | number | boolean | null> = {};
    
    // Use Vectorize metadata filtering (requires metadata indexes created via wrangler CLI)
    if (options.filter?.visible !== undefined) {
      // Direct equality - Vectorize supports implicit $eq for numbers
      vectorizeFilter.visible = options.filter.visible ? 1 : 0;
    }

    // Execute similarity search with Vectorize metadata filters
    // Vectorize limits topK to 50 when returnMetadata=true
    // Cap topK at 50 to avoid VECTOR_QUERY_ERROR
    const topK = Math.min(options.topK || 50, 50);
    
    // Query with Vectorize filters for better performance (filters at the index level)
    const queryResult = await env.VECTORIZE.query(queryEmbedding, {
      topK,
      filter: Object.keys(vectorizeFilter).length > 0 ? (vectorizeFilter as any) : undefined,
      returnMetadata: true,
      returnValues: false,
    });
    
    // Log query results for debugging
    const matchCount = queryResult.matches?.length || 0;
    console.log(`Vectorize query returned ${matchCount} matches${Object.keys(vectorizeFilter).length > 0 ? ` (filter: ${JSON.stringify(vectorizeFilter)})` : ''}`);
    
    // Debug: Log first few match IDs if debugging is needed
    if (matchCount > 0 && queryResult.matches) {
      const firstFewIds = queryResult.matches.slice(0, 5).map(m => m.id).join(', ');
      console.log(`First 5 Vectorize match IDs: ${firstFewIds}${matchCount > 5 ? '...' : ''}`);
    }

    // Filter results by additional criteria (age, geo, interests)
    // Note: visible filtering is now handled by Vectorize metadata filters (more efficient)
    let results = queryResult.matches || [];
    
    // Double-check visible flag from Vectorize metadata in case metadata filtering didn't work
    // This can happen if metadata indexes weren't created or ads were indexed before index creation
    if (options.filter?.visible !== undefined) {
      const beforeFilterCount = results.length;
      results = results.filter(match => {
        const visible = match.metadata?.visible;
        // Vectorize stores visible as 1 or 0, but could also be boolean in some cases
        const isVisible = visible === 1 || visible === true;
        return isVisible === options.filter!.visible;
      });
      if (results.length !== beforeFilterCount) {
        console.warn(`Vectorize metadata filter didn't fully apply - filtered ${beforeFilterCount} to ${results.length} results by visible flag`);
        // Debug: Log IDs that were filtered out
        const filteredOut = queryResult.matches?.filter(m => {
          const visible = m.metadata?.visible;
          const isVisible = visible === 1 || visible === true;
          return isVisible !== options.filter!.visible;
        }).map(m => m.id) || [];
        console.warn(`Filtered out ${filteredOut.length} ads with visible flag mismatch: ${filteredOut.slice(0, 5).join(', ')}${filteredOut.length > 5 ? '...' : ''}`);
      }
    }

    // Apply age filtering
    if (options.filter?.min_age !== undefined) {
      results = results.filter(match => {
        const maxAge = match.metadata?.max_age;
        if (maxAge === null || maxAge === undefined) return true;
        if (typeof maxAge !== 'number') return false;
        return maxAge >= options.filter!.min_age!;
      });
    }
    if (options.filter?.max_age !== undefined) {
      results = results.filter(match => {
        const minAge = match.metadata?.min_age;
        if (minAge === null || minAge === undefined) return true;
        if (typeof minAge !== 'number') return false;
        return minAge <= options.filter!.max_age!;
      });
    }

    // Apply interests filtering
    if (options.filter?.interests && options.filter.interests.length > 0) {
      results = results.filter(match => {
        const adInterests = match.metadata?.interests as string | null | undefined;
        if (!adInterests) return false;
        const interestList = adInterests.split(',');
        return options.filter!.interests!.some(interest => interestList.includes(interest));
      });
    }

    // Apply tags filtering
    if (options.filter?.tags && options.filter.tags.length > 0) {
      results = results.filter(match => {
        const adTags = match.metadata?.tags as string | null | undefined;
        if (!adTags) return false;
        const tagList = adTags.split(',');
        return options.filter!.tags!.some(tag => tagList.includes(tag));
      });
    }

    // Apply geo filtering (filter by distance after Vectorize returns results)
    // Note: We do a bounding box filter in the Vectorize query if possible,
    // but exact distance calculation happens here
    if (options.filter?.latitude !== undefined && 
        options.filter?.longitude !== undefined && 
        options.filter?.radius !== undefined) {
      results = results
        .map(match => {
          const lat = match.metadata?.latitude as number | null | undefined;
          const lon = match.metadata?.longitude as number | null | undefined;
          if (lat === null || lat === undefined || lon === null || lon === undefined) {
            return { match, distance: Infinity };
          }
          const distance = calculateDistance(
            options.filter!.latitude!,
            options.filter!.longitude!,
            lat,
            lon
          );
          return { match, distance };
        })
        .filter(item => item.distance <= options.filter!.radius!)
        .sort((a, b) => a.distance - b.distance)
        .map(item => item.match);
    }

    // Filter by expiry (only show non-expired ads)
    const now = new Date().toISOString();
    results = results.filter(match => {
      const expiry = match.metadata?.expiry as string | null | undefined;
      return expiry && expiry > now;
    });

    return results.map(match => ({
      id: match.id as string,
      score: match.score || 0,
      metadata: match.metadata || {},
    }));
  } catch (error) {
    console.error('Failed to perform semantic search:', error);
    // Return empty results rather than throwing
    // Allows fallback to D1 keyword search
    return [];
  }
}

/**
 * Delete ad from Vectorize index
 */
export async function deleteAdIndex(env: Env, adId: string): Promise<void> {
  try {
    await env.VECTORIZE.deleteByIds([adId]);
  } catch (error) {
    console.error(`Failed to delete ad ${adId} from Vectorize:`, error);
    // Don't throw - deletion should succeed even if Vectorize cleanup fails
  }
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

