/**
 * Moderation service
 * AI-powered moderation scoring (0-10)
 * 0 = malicious/illegal, 10 = clean
 */

import type { Ad, CreateAdRequest } from '@threead/shared';

export interface ModerationResult {
  score: number; // 0-10
  visible: boolean; // true if score >= threshold
  reasons?: string[]; // Reasons for low score
}

/**
 * Moderate ad content using AI
 * TODO: Integrate with Cloudflare AI or similar
 */
export async function moderateAd(adRequest: CreateAdRequest): Promise<ModerationResult> {
  // For now, basic keyword checking
  // In production, use Cloudflare Workers AI or similar
  
  const text = `${adRequest.title} ${adRequest.description || ''}`.toLowerCase();
  
  // Block obvious illegal/malicious content
  const blockedTerms = [
    'child abuse',
    'child trafficking',
    'money laundering',
    // Add more terms
  ];

  const hasBlockedContent = blockedTerms.some(term => text.includes(term));
  
  if (hasBlockedContent) {
    return {
      score: 0,
      visible: false,
      reasons: ['Contains blocked content'],
    };
  }

  // Basic scoring (simplified)
  // In production, use AI model for better detection
  
  // Check for spam indicators
  const spamIndicators = [
    'click here now',
    'free money',
    'act now',
    // Add more
  ];

  const spamCount = spamIndicators.filter(indicator => text.includes(indicator)).length;
  
  let score = 10;
  if (spamCount > 0) {
    score = Math.max(0, 10 - spamCount * 2);
  }

  // Threshold: ads with score < 5 are shadow banned
  const visible = score >= 5;

  return {
    score,
    visible,
    reasons: score < 10 ? ['Content flagged for review'] : undefined,
  };
}

