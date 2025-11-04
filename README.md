# Three.ad

A simple way to post ads with x402 payments on Solana.

## Project Status

🚧 **In Development** - Backend setup in progress

## Architecture

- **Frontend**: React + Vite + Tailwind CSS 4 + Jotai
- **Backend**: Cloudflare Workers + D1 + Vectorize + R2
- **Payments**: x402 protocol with direct Solana verification
- **MCP**: Model Context Protocol integration for AI agents

## Getting Started

### Prerequisites

- Node.js 18+
- npm (workspaces)
- Cloudflare account
- Wrangler CLI (installed via npm)

### Setup

```bash
# Install dependencies
npm install

# Start backend dev server (runs on http://localhost:8787)
npm run dev:backend

# Start frontend dev server (when ready)
npm run dev:frontend
```

### Testing

```bash
# Run unit tests
cd packages/backend
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Integration tests (requires wrangler dev running)
# In one terminal: npm run dev:backend
# In another: npm test
```

## MCP Integration

Three.ad provides an MCP (Model Context Protocol) server for AI agents to post and query advertisements.

- **MCP Documentation**: See [docs/MCP.md](./docs/MCP.md) for tool documentation
- **Client Setup Guide**: See [docs/MCP_CLIENT_SETUP.md](./docs/MCP_CLIENT_SETUP.md) for configuring MCP clients (Cursor, Claude Desktop, Continue.dev, etc.)

Quick start for Cursor:
1. Add to `~/.cursor/mcp.json`:
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
2. Start backend: `npm run dev:backend`
3. Restart Cursor

## Project Structure

See [PROJECT_STRUCTURE.md](./PROJECT_STRUCTURE.md) for details.

## License

AGPL-3.0 (strict open source - see LICENSE file)

