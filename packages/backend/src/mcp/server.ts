/**
 * MCP (Model Context Protocol) Server Handler
 * Uses official @modelcontextprotocol/sdk McpServer class
 * 
 * Based on Cloudflare's x402 MCP patterns:
 * https://developers.cloudflare.com/agents/x402/
 * 
 * Note: "agents" library is part of Cloudflare's Agents platform (not a separate npm package).
 * For standalone Workers, we use the MCP SDK directly and handle HTTP JSON-RPC manually.
 * 
 * TODO: When ready for x402 integration with Cloudflare Agents:
 * - If using Cloudflare Agents platform, use `withX402` from "agents/x402"
 * - Otherwise, implement x402 payment verification in tool handlers
 */

import type { Env } from '../types/env';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { postAdTool } from './tools/postAd';
import { queryAdsTool } from './tools/queryAds';
import { getAdDetailsTool } from './tools/getAdDetails';
import type { CreateAdRequest, AdQueryParams } from '@threead/shared';
import { z } from 'zod';

// Create MCP server instance (can be reused across requests)
let mcpServer: McpServer | null = null;

/**
 * Get or create the MCP server instance
 */
function getMCPServer(env: Env): McpServer {
  if (!mcpServer) {
    mcpServer = new McpServer(
      {
        name: 'threead-mcp-server',
        version: '0.1.0',
      }
    );

    // Register postAd tool
    // TODO: When x402 is ready, this should be a paid tool
    // In Cloudflare Agents: mcpServer.paidTool("postAd", "Post a new advertisement", 0.10, ...)
    // 
    // NOTE: The `as any` assertion below is ONLY for TypeScript type compatibility in monorepos.
    // ALL VALIDATIONS REMAIN FULLY FUNCTIONAL AT RUNTIME:
    // 1. MCP SDK validates using these zod schemas
    // 2. postAdTool() also calls validateAdRequest() with full shared schemas
    // No validation rules are compromised - this is purely a type system workaround.
    mcpServer.tool(
      'postAd',
      'Post a new advertisement to Three.ad. Creates an ad that will be displayed to users matching the criteria.',
      {
        title: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        call_to_action: z.string().max(100).optional(),
        link_url: z.string().url().optional(),
        latitude: z.number().min(-90).max(90).optional(),
        longitude: z.number().min(-180).max(180).optional(),
        days: z.number().int().min(1).max(365),
        min_age: z.number().int().min(0).optional(),
        max_age: z.number().int().min(0).optional(),
        location: z.string().max(200).optional(),
        interests: z.array(z.string()).max(5).optional(),
      } as any, // Type assertion for monorepo zod version compatibility - validations still work
      {},
      // Callback signature: SDK will pass validated args based on zod schema above
      // We use 'any' for args parameter because SDK type inference is broken by 'as any' on schema
      // VALIDATION IS PRESERVED: postAdTool() calls validateAdRequest() which uses full CreateAdRequestSchema
      (async (args: any) => {
        const result = await postAdTool(args as CreateAdRequest, env);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result),
            },
          ],
        };
      }) as any
    );

    // Register queryAds tool
    // NOTE: `as any` below is ONLY for TypeScript types - validations work at runtime via SDK + validateAdQueryParams()
    mcpServer.tool(
      'queryAds',
      'Search and query advertisements using semantic search, location, age, and interest filters.',
      {
        query: z.string().optional(),
        latitude: z.number().min(-90).max(90).optional(),
        longitude: z.number().min(-180).max(180).optional(),
        radius: z.number().min(0).optional(),
        min_age: z.number().int().min(0).optional(),
        max_age: z.number().int().min(0).optional(),
        interests: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      } as any, // Type assertion for monorepo zod version compatibility - validations still work
      {},
      // Callback signature: SDK will pass validated args based on zod schema above
      // We use 'any' for args parameter because SDK type inference is broken by 'as any' on schema
      // VALIDATION IS PRESERVED: queryAdsTool() calls validateAdQueryParams() which uses full AdQueryParamsSchema
      (async (args: any) => {
        const result = await queryAdsTool(args as AdQueryParams, env);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result),
            },
          ],
        };
      }) as any
    );

    // Register getAdDetails tool
    // NOTE: `as any` below is ONLY for TypeScript types - UUID validation works at runtime via SDK
    mcpServer.tool(
      'getAdDetails',
      'Get detailed information about a specific advertisement by its ID.',
      {
        ad_id: z.string().uuid(),
      } as any, // Type assertion for monorepo zod version compatibility - validations still work
      {},
      // Callback signature: SDK will pass validated args based on zod schema above
      // We use 'any' for args parameter because SDK type inference is broken by 'as any' on schema
      // VALIDATION IS PRESERVED: SDK validates UUID format via zod schema, getAdDetailsTool validates ad_id exists
      (async (args: any) => {
        const result = await getAdDetailsTool(args as { ad_id: string }, env);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result),
            },
          ],
        };
      }) as any
    );
  }

  return mcpServer;
}

/**
 * Handle MCP protocol requests over HTTP
 * Adapts the MCP SDK server to work with HTTP requests in Cloudflare Workers
 */
export async function handleMCPRequest(
  request: Request,
  env: Env
): Promise<Response> {
  const server = getMCPServer(env);
  
  try {
    // Parse JSON-RPC request
    const body = await request.json();

    // Handle single request or batch
    const requests = Array.isArray(body) ? body : [body];
    const responses = await Promise.all(
      requests.map(async (req) => {
        try {
          // Use the server's request handler
          // The server expects properly formatted MCP requests
          const response = await server.server.request(req.method, req.params || {});
          return {
            jsonrpc: '2.0',
            id: req.id,
            result: response,
          };
        } catch (error) {
          return {
            jsonrpc: '2.0',
            id: req.id,
            error: {
              code: -32603,
              message: 'Internal error',
              data: error instanceof Error ? error.message : 'Unknown error',
            },
          };
        }
      })
    );

    // Return single response or batch
    const response = Array.isArray(body) ? responses : responses[0];

    return new Response(JSON.stringify(response), {
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    const errorResponse = {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32700,
        message: 'Parse error',
        data: error instanceof Error ? error.message : 'Unknown error',
      },
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
}
