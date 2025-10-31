/**
 * AdStorage Durable Object
 * Handles SQLite database operations for ads
 * 
 * Note: Cloudflare Durable Objects use state.storage (key-value) by default.
 * For SQLite, we can either:
 * 1. Use D1 database (separate from Durable Objects)
 * 2. Use state.storage with structured data
 * 
 * For now, implementing with state.storage and structured JSON storage,
 * which can be migrated to D1 later if needed.
 */

import type { Env } from '../types/env';
import type { Ad } from '@threead/shared';

export class AdStorage implements DurableObject {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;

    try {
      switch (url.pathname) {
        case '/init':
          return await this.initializeDatabase();
        case '/ad':
          if (method === 'GET') {
            return await this.getAd(request);
          } else if (method === 'POST') {
            return await this.createAd(request);
          } else if (method === 'PUT') {
            return await this.updateAd(request);
          } else if (method === 'DELETE') {
            return await this.deleteAd(request);
          }
          break;
        case '/ads':
          if (method === 'GET') {
            return await this.queryAds(request);
          }
          break;
        case '/cleanup':
          if (method === 'POST') {
            return await this.cleanupExpired();
          }
          break;
        default:
          return new Response('Not Found', { status: 404 });
      }

      return new Response('Method Not Allowed', { status: 405 });
    } catch (error) {
      return new Response(
        JSON.stringify({ 
          error: error instanceof Error ? error.message : 'Unknown error' 
        }),
        { 
          status: 500, 
          headers: { 'Content-Type': 'application/json' } 
        }
      );
    }
  }

  private async initializeDatabase(): Promise<Response> {
    // Note: Durable Objects use state.storage, not SQL
    // This is a placeholder for initialization logic
    // If using D1, initialize would create the SQL schema there
    
    // For state.storage approach, we store ads by ad_id key
    // Structure: `ad:${ad_id}` -> Ad JSON
    
    return new Response(
      JSON.stringify({ message: 'Database initialized (using state.storage)' }),
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  private async createAd(request: Request): Promise<Response> {
    const ad: Ad = await request.json();
    
    // Store ad in state.storage
    const key = `ad:${ad.ad_id}`;
    await this.state.storage.put(key, ad);
    
    // Also maintain an index for queries
    await this.state.storage.put(`index:visible:${ad.visible ? '1' : '0'}:${ad.ad_id}`, true);
    if (ad.location) {
      await this.state.storage.put(`index:location:${ad.location}:${ad.ad_id}`, true);
    }
    if (ad.interests) {
      const interests = ad.interests.split(',');
      for (const interest of interests) {
        await this.state.storage.put(`index:interest:${interest.trim()}:${ad.ad_id}`, true);
      }
    }
    
    return new Response(
      JSON.stringify({ success: true, ad }),
      { 
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  private async getAd(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const adId = url.searchParams.get('ad_id');
    
    if (!adId) {
      return new Response(
        JSON.stringify({ error: 'ad_id parameter required' }),
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    const key = `ad:${adId}`;
    const ad = await this.state.storage.get<Ad>(key);

    if (!ad) {
      return new Response(
        JSON.stringify({ error: 'Ad not found' }),
        { 
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    return new Response(
      JSON.stringify(ad),
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  private async updateAd(request: Request): Promise<Response> {
    const ad: Partial<Ad> & { ad_id: string } = await request.json();
    
    const key = `ad:${ad.ad_id}`;
    const existing = await this.state.storage.get<Ad>(key);

    if (!existing) {
      return new Response(
        JSON.stringify({ error: 'Ad not found' }),
        { 
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    const updated = { ...existing, ...ad };
    await this.state.storage.put(key, updated);

    return new Response(
      JSON.stringify({ success: true, ad: updated }),
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  private async deleteAd(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const adId = url.searchParams.get('ad_id');
    
    if (!adId) {
      return new Response(
        JSON.stringify({ error: 'ad_id parameter required' }),
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    const key = `ad:${adId}`;
    await this.state.storage.delete(key);

    // Clean up indexes
    const ad = await this.state.storage.get<Ad>(key);
    if (ad) {
      await this.state.storage.delete(`index:visible:${ad.visible ? '1' : '0'}:${ad.ad_id}`);
      if (ad.location) {
        await this.state.storage.delete(`index:location:${ad.location}:${ad.ad_id}`);
      }
      if (ad.interests) {
        const interests = ad.interests.split(',');
        for (const interest of interests) {
          await this.state.storage.delete(`index:interest:${interest.trim()}:${ad.ad_id}`);
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  private async queryAds(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const visible = url.searchParams.get('visible') !== 'false';
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');

    // Note: This is a simplified query implementation
    // For production, you'd want more sophisticated querying
    // Using state.storage list() to get ads
    
    const prefix = `ad:`;
    const ads: Ad[] = [];
    
    // List all ads (this is simplified - in production you'd want proper indexing)
    const stored = await this.state.storage.list<Ad>({ prefix, limit: limit + offset });
    
    for (const [key, ad] of stored.entries()) {
      if (ads.length >= limit) break;
      if (ad.visible === visible && new Date(ad.expiry) > new Date()) {
        ads.push(ad);
      }
    }

    return new Response(
      JSON.stringify({ 
        ads: ads.slice(offset, offset + limit),
        total: ads.length,
        limit,
        offset 
      }),
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  private async cleanupExpired(): Promise<Response> {
    const prefix = `ad:`;
    const stored = await this.state.storage.list<Ad>({ prefix });
    const now = new Date();
    let deleted = 0;

    for (const [key, ad] of stored.entries()) {
      if (new Date(ad.expiry) < now) {
        await this.state.storage.delete(key);
        deleted++;
      }
    }

    return new Response(
      JSON.stringify({ 
        message: `Deleted ${deleted} expired ads`,
        deleted 
      }),
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}
