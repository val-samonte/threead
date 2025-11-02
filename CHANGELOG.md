# Changelog

All notable changes to Three.ad will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### 2025-11-01 (Later) - Payment Verification RPC Indexing Fixes

#### Changed
- Added retry logic with exponential backoff to `verifyPayment()` function (up to 3 retries with 1s, 2s, 4s delays)
- Added `commitment: 'confirmed'` to `getTransaction` calls in `verifyPayment()` for consistency
- Added 3-second delay in payment tests after transaction confirmation before API verification to allow RPC indexing
- Improved error handling for RPC indexing delays when querying recently confirmed transactions

#### Fixed
- Payment verification now handles RPC indexing delays correctly
- Transactions that are confirmed on-chain but not yet queryable via RPC are now retried automatically
- All payment tests now passing consistently (4/4 tests passing)

### 2025-11-01 - x402 Payment Implementation & Floating Point Fixes

#### Added
- x402 payment verification with Solana transaction parsing and USDC transfer validation
- Payment verification extracts payer address from transaction signature
- Verifies USDC token transfers to treasury address (Hf1BvFzfGiAzPoV6oHWSxQuNEiGxyULuZh8zU4ZMknFM)
- Checks transaction confirmation, success status, and amount matching
- Added `verifyPayment()` function in `services/solana.ts` that parses transaction metadata
- Validates token balance changes from pre-balances to post-balances
- Supports amount tolerance for rounding (1 smallest unit difference allowed)
- Treasury address constant for payment recipient
- Faucet keypair generation script (`npm run faucet:generate`) for test funding
- Faucet keypairs saved as `faucet.keypair.json` (excluded from git via `.gitignore`)
- Uses Web Crypto API to generate extractable Ed25519 keypairs
- Exports keypair in Solana secret key format (64 bytes: private + public)
- Test utilities for payment transactions (`test/utils/payment.ts`)
- Test utilities for generating payer keypairs (`generatePayerKeypair()`)
- `calculatePriceSmallestUnits()` function to avoid floating point precision issues
- Added `*.keypair.json` to `.gitignore` for security

#### Changed
- Removed nonce-based authentication in favor of x402 payment-based identity verification
- `payment_tx` is now required in ad creation (author extracted from transaction)
- Payment verification is required for all ad creation (removed dev-bypass)
- Author (payer) is now extracted directly from payment transaction signature
- Updated MCP `postAd` tool to only accept `payment_tx` (removed nonce option)
- Simplified authentication flow: payment transaction signature proves identity
- Payment verification now extracts payer and verifies transaction in one step
- Both REST API and MCP routes verify payment before creating ads
- Payment verification checks: transaction existence, confirmation, success, and amount matching
- Pricing calculations now work entirely in smallest units (integers) to prevent precision errors
- Test helpers updated to use `createAdWithPayment()` instead of nonce-based flow
- Updated `createAdService()` to accept `author` as separate parameter instead of in request

#### Removed
- Nonce-based wallet authentication system (`services/auth.ts`)
- `/api/ads/nonce` endpoint
- `author`, `signature`, and `nonce` fields from `CreateAdRequestSchema`
- Deprecated `calculatePrice()` function (replaced with `calculatePriceSmallestUnits()`)
- Unused `usdcToSmallestUnits()` function
- Unused payment interfaces: `PaymentVerificationResult`, `X402PaymentProof`, `PaymentRequirements`
- Obsolete nonce generation tests from `api.test.ts`
- Unused `rpcUrl` parameter from `generatePayerKeypair()`
- Unused `SOLANA_RPC_URL` constant from test helpers

#### Fixed
- Floating point precision issues in pricing calculations by working directly in smallest units
- TypeScript compilation errors after removing nonce-based auth
- Unused imports and variables across codebase

---

### Previous Sessions - Analytics & Tracking

#### Added
- Impression tracking system with server-side deduplication (30-minute window)
  - Created `Impressions` database table to track ad views with source attribution (MCP vs app)
  - Added impression tracking endpoint: `GET/POST /api/ads/:id/impression?source=mcp|app`
  - Endpoint returns JSON response with success status
  - Tracks metadata: source (mcp/app), user agent, referrer, IP address
