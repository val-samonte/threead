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

const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8787';

/**
 * Verify worker is accessible with real bindings
 */
async function requireWorkerRunning(): Promise<void> {
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

describe('Moderation Service Tests', () => {
  beforeAll(async () => {
    await requireWorkerRunning();
  });

  describe('Clean, typical post', () => {
    it('should score high (7-10) for clean, professional content', async () => {
      // Create ad via API - moderation runs automatically with real AI
      const createResponse = await fetch(`${WORKER_URL}/api/ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Fresh Pizza Delivery',
          description: 'Get your favorite pizza delivered hot and fresh to your door. Special deals on weekends!',
          call_to_action: 'Order now',
          link_url: 'https://pizza.example.com',
          location: 'Berkeley, CA',
          interests: ['pizza', 'food', 'delivery'],
          days: 7,
        }),
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

      // AI should score clean, professional content highly
      expect(createData.ad!.moderation_score!).toBeGreaterThanOrEqual(7);
      expect(createData.ad!.moderation_score!).toBeLessThanOrEqual(10);
      expect(createData.ad!.visible).toBe(true);
    });
  });

  describe('Adult/pornographic content', () => {
    it('should score 6-7 for adult content WITH proper age gating (min_age >= 18)', async () => {
      // Create ad with adult content via API - moderation runs automatically with real AI
      const createResponse = await fetch(`${WORKER_URL}/api/ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Adult Entertainment Platform',
          description: 'Explicit adult content platform for 18+ only. Requires age verification.',
          call_to_action: 'Join now (18+)',
          link_url: 'https://adult.example.com',
          location: 'Online',
          interests: ['adult', 'entertainment'],
          days: 30,
          min_age: 18,
        }),
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
      // Should be allowable but age-gated, scoring around 6-7
      expect(createData.ad!.moderation_score!).toBeGreaterThanOrEqual(6);
      expect(createData.ad!.moderation_score!).toBeLessThanOrEqual(7);
      expect(createData.ad!.visible).toBe(true); // Score >= 5, visible but age-gated
    });

    it('should score low (1-4) for adult content WITHOUT proper age gating - automatically hidden', async () => {
      // Create ad with adult content but no age restriction
      const createResponse = await fetch(`${WORKER_URL}/api/ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Adult Entertainment Platform',
          description: 'Explicit adult content platform. No age verification required.',
          call_to_action: 'Join now',
          link_url: 'https://adult.example.com',
          location: 'Online',
          interests: ['adult', 'entertainment'],
          days: 30,
          // No min_age set - should trigger lower score
        }),
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
      const createResponse = await fetch(`${WORKER_URL}/api/ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Buy Cocaine Online',
          description: 'Get high quality cocaine delivered discreetly. Best prices guaranteed.',
          call_to_action: 'Order now',
          link_url: 'https://illegal-drugs.example.com',
          location: 'Dark web',
          interests: ['drugs', 'illegal'],
          days: 1,
        }),
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

      // AI should score illegal drug promotion as 0 (most severe)
      expect(createData.ad!.moderation_score!).toBe(0);
      expect(createData.ad!.visible).toBe(false); // Score < 5, automatically hidden
    });
  });

  describe('Score thresholds', () => {
    it('should correctly set visible flag based on score threshold (5)', async () => {
      // Test with clean content (should score >= 5 and be visible)
      const createResponse = await fetch(`${WORKER_URL}/api/ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Coffee Shop Opening',
          description: 'New coffee shop opening this weekend. Come try our artisanal coffee!',
          days: 7,
        }),
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

