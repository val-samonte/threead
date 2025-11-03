/**
 * Shared ad creation flow with payment verification
 * Used by both REST API and MCP server to avoid code duplication
 * 
 * Flow:
 * 1. Extract payer address from payment transaction
 * 2. Check payer's USDC balance (reject if insufficient)
 * 3. Process the ad (AI stuff: tags, moderation, DB insert, Vectorize indexing)
 * 4. Verify payment transaction
 * 5. Rollback ad if payment verification fails
 */

import type { Env } from '../types/env';
import type { CreateAdRequest, Ad } from '@threead/shared';
import { createAdService } from './adCreation';
import { extractPayerFromTransaction, verifyPaymentAndExtractPayer, getPayerUSDCBalance } from './solana';
import { deleteAdIndex } from './vectorize';
import * as dbService from './db';
import { calculateAdPricing } from './pricing';
import { getAssociatedTokenAddress } from '../utils/ata';

export interface CreateAdWithPaymentResult {
  success: boolean;
  ad?: Ad;
  error?: string;
  details?: string;
}

/**
 * Rollback ad creation by deleting from database and Vectorize
 * Used when payment verification fails after ad creation
 */
async function rollbackAdCreation(env: Env, adId: string): Promise<void> {
  await dbService.deleteAd(env.DB, adId).catch(err => {
    console.error(`[Rollback] Failed to delete ad ${adId} from database:`, err);
  });
  await deleteAdIndex(env, adId).catch(err => {
    console.error(`[Rollback] Failed to delete ad ${adId} from Vectorize:`, err);
  });
}

/**
 * Execute the full ad creation flow with payment verification
 * @param adRequest - The ad creation request
 * @param env - Environment with database and services
 * @returns Result with success status, ad (if successful), and error details
 */
export async function createAdWithPayment(
  adRequest: CreateAdRequest,
  env: Env
): Promise<CreateAdWithPaymentResult> {
  // Step 1: Extract payer address from payment transaction
  const extractedPayer = await extractPayerFromTransaction(adRequest.payment_tx, env);
  
  if (!extractedPayer) {
    return {
      success: false,
      error: 'Failed to extract payer from payment transaction',
      details: 'The payment transaction signature may be invalid or the transaction not found',
    };
  }

  // Step 1b: Check payer's USDC balance BEFORE processing ad
  const expectedAmount = calculateAdPricing(adRequest.days, !!adRequest.media);
  const payerBalance = await getPayerUSDCBalance(extractedPayer, env.USDC_MINT, env);
  
  if (payerBalance < expectedAmount.price) {
    return {
      success: false,
      error: 'Insufficient USDC balance',
      details: `Payer has ${(payerBalance / 1_000_000).toFixed(6)} USDC, but ${expectedAmount.priceUSDC} USDC is required`,
    };
  }

  // Step 2: Process the ad (all AI stuff: tags, moderation, DB insert, Vectorize indexing)
  const result = await createAdService(adRequest, extractedPayer, env, adRequest.payment_tx);

  if (!result.success || !result.ad) {
    return {
      success: false,
      error: result.error || 'Failed to create ad',
      details: result.details,
    };
  }

  // At this point, TypeScript knows result.ad is defined
  const createdAd = result.ad;

  // Step 3: Process the payment (verify the payment transaction)
  const recipientTokenAccount = await getAssociatedTokenAddress(env.USDC_MINT, env.RECIPIENT_WALLET);
  const paymentResult = await verifyPaymentAndExtractPayer(
    adRequest.payment_tx,
    expectedAmount.price,
    recipientTokenAccount,
    env
  );

  // Step 4: If payment verification fails, rollback the ad
  if (!paymentResult.valid || !paymentResult.payer) {
    await rollbackAdCreation(env, createdAd.ad_id);
    
    return {
      success: false,
      error: paymentResult.error || 'Payment verification failed',
      details: paymentResult.error || 'Could not verify payment transaction. Ad creation has been rolled back.',
    };
  }

  // Ensure extracted payer matches payment verification payer
  if (paymentResult.payer !== extractedPayer) {
    await rollbackAdCreation(env, createdAd.ad_id);
    
    return {
      success: false,
      error: 'Payer mismatch between transaction extraction and verification. Ad creation has been rolled back.',
    };
  }

  // Payment verified successfully - ad is valid
  return {
    success: true,
    ad: createdAd,
  };
}

