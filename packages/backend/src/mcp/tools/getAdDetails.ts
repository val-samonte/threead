/**
 * MCP Tool: getAdDetails
 * Get detailed information about a specific advertisement by ID
 */

import type { Env } from '../../types/env';
import * as dbService from '../../services/db';

/**
 * Get ad details via MCP
 */
export async function getAdDetailsTool(
  args: unknown,
  env: Env
): Promise<{
  success: boolean;
  ad?: unknown;
  error?: string;
}> {
  try {
    // Validate input
    if (!args || typeof args !== 'object') {
      return {
        success: false,
        error: 'Invalid arguments: expected object with ad_id',
      };
    }

    const { ad_id } = args as { ad_id?: string };

    if (!ad_id || typeof ad_id !== 'string') {
      return {
        success: false,
        error: 'ad_id is required and must be a string',
      };
    }

    // Initialize database if needed
    await dbService.initializeDatabase(env.DB);

    // Get ad from database
    try {
      const ad = await dbService.getAd(env.DB, ad_id);
      
      if (!ad) {
        return {
          success: false,
          error: `Ad with ID ${ad_id} not found`,
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
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

