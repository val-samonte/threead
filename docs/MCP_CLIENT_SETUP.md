# MCP Client Setup Guide

This guide explains how to add the Three.ad MCP server to various MCP-compatible clients.

## Server Information

- **Protocol**: MCP (Model Context Protocol) over HTTP
- **Transport**: HTTP POST with JSON-RPC 2.0
- **Endpoint**: 
  - **Local Development**: `http://localhost:8787/mcp/`
  - **Production**: `https://your-worker-domain.workers.dev/mcp/` (after deployment)

## Available Tools

The Three.ad MCP server provides the following tools:

1. **`postAd`** - Post a new advertisement (requires x402 payment)
2. **`queryAds`** - Search advertisements using semantic search, location, age, interest, and tag filters
3. **`getAdDetails`** - Get detailed information about a specific advertisement by ID
4. **`getAvailableTags`** - Get the list of available tags for categorizing and filtering advertisements

See [MCP.md](./MCP.md) for detailed tool documentation.

---

## Client-Specific Setup

### 1. Cursor

Cursor uses a configuration file at `~/.cursor/mcp.json` (macOS/Linux) or `%APPDATA%\Cursor\mcp.json` (Windows).

**Configuration:**

```json
{
  "mcpServers": {
    "threead": {
      "name": "Three.ad",
      "description": "Post ads and pay via x402 on Solana. Search and retrieve ads for free using semantic search.",
      "url": "http://localhost:8787/mcp/",
      "transport": "http",
      "headers": {
        "Content-Type": "application/json"
      }
    }
  }
}
```

**For Production:**
```json
{
  "mcpServers": {
    "threead": {
      "name": "Three.ad",
      "description": "Post ads and pay via x402 on Solana. Search and retrieve ads for free using semantic search.",
      "url": "https://your-worker-domain.workers.dev/mcp/",
      "transport": "http",
      "headers": {
        "Content-Type": "application/json"
      }
    }
  }
}
```

**After updating:**
- Restart Cursor to load the new configuration
- The MCP server will appear in the available tools list

---

### 2. Claude Desktop (Anthropic)

Claude Desktop uses a configuration file at:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

**Configuration:**

```json
{
  "mcpServers": {
    "threead": {
      "name": "Three.ad",
      "description": "Post ads and pay via x402 on Solana. Search and retrieve ads for free using semantic search.",
      "url": "http://localhost:8787/mcp/",
      "transport": "http",
      "headers": {
        "Content-Type": "application/json"
      }
    }
  }
}
```

**For Production:**
Replace `http://localhost:8787/mcp/` with your production URL.

**After updating:**
- Restart Claude Desktop
- The tools will be available in Claude Desktop conversations

---

### 3. Continue.dev

Continue.dev uses a configuration file at `~/.continue/config.json` (or similar, depending on your setup).

**Configuration:**

```json
{
  "mcpServers": {
    "threead": {
      "name": "Three.ad",
      "description": "Post ads and pay via x402 on Solana. Search and retrieve ads for free using semantic search.",
      "url": "http://localhost:8787/mcp/",
      "transport": "http",
      "headers": {
        "Content-Type": "application/json"
      }
    }
  }
}
```

**After updating:**
- Restart Continue.dev
- The tools will be available in your Continue workflows

---

### 4. Generic MCP Client

For any MCP client that supports HTTP transport, use the following configuration:

**Endpoint:** `http://localhost:8787/mcp/` (or your production URL)

**Protocol:** JSON-RPC 2.0 over HTTP POST

**Headers:**
- `Content-Type: application/json`

**Example Request:**

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

**Example Tool Call:**

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
        "query": "pizza delivery",
        "limit": 10
      }
    }
  }'
```

---

## Testing Your Connection

After configuring your client, test the connection:

### 1. Initialize the connection

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

Expected response:
```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "result": {
    "protocolVersion": "2024-11-05",
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

### 2. List available tools

```bash
curl -X POST http://localhost:8787/mcp/ \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "2",
    "method": "tools/list",
    "params": {}
  }'
```

Expected response:
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
      {
        "name": "queryAds",
        "description": "Search and query advertisements...",
        "inputSchema": { ... }
      },
      {
        "name": "getAdDetails",
        "description": "Get detailed information about a specific advertisement...",
        "inputSchema": { ... }
      },
      {
        "name": "getAvailableTags",
        "description": "Get the list of available tags...",
        "inputSchema": { ... }
      }
    ]
  }
}
```

### 3. Call a tool (queryAds example)

```bash
curl -X POST http://localhost:8787/mcp/ \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "3",
    "method": "tools/call",
    "params": {
      "name": "queryAds",
      "arguments": {
        "query": "pizza",
        "limit": 5
      }
    }
  }'
```

---

## Production Deployment

Before using in production:

1. **Deploy your Cloudflare Worker:**
   ```bash
   cd packages/backend
   npx wrangler deploy
   ```

2. **Update client configuration** with your production URL:
   ```json
   {
     "url": "https://your-worker-domain.workers.dev/mcp/"
   }
   ```

3. **Verify the endpoint is accessible:**
   ```bash
   curl -X POST https://your-worker-domain.workers.dev/mcp/ \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":"1","method":"initialize","params":{}}'
   ```

---

## Troubleshooting

### Connection Issues

- **"Connection refused"**: Make sure the backend worker is running (`npm run dev:backend`)
- **"404 Not Found"**: Verify the endpoint path is `/mcp/` (with trailing slash)
- **"Method not allowed"**: Ensure you're using POST requests, not GET

### Authentication Issues

- Currently, the MCP endpoint is public (no authentication required)
- For production, consider adding API key authentication if needed

### Tool Not Found

- Verify the tool name matches exactly (case-sensitive)
- Check that the MCP server is properly initialized
- Review server logs for errors

### JSON-RPC Errors

- Ensure your request follows JSON-RPC 2.0 format
- Check that `jsonrpc: "2.0"` is included in your request
- Verify all required parameters are provided

---

## Security Considerations

1. **Local Development**: The server runs on `localhost` and is safe for local testing
2. **Production**: Consider adding:
   - API key authentication
   - Rate limiting
   - CORS restrictions
   - Request validation

---

## Additional Resources

- [MCP Protocol Specification](https://modelcontextprotocol.io/)
- [Three.ad MCP Documentation](./MCP.md)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)

