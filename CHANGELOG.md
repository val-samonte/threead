# Changelog

All notable changes to Three.ad will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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
- **MCP (Model Context Protocol) server implementation**
  - JSON-RPC 2.0 protocol handler for AI agents using official `@modelcontextprotocol/sdk`
  - Uses `McpServer` class with proper tool registration
  - Structured to integrate with Cloudflare's x402 patterns (see https://developers.cloudflare.com/agents/x402/)
  - MCP endpoint at `/mcp/` routes
  - Three MCP tools:
    - `postAd`: Create new advertisements via MCP (ready for x402 paid tool integration)
    - `queryAds`: Search and query advertisements with semantic, geo, age, and interest filters
    - `getAdDetails`: Get detailed information about a specific ad by ID
  - MCP usage documentation in `docs/MCP.md`
- **Payment verification bypass for development**
  - REST API and MCP routes now allow ad creation without x402 payment during MCP testing
  - Uses placeholder `dev-bypass-{uuid}` for payment_tx field
  - Payment verification can be re-enabled after MCP functionality is tested
- **Vectorize integration for semantic search**
  - Created `services/vectorize.ts` service for embeddings and semantic search
  - Integrated Cloudflare Workers AI (`@cf/meta/all-minilm-l6-v2`) for text embeddings (384 dimensions)
  - Automatic indexing of ads in Vectorize when created (non-blocking)
  - Semantic search via Vectorize when query string is provided in `queryAds` tool and REST API
  - Combines Vectorize semantic search with geo, age, and interest filters
  - Fallback to D1 keyword search when no query string provided
  - Setup instructions in `wrangler.toml` for creating Vectorize index

### Changed
- **Moderation service refactored to pure AI-only**
  - Removed keyword-based fallback moderation
  - Moderation now requires Cloudflare Workers AI binding and fails if AI is unavailable
  - Ensures consistent AI-powered content analysis for all ads
- Migrated from Durable Objects to D1 database for better SQL support and geo queries
- REST API ad creation now uses moderation service for scoring and visibility determination
- Payment verification temporarily disabled in both REST API and MCP to facilitate testing
- Updated zod version in shared package to `^3.25.76` to align with MCP SDK requirements
- **Code refactoring and cleanup:**
  - Extracted shared ad creation logic into `services/adCreation.ts` to eliminate duplication between REST API and MCP handlers
  - Simplified payment handling in REST API routes (removed redundant nested try-catch blocks)
  - Removed redundant validation from MCP tools (MCP SDK handles validation via Zod schemas before calling handlers)
  - Removed redundant `postAdTool` wrapper and inlined direct call to `createAdService` in MCP server
  - Fixed count query bug in `db.ts` (was using `SELECT *` instead of `SELECT COUNT(*) as count`)
  - Cleaned up redundant try-catch blocks and unused imports
  - **Vectorize integration improvements:**
    - Updated AI embedding model from `@cf/meta/all-minilm-l6-v2` to `@cf/baai/bge-small-en-v1.5` (384 dimensions)
    - Enabled Vectorize metadata filtering for `visible` field (requires metadata indexes created first)
    - Fixed Vectorize topK limit: capped at 50 when returnMetadata=true to avoid VECTOR_QUERY_ERROR
    - Removed retry logic from tests: verify indexing via successful upsert completion (getByIds has eventual consistency with remote Vectorize)
    - Updated `wrangler.toml` with remote bindings for AI and Vectorize (individual service configuration, not full `--remote` mode)

### Removed
- Durable Objects implementation (replaced with D1)
- Backward compatibility shims and re-exports
- Unused MCP tools/index.ts file (functionality moved to direct SDK usage)
- Redundant `postAdTool` wrapper file (functionality inlined in MCP server.ts)
- Unused imports (`verifyPayment`, `calculateAdPricing`) from REST API routes
- Unused Vectorize indexing check functions (`isAdIndexed`, `checkIndexed`) and `/api/ads/:adId/indexed` endpoint
- Retry logic from Vectorize tests (replaced with upsert success verification)

### TODO (Development Priority)
1. ✅ **MCP protocol handler + tools** (postAd, queryAds, getAdDetails) - COMPLETED
   - ✅ Implemented MCP server with JSON-RPC 2.0 protocol
   - ✅ Created MCP tools for posting and querying ads
   - ⏳ Testing with AI agents (ready for testing)
2. ✅ **Vectorize integration** for semantic search - COMPLETED
   - ✅ Integrated Cloudflare Vectorize for semantic query matching
   - ✅ Using `@cf/baai/bge-small-en-v1.5` model for embeddings (384 dimensions)
   - ✅ Vectorize metadata filtering enabled for efficient querying (visible field filtered at index level)
   - ✅ Index ad content (title, description, location, interests) in Vectorize on creation
   - ✅ Enhanced queryAds tool and REST API with semantic search capabilities
   - ✅ Vectorize metadata indexes created for filtering (visible, expiry, moderation_score)
   - ✅ Implemented Vectorize-level metadata filtering for better performance
    - ✅ Vectorize index created: `npx wrangler vectorize create ads-vectors --dimensions=384 --metric=cosine`
    - ✅ Metadata indexes created via wrangler CLI (free, included in all plans)
    - ✅ Fixed Vectorize topK limit: capped at 50 when returnMetadata=true to avoid VECTOR_QUERY_ERROR
    - ✅ Removed retry logic from tests: verify indexing via successful upsert completion (getByIds has eventual consistency)
3. ✅ **AI moderation integration** (Cloudflare Workers AI) - COMPLETED
   - ✅ Implemented comprehensive AI-powered content moderation using Cloudflare Workers AI (`@cf/meta/llama-3.2-3b-instruct`)
   - ✅ Created detailed moderation prompt based on Twitter/X policies with clear scoring guidelines
   - ✅ Scoring system: 0 (illegal/malicious), 1-4 (inappropriate), 5-10 (acceptable)
   - ✅ Automatic shadow banning: ads with score < 5 are automatically set to `visible = false`
   - ✅ Pure AI moderation only: removed keyword fallback - requires AI to be available or moderation fails
   - ✅ Moderation analyzes title, description, call-to-action, location, and interests
   - ✅ Provides specific reasons for low scores (1-3 reasons per violation)
    - ✅ Illegal content detection: child abuse, illegal drugs, violence, money laundering, human trafficking, spam
    - ✅ Inappropriate content detection: hate speech, offensive language, misinformation, dangerous activities
    - ✅ Updated moderation prompt: typical commercial ads (restaurants, shops, services) default to score 10
    - ✅ Moderation now explicitly instructs AI to score professional/casual business ads as 10 unless concerns exist
4. **R2 image upload** for ad media
   - Implement media upload endpoint
   - Store images in R2 bucket
   - Generate media keys for ad media_key field
5. **Frontend implementation**
6. **x402 payment verification** - LAST PRIORITY (deferred until MCP functionality is tested)
   - Complete Solana verification implementation with @solana/kit
   - Re-enable payment requirements in REST API and MCP routes

