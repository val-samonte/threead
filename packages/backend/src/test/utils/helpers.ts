/**
 * Shared test utilities for API integration tests
 */

import { getPayerKeypair, type TestPayerKeypair } from './payment';
import { calculatePriceSmallestUnits } from '@threead/shared';
import { getAssociatedTokenAddress } from '../../utils/ata';

const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8787';

/**
 * Verify worker is accessible with real bindings
 */
export async function requireWorkerRunning(): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    
    const response = await fetch(`${WORKER_URL}/health`, {
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      throw new Error(`Worker health check failed: ${response.status}`);
    }
  } catch (error) {
    throw new Error(
      `Worker not accessible at ${WORKER_URL}. ` +
      `Make sure wrangler dev is running: cd packages/backend && npm run dev\n` +
      `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

// Shared payer keypair for all tests (loaded from payer.keypair.json)
let sharedPayer: TestPayerKeypair | null = null;
let payerInitialized = false;

/**
 * Get or load the shared payer keypair for tests
 * This payer is loaded from payer.keypair.json and reused across all test files
 */
export async function getPayer(): Promise<TestPayerKeypair> {
  if (sharedPayer && payerInitialized) {
    return sharedPayer;
  }

  // Load payer keypair from file
  console.log('[Test Helpers] Loading payer keypair from payer.keypair.json...');
  sharedPayer = await getPayerKeypair();
  console.log('[Test Helpers] Payer address:', sharedPayer.publicKeyBase58);
  payerInitialized = true;
  
  return sharedPayer;
}

/**
 * Get treasury token account address (ATA)
 * Shared helper to avoid duplication across test files
 */
async function getTreasuryTokenAccount(): Promise<string> {
  const treasuryWallet = process.env.RECIPIENT_WALLET || 'Hf1BvFzfGiAzPoV6oHWSxQuNEiGxyULuZh8zU4ZMknFM';
  const usdcMint = process.env.USDC_MINT || '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  return await getAssociatedTokenAddress(usdcMint, treasuryWallet);
}

/**
 * Helper to create an ad with real payment transaction
 * Uses shared payer keypair - automatically creates payment transaction
 * @param adData - Ad data to send
 * @param paymentTx - Optional payment transaction signature (if not provided, creates one)
 * @param timeout - Optional timeout in milliseconds (default: 30000)
 */
export async function createAdWithPayment(
  adData: Record<string, unknown>,
  paymentTx?: string,
  timeout: number = 30000
): Promise<Response> {
  // If payment_tx is provided, use it (for tests that want to control the payment)
  if (paymentTx) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(`${WORKER_URL}/api/ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_tx: paymentTx,
          ...adData,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timed out after ${timeout}ms`);
      }
      throw error;
    }
  }

  // Otherwise, create a real payment transaction
  const payer = await getPayer();
  const days = (adData.days as number) || 1;
  const hasImage = !!(adData.media as unknown);
  
  // Calculate payment amount
  const amountSmallestUnits = calculatePriceSmallestUnits(days, hasImage);
  
  // Derive treasury ATA
  const treasuryTokenAccount = await getTreasuryTokenAccount();
  
  // Create real payment transaction
  const realPaymentTx = await payer.createPaymentTransaction(
    amountSmallestUnits,
    treasuryTokenAccount
  );
  
  // Wait a moment for transaction to confirm
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(`${WORKER_URL}/api/ads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payment_tx: realPaymentTx,
        ...adData,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeout}ms`);
    }
    throw error;
  }
}

export { WORKER_URL, getTreasuryTokenAccount };

