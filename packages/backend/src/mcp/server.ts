/**
 * MCP (Model Context Protocol) Server Handler
 * Uses @modelcontextprotocol/sdk with manual HTTP transport handling
 * 
 * Note: Cloudflare's official McpAgent (from agents/mcp) requires the Agents platform.
 * For standalone Workers, we handle HTTP transport manually using the MCP SDK.
 * 
 * Based on Cloudflare's x402 MCP patterns:
 * https://developers.cloudflare.com/agents/x402/
 */

import type { Env } from '../types/env';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { queryAdsTool } from './tools/queryAds';
import { getAdDetailsTool } from './tools/getAdDetails';
import { getAvailableTagsTool } from './tools/getAvailableTags';
import { createAdWithPayment } from '../services/createAdWithPayment';
import type { CreateAdRequest, AdQueryParams } from '@threead/shared';
import { z } from 'zod';

// MCP server instance (reused across requests)
let mcpServer: McpServer | null = null;
// Store tool handlers separately since SDK doesn't expose them directly
const toolHandlers: Map<string, (args: any, env: Env) => Promise<any>> = new Map();

/**
 * Get or create the MCP server instance
 */
function getMCPServer(env: Env): McpServer {
  if (!mcpServer) {
    mcpServer = new McpServer({
      name: 'threead-mcp-server',
      version: '0.1.0',
    });

    // Register postAd tool
    // TODO: When x402 is ready, this should be a paid tool
    // In Cloudflare Agents platform: mcpServer.paidTool("postAd", "Post a new advertisement", 0.10, ...)
    const postAdHandler = async (args: any, env: Env) => {
      const result = await createAdWithPayment(args as CreateAdRequest, env);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result),
          },
        ],
      };
    };
    toolHandlers.set('postAd', postAdHandler);
    mcpServer.tool(
      'postAd',
      'Post a new advertisement to Three.ad. Creates an ad that will be displayed to users matching the criteria. Requires payment_tx (x402 payment transaction signature) - the author will be extracted from the payment transaction.',
      {
        payment_tx: z.string().min(1, 'Payment transaction signature (x402 payment) is required').regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Must be valid base58 characters'),
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
      } as any,
      {},
      (async (args: any) => postAdHandler(args, env)) as any
    );

    // Register queryAds tool
    const queryAdsHandler = async (args: any, env: Env) => {
      const result = await queryAdsTool(args as AdQueryParams, env);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result),
          },
        ],
      };
    };
    toolHandlers.set('queryAds', queryAdsHandler);
    mcpServer.tool(
      'queryAds',
      'Search and query advertisements using semantic search, location, age, interest, and tag filters.',
      {
        query: z.string().optional(),
        latitude: z.number().min(-90).max(90).optional(),
        longitude: z.number().min(-180).max(180).optional(),
        radius: z.number().min(0).optional(),
        min_age: z.number().int().min(0).optional(),
        max_age: z.number().int().min(0).optional(),
        interests: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      } as any,
      {},
      (async (args: any) => queryAdsHandler(args, env)) as any
    );

    // Register getAdDetails tool
    const getAdDetailsHandler = async (args: any, env: Env) => {
      const result = await getAdDetailsTool(args as { ad_id: string }, env);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result),
          },
        ],
      };
    };
    toolHandlers.set('getAdDetails', getAdDetailsHandler);
    mcpServer.tool(
      'getAdDetails',
      'Get detailed information about a specific advertisement by its ID.',
      {
        ad_id: z.string().uuid(),
      } as any,
      {},
      (async (args: any) => getAdDetailsHandler(args, env)) as any
    );

    // Register getAvailableTags tool
    const getAvailableTagsHandler = async (_args: any, _env: Env) => {
      const result = await getAvailableTagsTool();
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result),
          },
        ],
      };
    };
    toolHandlers.set('getAvailableTags', getAvailableTagsHandler);
    mcpServer.tool(
      'getAvailableTags',
      'Get the list of available tags that can be used for categorizing and filtering advertisements. These tags are automatically assigned to ads during creation via AI analysis, and can be used in queryAds to filter results.',
      {} as any,
      {},
      (async () => getAvailableTagsHandler(null, env)) as any
    );
  }

  return mcpServer;
}

/**
 * Handle MCP protocol requests over HTTP
 * 
 * For standalone Workers, we handle JSON-RPC manually since the SDK expects
 * a connection context (stdio/SSE). Cloudflare's McpAgent handles this automatically
 * but requires the Agents platform.
 * 
 * This follows the same pattern as Cloudflare's McpAgent.serve() but for standalone Workers.
 */
