/**
 * x402 Payment types
 */

export interface PaymentRequirements {
  recipientWallet: string;
  tokenAccount: string;
  mint: string;
  amount: number; // Amount in smallest units (e.g., 100000 for 0.1 USDC)
  amountUSDC: number; // Amount in USDC (e.g., 0.1)
  cluster: 'devnet' | 'mainnet';
  message?: string;
}

export interface X402PaymentProof {
  x402Version: number;
  scheme: 'exact';
  network: 'solana-devnet' | 'solana-mainnet';
  payload: {
    serializedTransaction: string; // Base64 encoded transaction
  };
}

export interface PaymentVerificationResult {
  valid: boolean;
  amount: number;
  amountUSDC: number;
  signature: string;
  recipient: string;
  explorerUrl: string;
  error?: string;
}

/**
 * Pricing calculation
 * - Starts at 0.1 USDC for a day
 * - Additional days: 0.05 USDC
 * - With image: +1 USDC
 */
export function calculatePrice(days: number, hasImage: boolean): number {
  if (days < 1) {
    throw new Error('Days must be at least 1');
  }
  
  // Base price: 0.1 USDC for first day
  let price = 0.1;
  
  // Additional days: 0.05 USDC each
  if (days > 1) {
    price += (days - 1) * 0.05;
  }
  
  // With image: +1 USDC
  if (hasImage) {
    price += 1.0;
  }
  
  return price;
}

/**
 * Convert USDC amount to smallest units (assuming 6 decimals)
 */
export function usdcToSmallestUnits(usdc: number): number {
  return Math.round(usdc * 1_000_000);
}

/**
 * Convert smallest units to USDC
 */
export function smallestUnitsToUSDC(units: number): number {
  return units / 1_000_000;
}

