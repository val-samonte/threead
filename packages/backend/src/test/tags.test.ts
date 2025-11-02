/**
 * Tag generation service integration tests
 * Tests AI-powered tag generation with REAL Cloudflare Workers AI (no mocks)
 * 
 * Like AI.run() which calls remote AI in tests, we test tag generation via API calls.
 * When wrangler dev is running, API endpoints have access to real AI bindings.
 * 
 * To run:
 * 1. Start wrangler dev: cd packages/backend && npm run dev
 * 2. Run: npm test -- tags.test.ts
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

describe('Tag Generation Service Tests', () => {
  beforeAll(async () => {
    await requireWorkerRunning();
  });

  describe('Service ad', () => {
    it('should generate tags including "services" for service-based ads', async () => {
      // Create ad via API - tag generation runs automatically with real AI
      const createResponse = await fetch(`${WORKER_URL}/api/ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Professional Plumbing Services',
          description: 'Experienced plumber available 24/7. We handle all types of plumbing repairs, installations, and maintenance. Licensed and insured. Call for free estimates.',
          call_to_action: 'Call now for service',
          link_url: 'https://plumber.example.com',
          location: 'San Francisco, CA',
          interests: ['plumbing', 'repair', 'services'],
          days: 30,
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
          tags?: string[];
        } 
      };

      expect(createData.ad).toBeDefined();
      expect(createData.ad!.tags).toBeDefined();
      expect(Array.isArray(createData.ad!.tags)).toBe(true);
      
      // Should generate 2-5 tags
      expect(createData.ad!.tags!.length).toBeGreaterThanOrEqual(2);
      expect(createData.ad!.tags!.length).toBeLessThanOrEqual(5);
      
      // Should include "services" tag
      expect(createData.ad!.tags!).toContain('services');
    });
  });

  describe('Finance ad', () => {
    it('should generate tags including "finance" for financial service ads', async () => {
      // Create ad via API - tag generation runs automatically with real AI
      const createResponse = await fetch(`${WORKER_URL}/api/ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Investment Advisory Services',
          description: 'Certified financial advisor offering personalized investment strategies. Retirement planning, portfolio management, and wealth building consultation. Schedule a free consultation today.',
          call_to_action: 'Book free consultation',
          link_url: 'https://finance.example.com',
          location: 'New York, NY',
          interests: ['finance', 'investment', 'business'],
          days: 60,
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
          tags?: string[];
        } 
      };

      expect(createData.ad).toBeDefined();
      expect(createData.ad!.tags).toBeDefined();
      expect(Array.isArray(createData.ad!.tags)).toBe(true);
      
      // Should generate 2-5 tags
      expect(createData.ad!.tags!.length).toBeGreaterThanOrEqual(2);
      expect(createData.ad!.tags!.length).toBeLessThanOrEqual(5);
      
      // Should include "finance" tag
      expect(createData.ad!.tags!).toContain('finance');
    });
  });

  describe('Product ad', () => {
    it('should generate tags including "product" for product sales ads', async () => {
      // Create ad via API - tag generation runs automatically with real AI
      const createResponse = await fetch(`${WORKER_URL}/api/ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Vintage Leather Jackets for Sale',
          description: 'Authentic vintage leather jackets in excellent condition. Various sizes and styles available. Limited collection, all hand-picked. Perfect for collectors and fashion enthusiasts.',
          call_to_action: 'Browse collection',
          link_url: 'https://jackets.example.com',
          location: 'Los Angeles, CA',
          interests: ['clothing', 'vintage', 'fashion'],
          days: 14,
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
          tags?: string[];
        } 
      };

      expect(createData.ad).toBeDefined();
      expect(createData.ad!.tags).toBeDefined();
      expect(Array.isArray(createData.ad!.tags)).toBe(true);
      
      // Should generate 2-5 tags
      expect(createData.ad!.tags!.length).toBeGreaterThanOrEqual(2);
      expect(createData.ad!.tags!.length).toBeLessThanOrEqual(5);
      
      // Should include "product" tag
      expect(createData.ad!.tags!).toContain('product');
    });
  });
});

