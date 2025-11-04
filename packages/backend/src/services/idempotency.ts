/**
 * Idempotency service
 * Prevents duplicate ad creation from the same payment transaction
 * 
 * Flow:
 * 1. Check if transaction signature was already processed
 * 2. If duplicate found, return existing ad
 * 3. If not duplicate, proceed with ad creation
 */

import type { Env } from '../types/env';
import type { Ad } from '@threead/shared';
import * as dbService from './db';

/**
 * Check if transaction signature was already processed
 * Prevents duplicate ad creation from same payment
 * 
 * @param txSignature - Transaction signature (base58)
 * @param env - Environment with database
 * @returns Object with processed flag and existing ad ID if found
 */
export async function checkTransactionAlreadyProcessed(
  txSignature: string,
  env: Env
): Promise<{ processed: boolean; existingAdId?: string; existingAd?: Ad }> {
  // Check database for existing ad with same payment_tx
  const existing = await env.DB.prepare(
    'SELECT ad_id FROM Ads WHERE payment_tx = ?'
  ).bind(txSignature).first<{ ad_id: string } | undefined>();
  
  if (existing) {
    // Fetch full ad details
    const existingAd = await dbService.getAd(env.DB, existing.ad_id);
    return { 
      processed: true, 
      existingAdId: existing.ad_id,
      existingAd: existingAd || undefined
    };
  }
  
  return { processed: false };
}

