/**
 * Ad data types
 */

export interface Ad {
  ad_id: string; // UUID v4
  title: string;
  description?: string;
  call_to_action?: string;
  link_url?: string;
  latitude?: number;
  longitude?: number;
  expiry: string; // ISO 8601 datetime
  min_age?: number;
  max_age?: number;
  location?: string; // For semantics
  interests?: string; // Comma-separated (≤5), e.g., "pizza,cheap,berkeley"
  tags?: string[]; // AI-generated tags (≤5), e.g., ["job", "services"]
  payment_tx: string; // Solana transaction signature
  media_key?: string; // R2 object key
  created_at: string; // ISO 8601 datetime
  moderation_score: number; // 0-10, AI judged
  visible: boolean; // Shadow ban flag
}

export interface AdSearchResult {
  ads: Ad[];
  total: number;
  limit: number;
  offset: number;
}

