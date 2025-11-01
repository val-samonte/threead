/**
 * API integration tests
 * These tests require wrangler dev to be running
 * Run: npm run dev:backend (in one terminal)
 * Then: npm test (in another terminal)
 */

import { describe, it, expect } from 'vitest';

const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8787';

describe('API Endpoints', () => {
  describe('Health Check', () => {
    it.skip('should return OK', async () => {
      // Remove .skip when wrangler dev is running
      const response = await fetch(`${WORKER_URL}/health`);
      
      if (!response.ok && response.status === 0) {
        console.warn('Skipping: wrangler dev not running');
        return;
      }

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toBe('OK');
    });
  });

  describe('Ads API', () => {
    it.skip('should create ad successfully without payment (payment verification deferred)', async () => {
      // NOTE: Payment verification is currently deferred for MCP development
      // This test verifies the current behavior - ads can be created without payment
      // When x402 payment verification is implemented, update this test to verify 402 Payment Required
      // Remove .skip when wrangler dev is running
      const response = await fetch(`${WORKER_URL}/api/ads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Test Ad',
          description: 'Test ad for API testing',
          days: 1,
        }),
      });

      if (!response.ok && response.status === 0) {
        console.warn('Skipping: wrangler dev not running');
        return;
      }

      // Currently, payment verification is bypassed, so ads can be created without payment
      expect(response.status).toBe(201);
      const data = await response.json() as { 
        success?: boolean;
        ad?: { 
          ad_id?: string;
          payment_tx?: string;
          moderation_score?: number;
          visible?: boolean;
        };
      };
      expect(data.success).toBe(true);
      expect(data.ad).toBeDefined();
      expect(data.ad?.ad_id).toBeDefined();
      // Payment TX should be a dev-bypass placeholder
      expect(data.ad?.payment_tx).toContain('dev-bypass');
      // Ad should have moderation score and visibility
      expect(data.ad?.moderation_score).toBeDefined();
      expect(data.ad?.visible).toBeDefined();
    });

    it.skip('should query ads', async () => {
      // Remove .skip when wrangler dev is running
      const response = await fetch(`${WORKER_URL}/api/ads`);

      if (!response.ok && response.status === 0) {
        console.warn('Skipping: wrangler dev not running');
        return;
      }

      expect(response.status).toBe(200);
      const data = await response.json() as { ads?: unknown[]; total?: number };
      expect(data).toHaveProperty('ads');
      expect(data).toHaveProperty('total');
    });
  });
});

