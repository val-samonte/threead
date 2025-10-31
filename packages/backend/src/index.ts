/**
 * Three.ad Backend Worker
 * Handles both REST API and MCP protocol endpoints
 */

import type { Env } from './types/env';
import { handleAdsRoute } from './routes/ads';

export type { Env };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Payment',
    };

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Route to MCP protocol handler
    if (url.pathname.startsWith('/mcp/')) {
      // TODO: Import and use MCP handler
      return new Response('MCP endpoint - coming soon', { 
        status: 200,
        headers: corsHeaders 
      });
    }

    // Route to REST API
    if (url.pathname.startsWith('/api/ads')) {
      const response = await handleAdsRoute(request, env, url.pathname);
      // Add CORS headers
      Object.entries(corsHeaders).forEach(([key, value]) => {
        response.headers.set(key, value);
      });
      return response;
    }

    // Health check
    if (url.pathname === '/health') {
      return new Response('OK', { 
        status: 200,
        headers: corsHeaders 
      });
    }

    return new Response('Not Found', { 
      status: 404,
      headers: corsHeaders 
    });
  },
};

