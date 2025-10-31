# Three.ad

A simple way to post ads with x402 payments on Solana.

## Project Status

🚧 **In Development** - Backend setup in progress

## Architecture

- **Frontend**: React + Vite + Tailwind CSS 4 + Jotai
- **Backend**: Cloudflare Workers + Durable Objects + Vectorize + R2
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

# Start backend dev server
npm run dev:backend

# Start frontend dev server (when ready)
npm run dev:frontend
```

## Project Structure

See [PROJECT_STRUCTURE.md](./PROJECT_STRUCTURE.md) for details.

## License

AGPL-3.0 (strict open source - see LICENSE file)

