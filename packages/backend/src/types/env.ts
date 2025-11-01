/**
 * Environment types for Cloudflare Worker
 */

export interface Env {
  // D1 Database
  DB: D1Database;

  // Vectorize
  VECTORIZE: Vectorize;

  // Workers AI (for embeddings)
  AI: Ai;

  // R2
  MEDIA_BUCKET: R2Bucket;

  // Environment variables
  SOLANA_RPC_URL: string;
  RECIPIENT_WALLET: string;
  RECIPIENT_TOKEN_ACCOUNT: string;
}

