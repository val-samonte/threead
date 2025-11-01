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

