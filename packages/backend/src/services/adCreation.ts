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
  duplicate?: boolean; // Flag for duplicate key error (unique constraint violation)
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
      // Exception: For illegal content (score 0), empty tags are acceptable
      const tagResult = await generateTags(adRequest, env);
      
      if (!tagResult.success) {
        // If moderation already scored as 0 (illegal), empty tags are acceptable
        if (moderation.score === 0 && tagResult.tags && tagResult.tags.length === 0) {
          tags = [];
        } else {
          return {
            success: false,
            error: tagResult.error || 'Failed to generate tags. Tag generation is required for ad creation.',
            details: tagResult.details,
          };
        }
      } else if (!tagResult.tags || tagResult.tags.length === 0) {
        // If moderation already scored as 0 (illegal), empty tags are acceptable
        if (moderation.score === 0) {
          tags = [];
        } else {
          return {
            success: false,
            error: 'Failed to generate tags. Tag generation is required for ad creation.',
            details: tagResult.details,
          };
        }
      } else {
        tags = tagResult.tags;
      }
    } else {
      // Combined analysis succeeded - use results
      // For illegal content (score 0), tags may be empty - that's acceptable
      if (!aiResult.moderation) {
        return {
          success: false,
          error: aiResult.error || 'Combined AI analysis returned incomplete results',
          details: aiResult.details || 'Moderation missing from AI response',
        };
      }

      moderation = aiResult.moderation;
      // Use empty tags array if tags is undefined (for illegal content with score 0)
      // Illegal content (score 0) can have empty tags, but normal content must have tags
      if (!aiResult.tags || aiResult.tags.length === 0) {
        if (moderation.score === 0) {
          // Illegal content - empty tags are acceptable
          tags = [];
        } else {
          // Normal content must have tags
          return {
            success: false,
            error: 'Combined AI analysis returned incomplete results',
            details: 'Tags missing from AI response for non-illegal content',
          };
        }
      } else {
        tags = aiResult.tags;
      }
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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      // Check if this is a unique constraint violation (duplicate payment_tx)
      const isDuplicate = errorMessage.includes('UNIQUE constraint') || 
                          errorMessage.includes('duplicate') ||
                          errorMessage.includes('UNIQUE constraint failed');
      
      if (isDuplicate) {
        return {
          success: false,
          error: 'Payment already used',
          details: 'This payment transaction has already been used to create an ad',
          duplicate: true,
        };
      }
      
      return {
        success: false,
        error: `Failed to create ad: ${errorMessage}`,
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

