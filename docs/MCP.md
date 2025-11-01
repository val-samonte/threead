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

**Note:** During development, payment verification is skipped. The `payment_tx` field will be set to a placeholder value (`dev-bypass-{uuid}`).

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

**Note:** Semantic search via Vectorize is not yet implemented. Currently returns D1 database results only.

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

## Development Notes

- **Payment Verification**: Currently disabled for development. Ads can be created without x402 payment verification.
- **Vectorize Integration**: Semantic search is not yet implemented. The `queryAds` tool currently returns D1 database results only.
- **Media Upload**: Not yet implemented. Media uploads will be added in a future update.

## Future Enhancements

1. Vectorize integration for semantic search
2. Cloudflare Workers AI for improved moderation
3. R2 image upload support
4. x402 payment verification integration

