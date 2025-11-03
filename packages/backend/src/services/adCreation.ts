/**
 * Shared ad creation service
 * Consolidates ad creation logic used by both REST API and MCP tools
 */

import type { Env } from '../types/env';
import type { CreateAdRequest, Ad } from '@threead/shared';
import { moderateAd } from './moderation';
import { generateTags } from './tags';
import { analyzeAdWithAI } from './aiAnalysis';
import * as dbService from './db';
import { indexAd } from './vectorize';

export interface CreateAdResult {
  success: boolean;
  ad?: Ad;
  error?: string;
  details?: string;
}

/**
 * Create a new ad (shared implementation for REST API and MCP)
 * This creates the ad WITHOUT payment verification (payment verification happens after)
 * @param adRequest - The ad creation request (user-provided data)
 * @param author - The Solana address of the ad creator (extracted from payment transaction)
 * @param env - Environment with database and services
 * @param paymentTx - Payment transaction signature (from adRequest.payment_tx)
 */
export async function createAdService(
  adRequest: CreateAdRequest,
  author: string,
  env: Env,
  paymentTx: string
): Promise<CreateAdResult> {
  try {
    // Generate ad ID
    const adId = crypto.randomUUID();

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

    // Use combined AI analysis (moderation + tagging) in a single call for better performance
    const aiResult = await analyzeAdWithAI(adRequest, env);

    let moderation: { score: number; visible: boolean };
    let tags: string[];

    if (!aiResult.success) {
      // Fallback to separate calls if combined fails
      console.warn('[createAdService] Combined AI analysis failed, falling back to separate calls:', aiResult.error);
      
      // Run moderation with AI (if available)
      // If moderation fails, default to visible with score 10 (fail open)
      try {
        moderation = await moderateAd(adRequest, env);
      } catch (error) {
        console.error('Failed to moderate ad:', error);
        // Fail open - default to visible with score 10 if moderation fails
        moderation = {
          score: 10,
          visible: true,
        };
      }

      // Generate tags with AI - MANDATORY: fail if tag generation fails
      const tagResult = await generateTags(adRequest, env);
      
      if (!tagResult.success || !tagResult.tags || tagResult.tags.length === 0) {
        return {
          success: false,
          error: tagResult.error || 'Failed to generate tags. Tag generation is required for ad creation.',
          details: tagResult.details,
        };
      }

      tags = tagResult.tags;
    } else {
      // Combined analysis succeeded - use results
      if (!aiResult.moderation || !aiResult.tags || aiResult.tags.length === 0) {
        return {
          success: false,
          error: aiResult.error || 'Combined AI analysis returned incomplete results',
          details: aiResult.details || 'Moderation or tags missing from AI response',
        };
      }

      moderation = aiResult.moderation;
      tags = aiResult.tags;
    }

    // Create ad record
    const now = new Date();
    const expiry = new Date(now);
    expiry.setDate(expiry.getDate() + adRequest.days);

    const ad: Ad = {
      ad_id: adId,
      author,
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
      tags: tags,
      payment_tx: paymentTx,
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

