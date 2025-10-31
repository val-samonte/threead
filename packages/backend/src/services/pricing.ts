/**
 * Pricing calculation service
 */

import { calculatePrice, usdcToSmallestUnits } from '@threead/shared';

export interface PricingCalculation {
  days: number;
  hasImage: boolean;
  priceUSDC: number;
  priceSmallestUnits: number; // For Solana USDC (6 decimals)
}

export function calculateAdPricing(days: number, hasImage: boolean): PricingCalculation {
  const priceUSDC = calculatePrice(days, hasImage);
  const priceSmallestUnits = usdcToSmallestUnits(priceUSDC);

  return {
    days,
    hasImage,
    priceUSDC,
    priceSmallestUnits,
  };
}

