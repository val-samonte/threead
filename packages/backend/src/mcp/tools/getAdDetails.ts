/**
 * MCP Tool: getAdDetails
 * Get detailed information about a specific advertisement by ID
 * 
 * Input validation is handled by MCP SDK via Zod schemas in server.ts
 */

import type { Env } from '../../types/env';
import * as dbService from '../../services/db';

/**
 * Get ad details via MCP
 * 
 * Note: Args are already validated by MCP SDK before reaching this handler
 */
export async function getAdDetailsTool(
  args: { ad_id: string },
  env: Env
): Promise<{
  success: boolean;
  ad?: unknown;
  error?: string;
}> {
  try {
    // MCP SDK already validates UUID format with Zod schema, so we can trust the types
    // Initialize database if needed
    await dbService.initializeDatabase(env.DB);

    // Get ad from database
    const ad = await dbService.getAd(env.DB, args.ad_id);
    
    if (!ad) {
      return {
        success: false,
        error: `Ad with ID ${args.ad_id} not found`,
      };
    }

    // Track impression (non-blocking)
    dbService.recordImpression(env.DB, {
      ad_id: args.ad_id,
      source: 'mcp',
    }).catch(err => {
      // Non-blocking - don't fail the query if tracking fails
      console.error('Failed to track MCP impression:', err);
    });

    return {
      success: true,
      ad,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to get ad: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