- Server-side deduplication: Prevents duplicate impressions from same `ad_id + IP + user_agent` within 30-minute window
  - Automatic impression tracking in MCP tools:
    - `queryAds` tracks impressions for all returned ads (batch insert with deduplication)
    - `getAdDetails` tracks impression when ad details are retrieved
  - Batch impression recording for efficiency (used in MCP queryAds)
  - Non-blocking tracking: failures don't break ad queries
  - Database service functions: `recordImpression()` (returns boolean for dedupe status), `recordImpressions()` (returns count), `getImpressionCount()`
  - Composite index on `(ad_id, ip_address, user_agent, created_at)` for fast deduplication lookups
- Click tracking system with redirect proxy and deduplication
  - Created `Clicks` database table to track when users click ad links
  - Added click tracking endpoint: `GET /api/ads/:id/click?source=mcp|app` (redirects to ad `link_url`)
  - Server-side deduplication: Prevents duplicate clicks from same `ad_id + IP + user_agent` within 30-minute window
  - Non-blocking click recording: tracking happens asynchronously, redirect is immediate
  - Frontend should use proxy URL instead of direct `link_url`: `/api/ads/{ad_id}/click?source=app`
  - Database service functions: `recordClick()` (returns boolean for dedupe status), `getClickCount()`
  - Composite index on `(ad_id, ip_address, user_agent, created_at)` for fast deduplication lookups
  - Integration tests: `analytics.test.ts` covers impression tracking, click tracking, deduplication, and metadata capture

---

### Previous Sessions - AI Features & Tagging

#### Added
- AI-generated tags for ad categorization
  - Created tag generation service (`services/tags.ts`) using Cloudflare Workers AI
  - 30 predefined tags available (job, services, product, finance, etc.)
  - AI analyzes ad content (title, description, call-to-action, location, interests) and generates 2-5 relevant tags
  - Tags stored in both D1 database (comma-separated) and Vectorize (for semantic search)
  - Tag filtering supported in both REST API and MCP query endpoints
  - Enhanced semantic search with tags included in embeddings and metadata
  - Database migration support for adding tags column to existing databases
  - Unit tests for tag generation (service, finance, product categories)

#### Changed
- Enhanced tag generation prompt for better product identification
- Explicitly marks "product" tag as CRITICAL for physical items being sold
- Clarified product vs services distinction in AI prompt
- Added examples and rules for when to use product tag
- Tags explicitly included in semantic search embeddings and metadata

---

### Previous Sessions - MCP Protocol Implementation

#### Added
- MCP (Model Context Protocol) server implementation
- JSON-RPC 2.0 protocol handler for AI agents using official `@modelcontextprotocol/sdk`
- Uses `McpServer` class with proper tool registration
- Structured to integrate with Cloudflare's x402 patterns (see https://developers.cloudflare.com/agents/x402/)
- MCP endpoint at `/mcp/` routes
- Three MCP tools:
  - `postAd`: Create new advertisements via MCP (ready for x402 paid tool integration)
  - `queryAds`: Search and query advertisements with semantic, geo, age, and interest filters
  - `getAdDetails`: Get detailed information about a specific ad by ID
- MCP usage documentation in `docs/MCP.md`
- Automatic impression tracking in MCP tools (`queryAds` and `getAdDetails`)

#### Changed
- Updated zod version in shared package to `^3.25.76` to align with MCP SDK requirements
- Extracted shared ad creation logic into `services/adCreation.ts` to eliminate duplication between REST API and MCP handlers
- Removed redundant validation from MCP tools (MCP SDK handles validation via Zod schemas before calling handlers)

#### Removed
- Unused MCP tools/index.ts file (functionality moved to direct SDK usage)
- Redundant `postAdTool` wrapper file (functionality inlined in MCP server.ts)

---

### Previous Sessions - Vectorize & Semantic Search

