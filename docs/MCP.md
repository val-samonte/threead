# MCP (Model Context Protocol) Integration

Three.ad provides an MCP server that allows AI agents to post, query, and retrieve advertisements programmatically.

## Endpoint

The MCP server is available at `/mcp/` on the backend worker.

## Protocol

The MCP server implements JSON-RPC 2.0 protocol. All requests should be sent as JSON-RPC 2.0 requests with the following structure:

```json
{
  "jsonrpc": "2.0",
  "id": "unique-request-id",
  "method": "method-name",
  "params": {}
}
```

## Available Methods

### `initialize`

Initialize the MCP connection. Returns server capabilities and info.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "initialize",
  "params": {}
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "result": {
    "protocolVersion": "1.0",
    "capabilities": {
      "tools": {}
    },
    "serverInfo": {
      "name": "threead-mcp-server",
      "version": "0.1.0"
    }
  }
}
```

### `tools/list`

List all available tools.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": "2",
  "method": "tools/list",
  "params": {}
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": "2",
  "result": {
    "tools": [
      {
        "name": "postAd",
        "description": "Post a new advertisement to Three.ad...",
        "inputSchema": { ... }
      },
      ...
    ]
  }
}
```

### `tools/call`

Call a specific tool.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": "3",
  "method": "tools/call",
  "params": {
    "name": "postAd",
    "arguments": {
      "title": "Pizza Delivery in Berkeley",
      "description": "Fresh pizza delivered to your door",
      "days": 7,
      "location": "Berkeley, CA"
    }
  }
}
```

## Available Tools

### `postAd`

Create a new advertisement.

**Arguments:**
- `payment_tx` (required, string): Solana transaction signature containing x402 payment (USDC transfer to treasury). Must be valid base58 characters. The author (payer) will be extracted from this transaction.
- `title` (required, string): Title of the advertisement (max 200 chars)
- `description` (optional, string): Detailed description (max 2000 chars)
- `call_to_action` (optional, string): Call to action text (max 100 chars)
- `link_url` (optional, string): URL where users should be directed (must be valid URL)
- `latitude` (optional, number): Latitude for geo-targeting (requires longitude)
- `longitude` (optional, number): Longitude for geo-targeting (requires latitude)
- `days` (required, number): Number of days the ad should be active (1-365)
- `min_age` (optional, number): Minimum age target (0+)
- `max_age` (optional, number): Maximum age target (0+)
- `location` (optional, string): Location name/description for semantic search (max 200 chars)
- `interests` (optional, array of strings): Interest tags for targeting (max 5 interests)

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": "3",
  "result": {
    "success": true,
    "ad": {
      "ad_id": "uuid-here",
      "title": "Pizza Delivery in Berkeley",
      ...
    }
  }
}
```

**Note:** Payment verification is required. The `payment_tx` field must be a valid Solana transaction signature containing a USDC transfer to the treasury address. The author (payer) will be extracted from the payment transaction.

### `queryAds`

Search and query advertisements.

**Arguments:**
- `query` (optional, string): Semantic search query (e.g., "pizza delivery in Berkeley")
- `latitude` (optional, number): Latitude for geo-filtering (requires longitude and radius)
- `longitude` (optional, number): Longitude for geo-filtering (requires latitude and radius)
- `radius` (optional, number): Radius in kilometers for geo-filtering (requires lat/lon)
- `min_age` (optional, number): Filter by minimum age target
- `max_age` (optional, number): Filter by maximum age target
- `interests` (optional, array of strings): Filter by interest tags
- `tags` (optional, array of strings): Filter by AI-generated tags (e.g., ["product", "service", "job"])
- `limit` (optional, number): Maximum number of results (default 50, max 100)
- `offset` (optional, number): Offset for pagination (default 0)

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": "4",
  "result": {
    "success": true,
    "result": {
      "ads": [...],
      "total": 10,
      "limit": 50,
      "offset": 0
    }
  }
}
```

**Note:** Semantic search via Vectorize is fully implemented. When a `query` parameter is provided, the tool performs semantic search using Cloudflare Vectorize with embeddings. When no query is provided, it falls back to D1 database keyword search.

### `getAdDetails`

Get detailed information about a specific advertisement by ID.

**Arguments:**
- `ad_id` (required, string): The unique ID of the advertisement (UUID)

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": "5",
  "result": {
    "success": true,
    "ad": {
      "ad_id": "uuid-here",
      "title": "...",
      ...
    }
  }
}
```

