/**
 * Environment types for Cloudflare Worker
 */

export interface Env {
  // Durable Objects
  AD_STORAGE: DurableObjectNamespace;

  // Vectorize
  VECTORIZE: Vectorize;

  // R2
  MEDIA_BUCKET: R2Bucket;

  // Environment variables
  SOLANA_RPC_URL: string;
  RECIPIENT_WALLET: string;
  RECIPIENT_TOKEN_ACCOUNT: string;
}

