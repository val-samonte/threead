/**
 * Shared ad creation flow with payment verification
 * Used by both REST API and MCP server to avoid code duplication
 * 
 * Flow (x402 client-settled approach):
 * 1. Extract payment signature from request
 * 2. Extract payer from transaction signature
 * 3. VERIFY transaction FIRST (before expensive operations - fail fast)
 * 4. Check idempotency AFTER verification (before expensive ops - payment already used check)
 * 5. Create ad (AI, DB, Vectorize) - Can take time (5-30 seconds)
 * 6. No rollback needed (verification happens before ad creation)
 */

import type { Env } from '../types/env';
import type { CreateAdRequest, Ad } from '@threead/shared';
import { createAdService } from './adCreation';
import { extractPayerFromTransaction, verifyPaymentAndExtractPayer } from './solana';
import * as dbService from './db';
import { calculateAdPricing } from './pricing';
import { getAssociatedTokenAddress } from '../utils/ata';
import { checkTransactionAlreadyProcessed } from './idempotency';

export interface CreateAdWithPaymentResult {
  success: boolean;
  ad?: Ad;
  error?: string;
  details?: string;
  duplicate?: boolean; // Flag for idempotency (payment already used)
}


/**
 * Execute the full ad creation flow with payment verification
 * Follows x402 client-settled approach: verify FIRST, then create ad
 * @param adRequest - The ad creation request (must include payment_tx)
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

  // Step 2: Calculate expected payment amount
  const expectedAmount = calculateAdPricing(adRequest.days, !!adRequest.media);
  const recipientTokenAccount = await getAssociatedTokenAddress(env.USDC_MINT, env.RECIPIENT_WALLET);

  // Step 3: VERIFY transaction FIRST (before expensive operations - fail fast)
  const paymentResult = await verifyPaymentAndExtractPayer(
    adRequest.payment_tx,
    expectedAmount.price,
    recipientTokenAccount,
    env
  );

  // If verification fails, return error immediately (no ad creation, no waste)
  if (!paymentResult.valid || !paymentResult.payer) {
    return {
      success: false,
      error: paymentResult.error || 'Payment verification failed',
      details: paymentResult.error || 'Could not verify payment transaction. Transaction must be settled on-chain before creating ad.',
    };
  }

  // Ensure extracted payer matches payment verification payer
  if (paymentResult.payer !== extractedPayer) {
    return {
      success: false,
      error: 'Payer mismatch between transaction extraction and verification',
      details: 'The payer extracted from the transaction does not match the verified payer',
    };
  }

  // Step 4: Check idempotency AFTER verification (before expensive ops - payment already used check)
  const idempotencyCheck = await checkTransactionAlreadyProcessed(adRequest.payment_tx, env);
  if (idempotencyCheck.processed) {
    // Payment already used - return existing ad (like a ticket)
    return {
      success: true,
      ad: idempotencyCheck.existingAd,
      duplicate: true,
      error: 'Payment already used',
      details: 'This payment transaction has already been used to create an ad',
    };
  }

  // Step 5: Create ad (AI, DB, Vectorize) - Can take time (5-30 seconds)
  // AI moderation (expensive)
  // AI tagging (expensive)
  // DB insert with payment_tx (UNIQUE constraint prevents duplicates - safety net)
  // Vectorize indexing (expensive)
  const result = await createAdService(adRequest, extractedPayer, env, adRequest.payment_tx);

  if (!result.success || !result.ad) {
    // Handle duplicate key error (UNIQUE constraint - safety net for race conditions)
    // This should not happen normally since we check idempotency before creating ad
    if (result.duplicate) {
      // Race condition: Another request inserted same payment_tx
      const existingCheck = await checkTransactionAlreadyProcessed(adRequest.payment_tx, env);
      if (existingCheck.processed && existingCheck.existingAd) {
        return {
          success: true,
          ad: existingCheck.existingAd,
          duplicate: true,
          error: 'Payment already used',
          details: 'Transaction already processed (race condition detected)',
        };
      }
    }
    
    return {
      success: false,
      error: result.error || 'Failed to create ad',
      details: result.details,
    };
  }

  // At this point, TypeScript knows result.ad is defined
  const createdAd = result.ad;

  // Payment verified successfully - ad is valid
  return {
    success: true,
    ad: createdAd,
  };
}