### `getAvailableTags`

Get the list of available tags that can be used for categorizing and filtering advertisements. These tags are automatically assigned to ads during creation via AI analysis, and can be used in `queryAds` to filter results.

**Arguments:**
- None (no parameters required)

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": "6",
  "result": {
    "success": true,
    "tags": [
      "job",
      "services",
      "product",
      "looking-for",
      "event",
      "housing",
      "food",
      "entertainment",
      "education",
      "healthcare",
      "automotive",
      "clothing",
      "electronics",
      "furniture",
      "real-estate",
      "transportation",
      "business",
      "community",
      "sports",
      "art",
      "music",
      "travel",
      "beauty",
      "fitness",
      "technology",
      "finance",
      "legal",
      "repair",
      "cleaning",
      "delivery"
    ],
    "count": 30,
    "description": "Available tags for categorizing and filtering advertisements. These tags can be used in the queryAds tool to filter results, and are automatically assigned to ads during creation via AI analysis."
  }
}
```

**Note:** This tool helps agents understand what tags are available when creating or querying ads. Tags are used for categorization and filtering of advertisements.

## Error Handling

The MCP server follows JSON-RPC 2.0 error codes:

- `-32700`: Parse error
- `-32600`: Invalid Request
- `-32601`: Method not found
- `-32603`: Internal error

Error responses will have this structure:

```json
{
  "jsonrpc": "2.0",
  "id": "request-id",
  "error": {
    "code": -32603,
    "message": "Internal error",
    "data": "Error details..."
  }
}
```

Tool-specific errors (e.g., validation failures) will return `success: false` in the result:

```json
{
  "jsonrpc": "2.0",
  "id": "request-id",
  "result": {
    "success": false,
    "error": "Validation failed: title is required"
  }
}
```

## Example Usage

### Post an Ad

```bash
curl -X POST http://localhost:8787/mcp/ \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "tools/call",
    "params": {
      "name": "postAd",
      "arguments": {
        "payment_tx": "YOUR_SOLANA_TRANSACTION_SIGNATURE_HERE",
        "title": "Coffee Shop Opening",
        "description": "New coffee shop opening in downtown Berkeley",
        "days": 30,
        "location": "Berkeley, CA",
        "latitude": 37.8715,
        "longitude": -122.2730,
        "interests": ["coffee", "berkeley"]
      }
    }
  }'
```

### Query Ads

```bash
curl -X POST http://localhost:8787/mcp/ \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "2",
    "method": "tools/call",
    "params": {
      "name": "queryAds",
      "arguments": {
        "query": "coffee shop",
        "latitude": 37.8715,
        "longitude": -122.2730,
        "radius": 5,
        "limit": 10
      }
    }
  }'
```

### Get Ad Details

```bash
curl -X POST http://localhost:8787/mcp/ \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "3",
    "method": "tools/call",
    "params": {
      "name": "getAdDetails",
      "arguments": {
        "ad_id": "uuid-here"
      }
    }
  }'
```

### Get Available Tags

```bash
curl -X POST http://localhost:8787/mcp/ \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "4",
    "method": "tools/call",
    "params": {
      "name": "getAvailableTags",
      "arguments": {}
    }
  }'
```

## Development Notes

- **Payment Verification**: ✅ Fully implemented. All ads require a valid x402 payment transaction signature (`payment_tx`). Payment verification includes transaction validation, amount checking, and payer extraction.
- **Vectorize Integration**: ✅ Fully implemented. Semantic search uses Cloudflare Vectorize with `@cf/baai/bge-small-en-v1.5` embeddings (384 dimensions). Automatic indexing on ad creation.
- **AI Moderation**: ✅ Fully implemented. Uses Cloudflare Workers AI (`@cf/meta/llama-3.2-3b-instruct`) for content moderation with scoring (0-10) and automatic shadow banning.
- **AI Tagging**: ✅ Fully implemented. Automatic tag generation using Cloudflare Workers AI (30 predefined tags).
- **Analytics**: ✅ Fully implemented. Impression and click tracking with server-side deduplication.
- **Media Upload**: Deferred until after hackathon. Media uploads will be added post-hackathon. Currently, ads can use `og:image` scraping from `link_url` via frontend.

## Future Enhancements

1. Frontend implementation (hackathon priority)
2. Cloudflare Agents x402 integration (using `withX402` from Cloudflare Agents platform)
3. R2 image upload support (post-hackathon)