export async function handleMCPRequest(
  request: Request,
  env: Env
): Promise<Response> {
  // Only accept POST requests
  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32600,
          message: 'Invalid Request',
          data: 'MCP protocol requires POST requests',
        },
      }),
      {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Parse JSON-RPC request
  let body: unknown;
  try {
    const bodyText = await request.text();
    if (!bodyText || bodyText.trim() === '') {
      throw new Error('Request body is empty');
    }
    body = JSON.parse(bodyText);
  } catch (error) {
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: 'Parse error',
          data: error instanceof Error ? error.message : 'Invalid JSON format',
        },
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Validate JSON-RPC structure
  if (!body || (typeof body !== 'object' && !Array.isArray(body))) {
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32600,
          message: 'Invalid Request',
          data: 'Request body must be a JSON-RPC object or array',
        },
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const server = getMCPServer(env);
  const requests = Array.isArray(body) ? body : [body];

  // Process requests using SDK's internal request handler
  const responses = await Promise.all(
    requests.map(async (req: any) => {
      try {
        // Validate request structure
        if (!req || typeof req !== 'object' || req.jsonrpc !== '2.0') {
          return {
            jsonrpc: '2.0',
            id: req?.id ?? null,
            error: {
              code: -32600,
              message: 'Invalid Request',
              data: 'Request must be a valid JSON-RPC 2.0 object',
            },
          };
        }

        // Handle MCP protocol methods
        if (req.method === 'initialize') {
          return {
            jsonrpc: '2.0',
            id: req.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: {
                tools: {},
              },
              serverInfo: {
                name: 'threead-mcp-server',
                version: '0.1.0',
              },
            },
          };
        }

        if (req.method === 'tools/list') {
          const tools = [];
          const registeredTools = (server as any)._registeredTools || {};
          for (const [name, tool] of Object.entries(registeredTools)) {
            const toolDef = tool as any;
            tools.push({
              name,
              description: toolDef.description || '',
              inputSchema: {
                type: 'object' as const,
                properties: {},
                required: [] as string[],
              },
            });
          }
          return {
            jsonrpc: '2.0',
            id: req.id,
            result: { tools },
          };
        }

        if (req.method === 'tools/call') {
          const params = req.params as { name?: string; arguments?: unknown } | undefined;
          const { name, arguments: args } = params || {};
          
          if (!name || typeof name !== 'string') {
            return {
              jsonrpc: '2.0',
              id: req.id,
              error: {
                code: -32602,
                message: 'Invalid params',
                data: 'Tool name is required',
              },
            };
          }

          const registeredTools = (server as any)._registeredTools || {};
          const tool = registeredTools[name];
          
          if (!tool) {
            return {
              jsonrpc: '2.0',
              id: req.id,
              error: {
                code: -32601,
                message: 'Method not found',
                data: `Tool "${name}" not found`,
              },
            };
          }

          // Get handler from our stored handlers map
          const handler = toolHandlers.get(name);
          if (!handler) {
            return {
              jsonrpc: '2.0',
              id: req.id,
              error: {
                code: -32601,
                message: 'Method not found',
                data: `Tool handler for "${name}" not found`,
              },
            };
          }

          // Validate and parse arguments using zod schema
          const toolDef = tool as any;
          let validatedArgs = args || {};
          
          if (toolDef.inputSchema) {
            try {
              const parseResult = await toolDef.inputSchema.safeParseAsync(args || {});
              if (!parseResult.success) {
                return {
                  jsonrpc: '2.0',
                  id: req.id,
                  error: {
                    code: -32602,
                    message: 'Invalid params',
                    data: parseResult.error.errors.map((e: any) => 
                      `${e.path.join('.')}: ${e.message}`
                    ).join(', '),
                  },
                };
              }
              validatedArgs = parseResult.data;
            } catch (e) {
              return {
                jsonrpc: '2.0',
                id: req.id,
                error: {
                  code: -32602,
                  message: 'Invalid params',
                  data: e instanceof Error ? e.message : 'Validation failed',
                },
              };
            }
          }

          // Call the tool handler with validated args and env
          const result = await handler(validatedArgs, env);
          return {
            jsonrpc: '2.0',
            id: req.id,
            result,
          };
        }

        return {
          jsonrpc: '2.0',
          id: req.id,
          error: {
            code: -32601,
            message: 'Method not found',
            data: `Method "${req.method}" not found`,
          },
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

  // Return single response or batch array
  const response = requests.length === 1 ? responses[0] : responses;

  return new Response(JSON.stringify(response), {
    headers: { 'Content-Type': 'application/json' },
  });
}
