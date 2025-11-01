/**
 * Shared ad creation service
 * Consolidates ad creation logic used by both REST API and MCP tools
 */

import type { Env } from '../types/env';
import type { CreateAdRequest, Ad } from '@threead/shared';
import { moderateAd } from './moderation';
import * as dbService from './db';
import { indexAd } from './vectorize';

export interface CreateAdResult {
  success: boolean;
  ad?: Ad;
  error?: string;
}

/**
 * Create a new ad (shared implementation for REST API and MCP)
 * During development, payment verification is bypassed
 */
export async function createAdService(
  adRequest: CreateAdRequest,
  env: Env,
  paymentTx?: string
): Promise<CreateAdResult> {
  try {
    // Generate ad ID and payment TX if not provided
    const adId = crypto.randomUUID();
    const finalPaymentTx = paymentTx || `dev-bypass-${adId}`;

    // TODO: Upload media to R2 if provided
    let mediaKey: string | undefined;
    if (adRequest.media) {
      // TODO: Implement R2 upload
      // For now, media upload is not supported
      return {
        success: false,
        error: 'Media upload not yet implemented',
      };
    }

    // Run moderation
    const moderation = await moderateAd(adRequest);

    // Create ad record
    const now = new Date();
    const expiry = new Date(now);
    expiry.setDate(expiry.getDate() + adRequest.days);

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
      payment_tx: finalPaymentTx,
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

    // Index in Vectorize for semantic search (non-blocking)
    // If indexing fails, ad creation still succeeds
    await indexAd(env, ad).catch(err => {
      console.error(`Failed to index ad ${ad.ad_id} in Vectorize:`, err);
    });

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

