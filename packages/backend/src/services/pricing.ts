/**
 * Pricing calculation service
 */

import { calculatePriceSmallestUnits, smallestUnitsToUSDC } from '@threead/shared';

export interface PricingCalculation {
  days: number;
  hasImage: boolean;
  priceUSDC: number;
  priceSmallestUnits: number; // For Solana USDC (6 decimals)
}

export function calculateAdPricing(days: number, hasImage: boolean): PricingCalculation {
  // Calculate directly in smallest units to avoid floating point precision issues
  const priceSmallestUnits = calculatePriceSmallestUnits(days, hasImage);
  const priceUSDC = smallestUnitsToUSDC(priceSmallestUnits);

  return {
    days,
    hasImage,
    priceUSDC,
    priceSmallestUnits,
  };
}

