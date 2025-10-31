/**
 * Three.ad Backend Worker
 * Handles both REST API and MCP protocol endpoints
 */

import { AdStorage } from './durable-objects/AdStorage';
import type { Env } from './types/env';

export type { Env };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Route to MCP protocol handler
    if (url.pathname.startsWith('/mcp/')) {
      // TODO: Import and use MCP handler
      return new Response('MCP endpoint - coming soon', { status: 200 });
    }

    // Route to REST API
    if (url.pathname.startsWith('/api/')) {
      // TODO: Import and use REST API router
      return new Response('REST API endpoint - coming soon', { status: 200 });
    }

    // Health check
    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
    }

    return new Response('Not Found', { status: 404 });
  },
};

// Export Durable Object class for wrangler
export { AdStorage };

