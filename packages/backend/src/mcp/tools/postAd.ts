/**
 * MCP Tool: postAd
 * Creates a new advertisement
 * 
 * Note: During MCP development, payment verification is skipped.
 * Payment_tx field is set to a dev placeholder.
 */

import type { Env } from '../../types/env';
import type { CreateAdRequest, Ad } from '@threead/shared';
import { validateAdRequest } from '@threead/shared';
// import { calculateAdPricing } from '../../services/pricing'; // TODO: Uncomment when payment verification is re-enabled
import { moderateAd } from '../../services/moderation';
import * as dbService from '../../services/db';

/**
 * Post a new ad via MCP
 * Payment verification is skipped during development
 */
export async function postAdTool(
  args: unknown,
  env: Env
): Promise<{
  success: boolean;
  ad?: Ad;
  error?: string;
}> {
  try {
    // Validate input
    const validation = validateAdRequest(args);
    if (!validation.valid) {
      return {
        success: false,
        error: `Validation failed: ${validation.errors.join(', ')}`,
      };
    }

    const adRequest = args as CreateAdRequest;

    // TODO: Calculate pricing when payment verification is re-enabled
    // const pricing = calculateAdPricing(adRequest.days, !!adRequest.media);

    // Run moderation
    const moderation = await moderateAd(adRequest);

    // TODO: Upload media to R2 if provided
    let mediaKey: string | undefined;
    if (adRequest.media) {
      // TODO: Implement R2 upload
      // For now, skip media upload
      return {
        success: false,
        error: 'Media upload not yet implemented',
      };
    }

    // Create ad record
    const adId = crypto.randomUUID();
    const now = new Date();
    const expiry = new Date(now);
    expiry.setDate(expiry.getDate() + adRequest.days);

    // During MCP development, use placeholder payment_tx
    const payment_tx = `dev-bypass-${adId}`;

    const ad: Ad = {
      ad_id: adId,
      title: adRequest.title,
      description: adRequest.description,
      call_to_action: adRequest.call_to_action,
      link_url: adRequest.link_url,
      latitude: adRequest.latitude,
      longitude: adRequest.longitude,
      expiry: expiry.toISOString(),
      min_age: adRequest.min_age,
      max_age: adRequest.max_age,
      location: adRequest.location,
      interests: adRequest.interests?.join(','),
      payment_tx,
      media_key: mediaKey,
      created_at: now.toISOString(),
      moderation_score: moderation.score,
      visible: moderation.visible,
    };

    // Initialize database if needed
    await dbService.initializeDatabase(env.DB);

    // Store in D1 database
    try {
      await dbService.createAd(env.DB, ad);
    } catch (error) {
      return {
        success: false,
        error: `Failed to create ad: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }

    // TODO: Index in Vectorize for semantic search
    // This will be implemented in priority 2

    return {
      success: true,
      ad,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

