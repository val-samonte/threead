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
  USDC_MINT: string; // USDC mint address (devnet/mainnet specific)
  RECIPIENT_WALLET: string; // Treasury wallet address (ATA will be derived from this)
}

