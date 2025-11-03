/**
 * Pricing calculation service
 * Handles ad pricing based on days and media
 */

import { calculatePriceSmallestUnits, smallestUnitsToUSDC } from '@threead/shared';

export interface PricingCalculation {
  days: number;
  hasImage: boolean;
  priceUSDC: number;
  price: number; // Price in smallest units (for Solana USDC - 6 decimals, e.g., 100000 = 0.1 USDC)
}

export function calculateAdPricing(days: number, hasImage: boolean): PricingCalculation {
  // Calculate directly in smallest units to avoid floating point precision issues
  const price = calculatePriceSmallestUnits(days, hasImage);
  const priceUSDC = smallestUnitsToUSDC(price);

  return {
    days,
    hasImage,
    priceUSDC,
    price,
  };
}

