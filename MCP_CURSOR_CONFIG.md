# MCP Configuration for Cursor

## Status: ✅ Fully Working

The MCP server is fully implemented and working. Three tools are available:
- `postAd` - Create new advertisements (requires x402 payment)
- `queryAds` - Search and query advertisements with semantic search
- `getAdDetails` - Get detailed information about a specific ad

## Adding to Cursor

### Option 1: Add to Cursor Settings (Recommended)

1. Open Cursor Settings (Cmd/Ctrl + ,)
2. Search for "MCP" or "Model Context Protocol"
3. Add the following configuration:

```json
{
  "mcpServers": {
    "threead": {
      "name": "Three.ad MCP Server",
      "description": "MCP server for posting, querying, and retrieving advertisements on Three.ad",
      "url": "http://localhost:8787/mcp/",
      "transport": "http",
      "headers": {
        "Content-Type": "application/json"
      }
    }
  }
}
```

### Option 2: Use Configuration File

Copy the configuration from `.cursor-mcp.json` in this repository to your Cursor MCP configuration file.

## Prerequisites

1. **Start the backend server**:
   ```bash
   npm run dev:backend
   ```
   The server runs on `http://localhost:8787` by default.

2. **Verify MCP endpoint is working**:
   ```bash
   curl -X POST http://localhost:8787/mcp/ \
     -H "Content-Type: application/json" \
     -d '{
       "jsonrpc": "2.0",
       "id": "1",
       "method": "initialize",
       "params": {}
     }'
   ```

## Available Tools

### postAd
Post a new advertisement. Requires `payment_tx` (x402 payment transaction signature).

**Example:**
```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "tools/call",
  "params": {
    "name": "postAd",
    "arguments": {
      "payment_tx": "your-solana-tx-signature",
      "title": "Pizza Delivery in Berkeley",
      "description": "Fresh pizza delivered to your door",
      "days": 7,
      "location": "Berkeley, CA"
    }
  }
}
```

### queryAds
Search advertisements using semantic search, location, age, and interest filters.

**Example:**
```json
{
  "jsonrpc": "2.0",
  "id": "2",
  "method": "tools/call",
  "params": {
    "name": "queryAds",
    "arguments": {
      "query": "pizza delivery",
      "latitude": 37.8715,
      "longitude": -122.2730,
      "radius": 10
    }
  }
}
```

### getAdDetails
Get detailed information about a specific advertisement by ID.

**Example:**
```json
{
  "jsonrpc": "2.0",
  "id": "3",
  "method": "tools/call",
  "params": {
    "name": "getAdDetails",
    "arguments": {
      "ad_id": "uuid-here"
    }
  }
}
```

## Production Deployment

For production, update the `url` in the configuration to your deployed worker URL:
```json
{
  "url": "https://your-worker.workers.dev/mcp/"
}
```

## Documentation

See [docs/MCP.md](./docs/MCP.md) for complete API documentation.