#### Added
- Vectorize integration for semantic search
- Created `services/vectorize.ts` service for embeddings and semantic search
- Integrated Cloudflare Workers AI (`@cf/baai/bge-small-en-v1.5`) for text embeddings (384 dimensions)
- Automatic indexing of ads in Vectorize when created (non-blocking)
- Semantic search via Vectorize when query string is provided in `queryAds` tool and REST API
- Combines Vectorize semantic search with geo, age, and interest filters
- Fallback to D1 keyword search when no query string provided
- Vectorize metadata filtering enabled for `visible`, `expiry`, and `moderation_score` fields
- Setup instructions in `wrangler.toml` for creating Vectorize index

#### Changed
- Updated AI embedding model from `@cf/meta/all-minilm-l6-v2` to `@cf/baai/bge-small-en-v1.5` (384 dimensions)
- Enabled Vectorize metadata filtering for `visible` field (requires metadata indexes created first)
- Fixed Vectorize topK limit: capped at 50 when returnMetadata=true to avoid VECTOR_QUERY_ERROR
- Removed retry logic from tests: verify indexing via successful upsert completion (getByIds has eventual consistency with remote Vectorize)
- Updated `wrangler.toml` with remote bindings for AI and Vectorize (individual service configuration, not full `--remote` mode)

#### Removed
- Retry logic from Vectorize tests (replaced with upsert success verification)
- Unused Vectorize indexing check functions (`isAdIndexed`, `checkIndexed`) and `/api/ads/:adId/indexed` endpoint

---

### Previous Sessions - Moderation System

#### Added
- AI moderation integration (Cloudflare Workers AI)
- Implemented comprehensive AI-powered content moderation using Cloudflare Workers AI (`@cf/meta/llama-3.2-3b-instruct`)
- Created detailed moderation prompt based on Twitter/X policies with clear scoring guidelines
- Scoring system: 0 (illegal/malicious), 1-4 (inappropriate), 5-10 (acceptable)
- Automatic shadow banning: ads with score < 5 are automatically set to `visible = false`
- Pure AI moderation only: removed keyword fallback - requires AI to be available or moderation fails
- Moderation analyzes title, description, call-to-action, location, and interests
- Provides specific reasons for low scores (1-3 reasons per violation)
- Illegal content detection: child abuse, illegal drugs, violence, money laundering, human trafficking, spam
- Inappropriate content detection: hate speech, offensive language, misinformation, dangerous activities

#### Changed
- Moderation service refactored to pure AI-only
- Removed keyword-based fallback moderation
- Moderation now requires Cloudflare Workers AI binding and fails if AI is unavailable
- Ensures consistent AI-powered content analysis for all ads
- Moderation scoring improvements
- Updated moderation prompt: typical commercial ads (restaurants, shops, services) now default to score 10
- Only downgrade from 10 if actual concerns exist (illegal content, hate speech, adult content, etc.)
- Normal business advertisements with professional/casual content score 10 by default
- Moderation now explicitly instructs AI to score professional/casual business ads as 10 unless concerns exist

#### Removed
- Keyword-based moderation fallback

---

### Previous Sessions - Initial Project Setup & Code Cleanup

#### Added
- Initial project setup with monorepo structure (npm workspaces)
- Backend foundation with Cloudflare Workers
- D1 database integration for ad storage
- Zod schemas for type-safe validation
- Shared types package (`@threead/shared`)
- REST API routes for ads (create, query)
- Services layer:
  - Pricing calculation service
  - Solana transaction verification service (stub)
  - Moderation service (basic implementation)
  - Database service (D1 CRUD operations with geo queries)
- Geo distance calculations (Haversine formula) for location-based ads
- Testing setup with Vitest
- Health check endpoint
- CORS support for API endpoints
- Database migration scripts

#### Changed
- Migrated from Durable Objects to D1 database for better SQL support and geo queries
- REST API ad creation now uses moderation service for scoring and visibility determination
- Payment verification temporarily disabled in both REST API and MCP to facilitate testing
- Code refactoring and cleanup:
  - Simplified payment handling in REST API routes (removed redundant nested try-catch blocks)
  - Fixed count query bug in `db.ts` (was using `SELECT *` instead of `SELECT COUNT(*) as count`)
  - Cleaned up redundant try-catch blocks and unused imports

#### Removed
- Durable Objects implementation (replaced with D1)
- Backward compatibility shims and re-exports
- Unused imports (`verifyPayment`, `calculateAdPricing`) from REST API routes
