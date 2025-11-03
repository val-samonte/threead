/**
 * MCP Tool: getAvailableTags
 * Get the list of available tags that can be used for categorizing ads
 * 
 * This tool helps agents understand what tags are available when creating or querying ads.
 * Tags are used for categorization and filtering of advertisements.
 */

import { AVAILABLE_TAGS } from '../../services/tags';

/**
 * Get available tags via MCP
 * 
 * Returns the list of tags that can be used for ad categorization and filtering.
 * These tags are used both when creating ads (AI auto-generates tags) and when
 * querying ads (filtering by tags).
 */
export async function getAvailableTagsTool(): Promise<{
  success: boolean;
  tags: readonly string[];
  count: number;
  description?: string;
}> {
  return {
    success: true,
    tags: AVAILABLE_TAGS,
    count: AVAILABLE_TAGS.length,
    description: 'Available tags for categorizing and filtering advertisements. These tags can be used in the queryAds tool to filter results, and are automatically assigned to ads during creation via AI analysis.',
  };
}

