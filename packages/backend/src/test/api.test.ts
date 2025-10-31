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
    it.skip('should return 402 Payment Required when creating ad without payment', async () => {
      // Remove .skip when wrangler dev is running
      const response = await fetch(`${WORKER_URL}/api/ads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Test Ad',
          days: 1,
        }),
      });

      if (!response.ok && response.status === 0) {
        console.warn('Skipping: wrangler dev not running');
        return;
      }

      expect(response.status).toBe(402);
      const data = await response.json() as { payment?: { amountUSDC?: number } };
      expect(data).toHaveProperty('payment');
      expect(data.payment).toHaveProperty('amountUSDC');
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

