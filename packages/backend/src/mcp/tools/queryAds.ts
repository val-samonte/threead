/**
 * MCP Tool: queryAds
 * Query and search advertisements
 * 
 * Supports:
 * - Semantic search (via query string) using Vectorize
 * - Geo-based filtering (latitude, longitude, radius)
 * - Age targeting filters
 * - Interest-based filtering
 * - Pagination
 * 
 * Input validation is handled by MCP SDK via Zod schemas in server.ts
 */

import type { Env } from '../../types/env';
import type { AdQueryParams, AdSearchResult, Ad } from '@threead/shared';
import * as dbService from '../../services/db';
import { semanticSearch } from '../../services/vectorize';

/**
 * Query ads via MCP
 * 
 * Note: Args are already validated by MCP SDK before reaching this handler
 */
export async function queryAdsTool(
  args: AdQueryParams,
  env: Env
): Promise<{
  success: boolean;
  result?: AdSearchResult;
  error?: string;
}> {
  try {
    // MCP SDK already validates input with Zod schema, so we can trust the types
    // Initialize database if needed
    await dbService.initializeDatabase(env.DB);

    // If a query string is provided, use Vectorize semantic search
    if (args.query) {
      // Perform semantic search with Vectorize
      // Vectorize limits topK to 50 when returnMetadata=true (which we use)
      // Cap at 50 to respect this limit - we fetch more than needed for filtering
      const topK = Math.min(args.limit ? args.limit * 3 : 100, 50);
      const vectorResults = await semanticSearch(env, args.query, {
        topK,
        filter: {
          visible: true,
          min_age: args.min_age,
          max_age: args.max_age,
          interests: args.interests,
          tags: args.tags,
          latitude: args.latitude,
          longitude: args.longitude,
          radius: args.radius,
        },
      });

      // Fetch full ad details from D1 for the matched IDs
      const adIds = vectorResults.map(r => r.id);
      if (adIds.length === 0) {
        return {
          success: true,
          result: {
            ads: [],
            total: 0,
            limit: args.limit || 50,
            offset: args.offset || 0,
          },
        };
      }

      // Get full ad objects from D1, preserving Vectorize ranking order
      const adsMap = new Map<string, Ad>();
      for (const adId of adIds) {
        const ad = await dbService.getAd(env.DB, adId);
        if (ad) {
          adsMap.set(adId, ad);
        }
      }

      // Re-order ads by Vectorize similarity score
      const ads = vectorResults
        .map(result => adsMap.get(result.id))
        .filter((ad): ad is Ad => ad !== undefined);

      // Apply pagination
      const limit = args.limit || 50;
      const offset = args.offset || 0;
      const paginatedAds = ads.slice(offset, offset + limit);

      return {
        success: true,
        result: {
          ads: paginatedAds as typeof ads,
          total: ads.length,
          limit,
          offset,
        },
      };
    }

    // No query string - use traditional D1 database query
    const result = await dbService.queryAds(env.DB, args);

    return {
      success: true,
      result,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to query ads: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

