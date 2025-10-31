/**
 * Test setup file for Vitest
 * Configures test environment and mocks for Cloudflare Workers
 */

import { beforeAll, vi } from 'vitest';

// Mock Cloudflare Workers globals
beforeAll(() => {
  // These will be properly mocked or use wrangler's test environment
  // For now, we'll let the actual Worker environment handle it
});

