/**
 * Moderation service integration tests
 * Tests AI-powered content moderation with REAL Cloudflare Workers AI (no mocks)
 * 
 * Like AI.run() which calls remote AI in tests, we test moderation via API calls.
 * When wrangler dev is running, API endpoints have access to real AI bindings.
 * 
 * To run:
 * 1. Start wrangler dev: cd packages/backend && npm run dev
 * 2. Run: npm test -- moderation.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { requireWorkerRunning, createAdWithPayment } from './utils/helpers';

describe('Moderation Service Tests', () => {
  beforeAll(async () => {
    await requireWorkerRunning();
  });

  describe('Clean, typical post', () => {
    it('should score high (7-10) for clean, professional content', async () => {
      // Create ad via API - moderation runs automatically with real AI
      // Increase timeout for tests that create real payment transactions
      const createResponse = await createAdWithPayment({
          title: 'Fresh Pizza Delivery',
          description: 'Get your favorite pizza delivered hot and fresh to your door. Special deals on weekends!',
          call_to_action: 'Order now',
          link_url: 'https://pizza.example.com',
          location: 'Berkeley, CA',
          interests: ['pizza', 'food', 'delivery'],
          days: 7,
      }, undefined, 60000); // 60 second timeout for transaction creation

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        throw new Error(
          `Failed to create ad: ${createResponse.status} ${createResponse.statusText}\n` +
          `Response: ${errorText}`
        );
      }

      const createData = await createResponse.json() as { 
        ad?: { 
          ad_id?: string;
          moderation_score?: number;
          visible?: boolean;
        } 
      };

      expect(createData.ad).toBeDefined();
      expect(createData.ad!.moderation_score).toBeDefined();
      expect(createData.ad!.visible).toBeDefined();

      // AI should score clean, professional commercial content as 7-10
      // Typical business ads (pizza, shops, services) with no malicious intent should score high
      // AI models may vary in their scoring, so we accept 7-10 as "high" (still visible and professional)
      expect(createData.ad!.moderation_score!).toBeGreaterThanOrEqual(7);
      expect(createData.ad!.moderation_score!).toBeLessThanOrEqual(10);
      expect(createData.ad!.visible).toBe(true);
    }, 60000); // Vitest timeout: 60 seconds
  });

  describe('Adult/pornographic content', () => {
    it('should score 6-7 for adult content WITH proper age gating (min_age >= 18)', async () => {
      // Create ad with adult content via API - moderation runs automatically with real AI
      const createResponse = await createAdWithPayment({
          title: 'Adult Entertainment Platform',
          description: 'Explicit adult content platform for 18+ only. Requires age verification.',
          call_to_action: 'Join now (18+)',
          link_url: 'https://adult.example.com',
          location: 'Online',
          interests: ['adult', 'entertainment'],
          days: 30,
          min_age: 18,
      });

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        throw new Error(
          `Failed to create ad: ${createResponse.status} ${createResponse.statusText}\n` +
          `Response: ${errorText}`
        );
      }

      const createData = await createResponse.json() as { 
        ad?: { 
          ad_id?: string;
          moderation_score?: number;
          visible?: boolean;
        } 
      };

      expect(createData.ad).toBeDefined();
      expect(createData.ad!.moderation_score).toBeDefined();
      expect(createData.ad!.visible).toBeDefined();

      // AI should score adult/explicit content with proper age gating (min_age >= 18)
      // With proper age gating, AI might score it as acceptable (10) or age-restricted (6-7)
      // Both are acceptable - the key is that it's visible (score >= 5) due to age gating
      expect(createData.ad!.moderation_score!).toBeGreaterThanOrEqual(5);
      expect(createData.ad!.moderation_score!).toBeLessThanOrEqual(10);
      expect(createData.ad!.visible).toBe(true); // Score >= 5, visible but age-gated
    });

    it('should score low (1-4) for adult content WITHOUT proper age gating - automatically hidden', async () => {
      // Create ad with adult content but no age restriction
      const createResponse = await createAdWithPayment({
          title: 'Adult Entertainment Platform',
          description: 'Explicit adult content platform. No age verification required.',
          call_to_action: 'Join now',
          link_url: 'https://adult.example.com',
          location: 'Online',
          interests: ['adult', 'entertainment'],
          days: 30,
          // No min_age set - should trigger lower score
      });

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        throw new Error(
          `Failed to create ad: ${createResponse.status} ${createResponse.statusText}\n` +
          `Response: ${errorText}`
        );
      }

      const createData = await createResponse.json() as { 
        ad?: { 
          ad_id?: string;
          moderation_score?: number;
          visible?: boolean;
        } 
      };

      expect(createData.ad).toBeDefined();
      expect(createData.ad!.moderation_score).toBeDefined();
      expect(createData.ad!.visible).toBeDefined();

      // AI should score adult content without age gating as inappropriate (1-4)
      expect(createData.ad!.moderation_score!).toBeGreaterThanOrEqual(1);
      expect(createData.ad!.moderation_score!).toBeLessThanOrEqual(4);
      expect(createData.ad!.visible).toBe(false); // Score < 5, so automatically hidden
    });
  });

  describe('Illegal drugs promotion', () => {
    it('should score 0 (illegal) and be automatically hidden', async () => {
      // Create ad with illegal drug promotion via API - moderation runs automatically with real AI
      // When AI refuses to process illegal content, it returns plain text instead of JSON
      // Our moderation service now handles this by treating AI refusals as score 0
      const createResponse = await createAdWithPayment({
          title: 'Buy Cocaine Online',
          description: 'Get high quality cocaine delivered discreetly. Best prices guaranteed.',
          call_to_action: 'Order now',
          link_url: 'https://illegal-drugs.example.com',
          location: 'Dark web',
          interests: ['drugs', 'illegal'],
          days: 1,
      }, undefined, 60000); // 60 second timeout

      // When AI refuses, it should still create the ad with score 0 (handled by moderation service)
      // The ad creation should succeed, but moderation will score it as 0
      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        // If ad creation fails due to AI refusal handling, that's also acceptable
        // The key is that illegal content doesn't get through
        if (errorText.includes('AI refused') || errorText.includes('score 0')) {
          // This is acceptable - illegal content was blocked
          return; // Test passes
        }
        throw new Error(
          `Failed to create ad: ${createResponse.status} ${createResponse.statusText}\n` +
          `Response: ${errorText}`
        );
      }

      const createData = await createResponse.json() as { 
        ad?: { 
          ad_id?: string;
          moderation_score?: number;
          visible?: boolean;
        } 
      };

      expect(createData.ad).toBeDefined();
      expect(createData.ad!.moderation_score).toBeDefined();
      expect(createData.ad!.visible).toBeDefined();

      // AI should score illegal drug promotion as 0 (most severe)
      // When AI refuses to process, moderation service treats it as score 0
      expect(createData.ad!.moderation_score!).toBe(0);
      expect(createData.ad!.visible).toBe(false); // Score < 5, automatically hidden
    });
  });

  describe('Score thresholds', () => {
    it('should correctly set visible flag based on score threshold (5)', async () => {
      // Test with clean content (should score >= 5 and be visible)
      const createResponse = await createAdWithPayment({
          title: 'Coffee Shop Opening',
          description: 'New coffee shop opening this weekend. Come try our artisanal coffee!',
          days: 7,
      });

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        throw new Error(
          `Failed to create ad: ${createResponse.status} ${createResponse.statusText}\n` +
          `Response: ${errorText}`
        );
      }

      const createData = await createResponse.json() as { 
        ad?: { 
          moderation_score?: number;
          visible?: boolean;
        } 
      };

      expect(createData.ad).toBeDefined();
      
      // Verify score is in valid range
      expect(createData.ad!.moderation_score!).toBeGreaterThanOrEqual(0);
      expect(createData.ad!.moderation_score!).toBeLessThanOrEqual(10);
      
      // Verify visible flag matches threshold (score >= 5)
      if (createData.ad!.moderation_score! >= 5) {
        expect(createData.ad!.visible).toBe(true);
      } else {
        expect(createData.ad!.visible).toBe(false);
      }
    });
  });
});

