# Three.ad Backend

Cloudflare Workers backend for Three.ad - handles REST API and MCP protocol.

## Testing

### Quick Test (Health Endpoint)

```bash
# Start dev server
npm run dev:backend

# In another terminal, test health endpoint
curl http://localhost:8787/health
# Should return: OK
```

### Integration Tests

1. Start the dev server:
```bash
npm run dev:backend
```

2. In another terminal, run tests:
```bash
npm test
# Or remove .skip from test files and run specific tests
```

### Manual API Testing

Test the ads endpoint:

```bash
# 1. Test 402 Payment Required response (no payment header)
curl -X POST http://localhost:8787/api/ads \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Ad",
    "days": 1
  }'

# Expected: 402 status with payment requirements

# 2. Query ads
curl http://localhost:8787/api/ads

# Expected: 200 status with ads array
```

## Environment Variables

Create `.dev.vars` file for local development:

```toml
SOLANA_RPC_URL=https://api.devnet.solana.com
RECIPIENT_WALLET=your_wallet_address
RECIPIENT_TOKEN_ACCOUNT=your_usdc_token_account
```

Or set via wrangler:
```bash
wrangler secret put SOLANA_RPC_URL
wrangler secret put RECIPIENT_WALLET
wrangler secret put RECIPIENT_TOKEN_ACCOUNT
```

## D1 Database

D1 works **offline** with `wrangler dev`. The local runtime uses SQLite:
- Full SQL support with indexes
- Geo queries with distance calculations
- Persistence (data in `.wrangler/state/v3/d1/`)
- Same SQLite engine as production

### Setup

```bash
# Create D1 database (first time only)
npm run db:create

# Run migrations (local)
npm run db:migrate

# Run migrations (remote/production)
npm run db:migrate:remote
```

The database is automatically initialized on first use in the worker.

## Development

```bash
# Type check
npm run typecheck

# Run tests
npm test

# Watch mode tests
npm run test:watch

# Start dev server
npm run dev:backend
```

