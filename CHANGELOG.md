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

### Changed
- Migrated from Durable Objects to D1 database for better SQL support and geo queries

### Removed
- Durable Objects implementation (replaced with D1)
- Backward compatibility shims and re-exports

### TODO
- Complete Solana verification implementation with @solana/kit
- Implement MCP protocol handler
- Add Vectorize integration for semantic search
- Implement R2 image upload
- Complete moderation AI integration
- Frontend implementation

