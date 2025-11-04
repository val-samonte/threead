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
        payment_tx: z.string()
          .min(1, 'Payment transaction signature (x402 payment) is required')
          .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Must be valid base58 characters')
          .describe('Solana transaction signature containing x402 payment (USDC transfer to treasury). Must be valid base58 characters. The author (payer) will be extracted from this transaction.'),
        title: z.string()
          .min(1)
          .max(200)
          .describe('Title of the advertisement (1-200 characters).'),
        description: z.string()
          .max(2000)
          .optional()
          .describe('Detailed description of the advertisement (max 2000 characters).'),
        call_to_action: z.string()
          .max(100)
          .optional()
          .describe('Call to action text (max 100 characters).'),
        link_url: z.string()
          .url()
          .optional()
          .describe('URL where users should be directed when clicking the ad. Must be a valid URL.'),
        latitude: z.number()
          .min(-90)
          .max(90)
          .optional()
          .describe('Latitude for geo-targeting (-90 to 90). Requires longitude to be provided.'),
        longitude: z.number()
          .min(-180)
          .max(180)
          .optional()
          .describe('Longitude for geo-targeting (-180 to 180). Requires latitude to be provided.'),
        days: z.number()
          .int()
          .min(1)
          .max(365)
          .describe('Number of days the ad should be active (1-365). Pricing: 0.1 USDC for first day, 0.05 USDC per additional day.'),
        min_age: z.number()
          .int()
          .min(0)
          .optional()
          .describe('Minimum age target for the advertisement (0+).'),
        max_age: z.number()
          .int()
          .min(0)
          .optional()
          .describe('Maximum age target for the advertisement (0+).'),
        location: z.string()
          .max(200)
          .optional()
          .describe('Location name/description for semantic search (max 200 characters). Used for location-based targeting and search.'),
        interests: z.array(z.string())
          .max(5)
          .optional()
          .describe('Interest tags for targeting (max 5 interests). Examples: "pizza", "delivery", "food", "berkeley".'),
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
        query: z.string()
          .optional()
          .describe('Semantic search query (e.g., "pizza delivery in Berkeley"). Uses Vectorize for semantic matching. When provided, performs semantic search; otherwise falls back to D1 database keyword search.'),
        latitude: z.number()
          .min(-90)
          .max(90)
          .optional()
          .describe('Latitude for geo-filtering (-90 to 90). Requires longitude and radius to be provided.'),
        longitude: z.number()
          .min(-180)
          .max(180)
          .optional()
          .describe('Longitude for geo-filtering (-180 to 180). Requires latitude and radius to be provided.'),
        radius: z.number()
          .min(0)
          .optional()
          .describe('Radius in kilometers for geo-filtering. Requires latitude and longitude to be provided.'),
        min_age: z.number()
          .int()
          .min(0)
          .optional()
          .describe('Filter results by minimum age target (0+).'),
        max_age: z.number()
          .int()
          .min(0)
          .optional()
          .describe('Filter results by maximum age target (0+).'),
        interests: z.array(z.string())
          .optional()
          .describe('Filter by interest tags. Examples: ["pizza", "delivery", "food"].'),
        tags: z.array(z.string())
          .optional()
          .describe('Filter by AI-generated tags. Use getAvailableTags to see available tags. Examples: ["product", "service", "job"].'),
        limit: z.number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Maximum number of results to return (default 50, max 100).'),
        offset: z.number()
          .int()
          .min(0)
          .optional()
          .describe('Offset for pagination (default 0). Use with limit for paginated results.'),
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
        ad_id: z.string()
          .uuid()
          .describe('The unique ID of the advertisement (UUID format). Example: "550e8400-e29b-41d4-a716-446655440000".'),
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
                prompts: {},
              },
              serverInfo: {
                name: 'threead-mcp-server',
                version: '0.1.0',
              },
            },
          };
        }

        if (req.method === 'prompts/list') {
          return {
            jsonrpc: '2.0',
            id: req.id,
            result: {
              prompts: [
                {
                  name: 'how_to_use_threead_tools',
                  description: 'Comprehensive guide on how to use Three.ad MCP tools effectively',
                  arguments: [],
                },
              ],
            },
          };
        }

        if (req.method === 'prompts/get') {
          const params = req.params as { name?: string } | undefined;
          const name = params?.name;

          if (name === 'how_to_use_threead_tools') {
            return {
              jsonrpc: '2.0',
              id: req.id,
              result: {
                description: 'Comprehensive guide on how to use Three.ad MCP tools effectively',
                messages: [
                  {
                    role: 'user',
                    content: {
                      type: 'text',
                      text: `# Three.ad MCP Tools Usage Guide

This guide explains how to effectively use the Three.ad MCP tools to post, search, and retrieve advertisements.

## Available Tools

### 1. postAd
Post a new advertisement to Three.ad. This tool requires payment via x402 protocol on Solana.

**Required Parameters:**
- \`payment_tx\` (string): Solana transaction signature containing x402 payment. Must be a valid base58 string. The transaction should contain a USDC transfer to the Three.ad treasury. The payer address will be extracted from this transaction.
- \`title\` (string): Advertisement title (1-200 characters)
- \`days\` (number): Number of days the ad will be active (1-365)

**Optional Parameters:**
- \`description\` (string): Detailed description (max 2000 characters)
- \`call_to_action\` (string): Call to action text (max 100 characters)
- \`link_url\` (string): Valid URL where users should be directed
- \`latitude\` (number): Latitude for geo-targeting (-90 to 90, requires longitude)
- \`longitude\` (number): Longitude for geo-targeting (-180 to 180, requires latitude)
- \`location\` (string): Location name/description for semantic search (max 200 characters)
- \`min_age\` (number): Minimum age target (0+)
- \`max_age\` (number): Maximum age target (0+)
- \`interests\` (array of strings): Interest tags for targeting (max 5 interests)

**Pricing:**
- Starts at 0.1 USDC for 1 day
- Additional days: 0.05 USDC per day
- With image: +1 USDC (currently deferred, will be available post-hackathon)

**Payment Process:**
1. Create a Solana transaction that transfers USDC to the Three.ad treasury address
2. Sign and send the transaction
3. Use the transaction signature as the \`payment_tx\` parameter
4. The system will verify the payment and extract the payer address

**Example Usage:**
\`\`\`json
{
  "payment_tx": "5VERv8NMvzbJMEKV8ghdqxEdNd5d3okZcs5c1a16S45z9W4WSKxE2TG8Zn2vZv2XZ26poizCHY5vdYMBKCYeg4KG",
  "title": "Pizza Delivery in Berkeley",
  "description": "Fresh pizza delivered to your door in 30 minutes or less",
  "call_to_action": "Order Now",
  "link_url": "https://example.com/pizza",
  "latitude": 37.8715,
  "longitude": -122.2730,
  "location": "Berkeley, CA",
  "days": 7,
  "interests": ["pizza", "food", "delivery"]
}
\`\`\`

**Important Notes:**
- Payment verification is required - invalid or insufficient payments will be rejected
- Ads are automatically moderated by AI (score 0-10)
- Malicious or illegal content will be shadow-banned (payment still charged)
- Tags are automatically assigned by AI based on content analysis

### 2. queryAds
Search and query advertisements using semantic search, location, age, interest, and tag filters. This tool is free to use.

**Optional Parameters:**
- \`query\` (string): Semantic search query (e.g., "pizza delivery in Berkeley"). Uses Vectorize for semantic matching.
- \`latitude\` (number): Latitude for geo-filtering (-90 to 90, requires longitude and radius)
- \`longitude\` (number): Longitude for geo-filtering (-180 to 180, requires latitude and radius)
- \`radius\` (number): Radius in kilometers for geo-filtering (requires lat/lon)
- \`min_age\` (number): Filter by minimum age target
- \`max_age\` (number): Filter by maximum age target
- \`interests\` (array of strings): Filter by interest tags
- \`tags\` (array of strings): Filter by AI-generated tags (use getAvailableTags to see available tags)
- \`limit\` (number): Maximum number of results (default 50, max 100)
- \`offset\` (number): Offset for pagination (default 0)

**Search Behavior:**
- When \`query\` is provided: Performs semantic search using Cloudflare Vectorize with embeddings
- When no \`query\` is provided: Falls back to D1 database keyword search
- Results are filtered by expiry date (only active ads)
- Only visible ads (not shadow-banned) are returned

**Example Usage:**
\`\`\`json
{
  "query": "coffee shop near campus",
  "latitude": 37.8715,
  "longitude": -122.2730,
  "radius": 5,
  "tags": ["food", "services"],
  "limit": 10
}
\`\`\`

### 3. getAdDetails
Get detailed information about a specific advertisement by its ID.

**Required Parameters:**
- \`ad_id\` (string): UUID of the advertisement

**Returns:**
- Complete ad information including title, description, location, expiry, analytics, etc.

**Example Usage:**
\`\`\`json
{
  "ad_id": "550e8400-e29b-41d4-a716-446655440000"
}
\`\`\`

### 4. getAvailableTags
Get the list of available tags that can be used for categorizing and filtering advertisements.

**Parameters:**
- None required

**Returns:**
- List of available tags (e.g., "job", "services", "product", "housing", "food", etc.)
- These tags are automatically assigned to ads during creation via AI analysis
- Can be used in \`queryAds\` to filter results

**Example Usage:**
\`\`\`json
{}
\`\`\`

## Best Practices

1. **Before posting an ad:**
   - Use \`getAvailableTags\` to understand available tag categories
   - Ensure you have completed the x402 payment transaction
   - Provide clear, accurate information in title and description

2. **When searching:**
   - Use semantic search (\`query\`) for natural language queries
   - Combine filters (location, tags, interests) for better results
   - Use pagination (\`limit\`/\`offset\`) for large result sets

3. **Payment:**
   - Always verify your transaction signature is valid before submitting
   - Ensure sufficient USDC balance for the payment amount
   - Payment amount is calculated based on days: 0.1 USDC for first day + 0.05 USDC per additional day

4. **Content Guidelines:**
   - Ads are automatically moderated - avoid prohibited content
   - Be accurate and truthful in your descriptions
   - Use appropriate tags and interests for better targeting

## Error Handling

- Payment verification failures: Check transaction signature and amount
- Validation errors: Verify all required parameters are provided and meet constraints
- Not found errors: Ensure ad_id is valid UUID format
- Server errors: Retry request or check server status

## Support

For issues or questions, refer to the Three.ad documentation or check the API response errors for detailed information.`,
                    },
                  },
                ],
              },
            };
          }

          return {
            jsonrpc: '2.0',
            id: req.id,
            error: {
              code: -32601,
              message: 'Method not found',
              data: `Prompt "${name}" not found`,
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
