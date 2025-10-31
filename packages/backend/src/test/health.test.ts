/**
 * Integration tests for health endpoint
 * 
 * Note: For full integration testing with D1, Vectorize, etc.,
 * use `wrangler dev` and test against the local server
 */

import { describe, it, expect, beforeAll } from 'vitest';

describe('Health Check', () => {
  let workerUrl: string;

  beforeAll(() => {
    // In CI/CD or local tests, you might want to start wrangler dev
    // and test against http://localhost:8787
    workerUrl = process.env.WORKER_URL || 'http://localhost:8787';
  });

  it.skip('should return OK for health endpoint', async () => {
    // This is an integration test that requires wrangler dev to be running
    // Run manually with: wrangler dev (in one terminal) then npm test (in another)
    // Or remove .skip to run it when the server is available
    
    try {
      const response = await fetch(`${workerUrl}/health`);
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toBe('OK');
    } catch (error) {
      // Server not running - this is expected in CI or when dev server is down
      console.warn('Integration test skipped: wrangler dev not running');
      throw error; // Re-throw to make the skip explicit
    }
  });
});

