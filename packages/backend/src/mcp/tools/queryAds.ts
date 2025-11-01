/**
 * MCP Tool: queryAds
 * Query and search advertisements
 * 
 * Supports:
 * - Semantic search (via query string) - TODO: Vectorize integration
 * - Geo-based filtering (latitude, longitude, radius)
 * - Age targeting filters
 * - Interest-based filtering
 * - Pagination
 * 
 * Input validation is handled by MCP SDK via Zod schemas in server.ts
 */

import type { Env } from '../../types/env';
import type { AdQueryParams, AdSearchResult } from '@threead/shared';
import * as dbService from '../../services/db';

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

    // Query ads from D1 database
    const result = await dbService.queryAds(env.DB, args);

    // TODO: Apply semantic search with Vectorize if query provided
    // This will be implemented in priority 2
    // For now, if a query is provided, we'll just return the D1 results
    // The semantic search will filter and rank results based on Vectorize similarity

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

