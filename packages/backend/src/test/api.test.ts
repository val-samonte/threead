/**
 * API integration tests
 * These tests require wrangler dev to be running
 * Run: npm run dev:backend (in one terminal)
 * Then: npm test (in another terminal)
 */

import { describe, it, expect } from 'vitest';
import { requireWorkerRunning, WORKER_URL, createAdWithPayment } from './utils/helpers';

describe('API Endpoints', () => {
  describe('Health Check', () => {
    it.skip('should return OK', async () => {
      // Remove .skip when wrangler dev is running
      await requireWorkerRunning();
      
      const response = await fetch(`${WORKER_URL}/health`);

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toBe('OK');
    });
  });

  describe('Ads API', () => {
    it.skip('should create ad with payment transaction', async () => {
      await requireWorkerRunning();
      
      const response = await createAdWithPayment({
        title: 'Test Ad with Payment',
        description: 'Test ad with payment transaction',
          days: 1,
      });

      if (!response.ok && response.status === 0) {
        console.warn('Skipping: wrangler dev not running');
        return;
      }

      expect(response.status).toBe(201);
      const data = await response.json() as { 
        success?: boolean;
        ad?: { 
          ad_id?: string;
          author?: string;
          payment_tx?: string;
          moderation_score?: number;
          visible?: boolean;
        };
      };
      expect(data.success).toBe(true);
      expect(data.ad).toBeDefined();
      expect(data.ad?.ad_id).toBeDefined();
      expect(data.ad?.author).toBeDefined();
      expect(data.ad?.payment_tx).toBeDefined();
      // Ad should have moderation score and visibility
      expect(data.ad?.moderation_score).toBeDefined();
      expect(data.ad?.visible).toBeDefined();
    });

    it.skip('should query ads', async () => {
      await requireWorkerRunning();
      
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

