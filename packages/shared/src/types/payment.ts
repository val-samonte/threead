/**
 * x402 Payment types
 */

// Pricing constants in smallest units (USDC has 6 decimals)
const BASE_PRICE_SMALLEST_UNITS = 100_000; // 0.1 USDC
const ADDITIONAL_DAY_PRICE_SMALLEST_UNITS = 50_000; // 0.05 USDC
const IMAGE_PRICE_SMALLEST_UNITS = 1_000_000; // 1.0 USDC
const USDC_DECIMALS = 1_000_000;

/**
 * Calculate price in smallest units (avoids floating point precision issues)
 * - Starts at 0.1 USDC for a day (100000 smallest units)
 * - Additional days: 0.05 USDC each (50000 smallest units)
 * - With image: +1 USDC (1000000 smallest units)
 */
export function calculatePriceSmallestUnits(days: number, hasImage: boolean): number {
  if (days < 1) {
    throw new Error('Days must be at least 1');
  }
  
  // Base price: 0.1 USDC for first day
  let price = BASE_PRICE_SMALLEST_UNITS;
  
  // Additional days: 0.05 USDC each
  if (days > 1) {
    price += (days - 1) * ADDITIONAL_DAY_PRICE_SMALLEST_UNITS;
  }
  
  // With image: +1 USDC
  if (hasImage) {
    price += IMAGE_PRICE_SMALLEST_UNITS;
  }
  
  return price;
}

/**
 * Convert smallest units to USDC
 */
export function smallestUnitsToUSDC(units: number): number {
  return units / USDC_DECIMALS;
}

/**
 * Payment details response for 402 Payment Required
 * Follows x402 standard
 */
export interface PaymentDetails {
  paymentRequired: boolean;
  paymentDetails: {
    amount: string; // USDC amount (e.g., "0.10")
    currency: string; // "USDC"
    recipient: string; // Recipient wallet address (not ATA) - client will derive ATA when creating transaction
    mint: string; // USDC mint address
    network: 'devnet' | 'mainnet-beta';
    scheme: 'exact';
    facilitatorUrl?: string; // Optional facilitator URL
  };
}

/**
 * Payment payload format (simplified)
 * Contains transaction signature from client-settled transaction
 */
export interface PaymentPayload {
  transactionSignature: string; // Solana transaction signature (base58)
}

