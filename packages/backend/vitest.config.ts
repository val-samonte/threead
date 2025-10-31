import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // For Cloudflare Workers testing, we'll use wrangler dev or setup files
    setupFiles: ['./src/test/setup.ts'],
  },
});

