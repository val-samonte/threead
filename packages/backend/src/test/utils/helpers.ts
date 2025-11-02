/**
 * Shared test utilities for API integration tests
 */

import bs58 from 'bs58';

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

/**
 * Generate a mock payment transaction signature for testing
 * This creates a valid base58 signature format but doesn't create an actual transaction
 * TODO: Replace with actual Solana transaction creation using @solana/kit
 */
function generateMockPaymentSignature(): string {
  // Generate 64 random bytes (Solana signature length) and encode as base58
  const randomBytes = new Uint8Array(64);
  crypto.getRandomValues(randomBytes);
  return bs58.encode(randomBytes);
}

/**
 * Helper to create an ad with payment transaction
 * TODO: Replace mock signature with actual payment transaction creation
 * For now, tests will need to mock the payment verification or use a devnet transaction
 */
export async function createAdWithPayment(
  adData: Record<string, unknown>,
  paymentTx?: string
): Promise<Response> {
  // Use provided payment_tx or generate a mock one
  // In real tests, this should be an actual Solana transaction signature
  const finalPaymentTx = paymentTx || generateMockPaymentSignature();
  
  return fetch(`${WORKER_URL}/api/ads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payment_tx: finalPaymentTx,
      ...adData,
    }),
  });
}

export { WORKER_URL };

