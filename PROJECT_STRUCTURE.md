# Three.ad Project Structure

## Proposed Directory Structure

```
threead/
├── packages/
│   ├── shared/                    # Shared types and utilities
│   │   ├── src/
│   │   │   ├── types/
│   │   │   │   ├── ad.ts          # Ad data types
│   │   │   │   ├── payment.ts     # x402 payment types
│   │   │   │   └── api.ts         # API request/response types
│   │   │   ├── utils/
│   │   │   │   ├── pricing.ts     # Pricing calculation logic
│   │   │   │   └── validation.ts  # Ad validation helpers
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── frontend/                  # React + Vite frontend
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── AdCard.tsx
│   │   │   │   ├── AdForm.tsx
│   │   │   │   ├── PaymentModal.tsx
│   │   │   │   └── SearchBar.tsx
│   │   │   ├── hooks/
│   │   │   │   ├── useWallet.ts   # @solana/kit wallet integration
│   │   │   │   ├── useAds.ts      # Ad fetching/mutations
│   │   │   │   └── usePayment.ts  # x402 payment handling
│   │   │   ├── atoms/             # Jotai atoms
│   │   │   │   ├── adAtom.ts
│   │   │   │   └── walletAtom.ts
│   │   │   ├── lib/
│   │   │   │   └── solana.ts      # Solana config
│   │   │   ├── App.tsx
│   │   │   ├── main.tsx
│   │   │   └── index.css          # Tailwind imports
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vite.config.ts
│   │
│   └── backend/                   # Cloudflare Workers backend (REST API + MCP)
│       ├── src/
│       │   ├── routes/
│       │   │   ├── ads.ts         # REST: Ad CRUD endpoints
│       │   │   ├── search.ts      # REST: Semantic search endpoint
│       │   │   ├── payment.ts     # REST: x402 payment verification
│       │   │   └── media.ts       # REST: R2 image upload/serve
│       │   ├── mcp/
│       │   │   ├── server.ts      # MCP protocol handler
│       │   │   └── tools/
│       │   │       ├── postAd.ts  # MCP tool: post ad (calls services)
│       │   │       ├── queryAds.ts # MCP tool: semantic query (calls services)
│       │   │       └── getAdDetails.ts # MCP tool: get ad details
│       │   ├── services/
│       │   │   ├── moderation.ts  # AI moderation scoring
│       │   │   ├── vectorize.ts   # Vectorize operations
│       │   │   └── solana.ts      # Solana tx verification
│       │   ├── utils/
│       │   │   ├── pricing.ts
│       │   │   └── validation.ts
│       │   └── index.ts           # Worker entry point (routes REST + MCP)
│       ├── wrangler.toml          # Cloudflare config
│       ├── package.json
│       └── tsconfig.json
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── API.md
│   ├── MCP.md                     # MCP usage documentation
│   ├── DEPLOYMENT.md
│   └── CONTRIBUTING.md
│
├── scripts/
│   ├── setup-vectorize.ts        # Vectorize index creation
│   ├── migrate.ts                 # DB migrations
│   └── cleanup-expired.ts         # Cleanup expired ads
│
├── .cursorrules                   # AI assistant rules
├── .gitignore
├── LICENSE                        # Strict open source license
├── README.md
└── package.json                   # Root workspace config (npm workspaces)
```

## Key Decisions

### 1. **Monorepo Structure**
- Use npm workspaces (built-in since npm 7+) to share types between frontend/backend
- `packages/shared` contains common types and utilities
- Simple and widely supported - no additional tooling needed

### 2. **Backend Architecture (Combined REST API + MCP)**
- **Single Cloudflare Worker** (`packages/backend/src/index.ts`) serves both:
  - REST API endpoints (`/api/*`) for frontend/web clients
  - MCP protocol endpoints (`/mcp/v1/*`) for AI agents
- **Shared Services Layer**: Both REST and MCP routes use the same services:
  - `services/` - Business logic (moderation, vectorize, solana, db)
  - D1 - SQLite database for ad storage
  - Vectorize - Semantic search index
  - R2 - Image storage
- **Benefits**: Single deployment, no network overhead, shared logic, easier maintenance

### 3. **MCP Integration**
- MCP protocol handled in `backend/src/mcp/server.ts`
- MCP tools in `backend/src/mcp/tools/` call the same services as REST endpoints
- No separate service needed - MCP is just another HTTP protocol on the same worker

### 4. **Frontend**
- Vite + React + TypeScript
- Jotai for state management (atoms in `src/atoms/`)
- @solana/kit for wallet interactions
- Tailwind CSS 4.x for styling (CSS-based config, no .js/.json config file)
- Calls REST API endpoints from the backend worker

### 5. **Payment Flow (x402)**
- Backend verifies Solana transactions directly (no facilitator needed)
- Payment verification in `packages/backend/src/services/solana.ts`
- Frontend handles payment UI and transaction signing
- Both REST and MCP can initiate/verify payments

## Architecture Flow

### Request Flow

**Frontend → REST API:**
```
Frontend → /api/ads (POST) → routes/ads.ts → services/* → D1/Vectorize
```

**MCP Agent → MCP Protocol:**
```
MCP Client → /mcp/v1/tools/call → mcp/server.ts → mcp/tools/postAd.ts → services/* → D1/Vectorize
```

Both paths use the **same services layer**, ensuring consistency and eliminating duplication.

## Next Steps

1. Initialize monorepo structure
2. Set up Cloudflare Workers project with D1 database
3. Create shared types package
4. Set up frontend with Vite + React
5. Implement backend services layer (moderation, vectorize, solana)
6. Add REST API routes
7. Add MCP protocol handler and tools
8. Integrate Vectorize for semantic search
9. Add payment verification logic

