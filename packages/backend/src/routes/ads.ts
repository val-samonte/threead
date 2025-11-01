/**
 * REST API routes for ads
 */

import type { Env } from '../types/env';
import type { CreateAdRequest, Ad, AdQueryParams, AdSearchResult } from '@threead/shared';
import { validateAdRequest } from '@threead/shared';
import { createAdService } from '../services/adCreation';
import * as dbService from '../services/db';
import { semanticSearch } from '../services/vectorize';

export async function handleAdsRoute(
  request: Request,
  env: Env,
  path: string
): Promise<Response> {
  const method = request.method;

  if (method === 'POST') {
    return await createAd(request, env);
  } else if (method === 'GET') {
    return await getAds(request, env, path);
  }

  return new Response('Method Not Allowed', { status: 405 });
}

async function createAd(request: Request, env: Env): Promise<Response> {
  try {
    // Parse request body
    const body: CreateAdRequest = await request.json();

    // Validate request
    const validation = validateAdRequest(body);
    if (!validation.valid) {
      return new Response(
        JSON.stringify({ error: 'Validation failed', errors: validation.errors }),
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // TODO: Re-enable payment verification after MCP functionality is tested
    // During MCP development, skip payment verification to allow testing
    // Payment verification will be implemented when x402 integration is ready
    // For now, createAdService will use a dev-bypass payment_tx

    // Create ad using shared service
    const result = await createAdService(body, env);

    if (!result.success) {
      return new Response(
        JSON.stringify({ 
          error: result.error || 'Failed to create ad'
        }),
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    return new Response(
      JSON.stringify({ success: true, ad: result.ad }),
      { 
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      }
    );
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

async function getAds(request: Request, env: Env, path: string): Promise<Response> {
  try {
    // Parse query parameters
    const url = new URL(request.url);
    const params: AdQueryParams = {
      query: url.searchParams.get('query') || undefined,
      latitude: url.searchParams.get('latitude') ? parseFloat(url.searchParams.get('latitude')!) : undefined,
      longitude: url.searchParams.get('longitude') ? parseFloat(url.searchParams.get('longitude')!) : undefined,
      radius: url.searchParams.get('radius') ? parseFloat(url.searchParams.get('radius')!) : undefined,
      min_age: url.searchParams.get('min_age') ? parseInt(url.searchParams.get('min_age')!) : undefined,
      max_age: url.searchParams.get('max_age') ? parseInt(url.searchParams.get('max_age')!) : undefined,
      interests: url.searchParams.get('interests')?.split(','),
      limit: url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!) : 50,
      offset: url.searchParams.get('offset') ? parseInt(url.searchParams.get('offset')!) : 0,
    };

    // Initialize database if needed (idempotent)
    await dbService.initializeDatabase(env.DB);

    // If a query string is provided, use Vectorize semantic search
    if (params.query) {
      // Perform semantic search with Vectorize
      // Vectorize limits topK to 50 when returnMetadata=true (which we use)
      // Cap at 50 to respect this limit - we fetch more than needed for filtering
      const topK = Math.min(params.limit ? Math.max(params.limit * 3, 50) : 100, 50);
      const vectorResults = await semanticSearch(env, params.query, {
        topK,
        filter: {
          visible: true,
          min_age: params.min_age,
          max_age: params.max_age,
          interests: params.interests,
          latitude: params.latitude,
          longitude: params.longitude,
          radius: params.radius,
        },
      });

      // Fetch full ad details from D1 for the matched IDs
      const adIds = vectorResults.map(r => r.id);
      if (adIds.length === 0) {
        const emptyResult: AdSearchResult = {
          ads: [],
          total: 0,
          limit: params.limit || 50,
          offset: params.offset || 0,
        };
        return new Response(
          JSON.stringify(emptyResult),
          { 
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

      // Get full ad objects from D1, preserving Vectorize ranking order
      const ads: Ad[] = [];
      for (const adId of adIds) {
        const ad = await dbService.getAd(env.DB, adId);
        if (ad) {
          ads.push(ad);
        }
      }

      // Apply pagination
      const limit = params.limit || 50;
      const offset = params.offset || 0;
      const paginatedAds = ads.slice(offset, offset + limit);

      const result: AdSearchResult = {
        ads: paginatedAds,
        total: ads.length,
        limit,
        offset,
      };

      return new Response(
        JSON.stringify(result),
        { 
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // No query string - use traditional D1 database query
    const result = await dbService.queryAds(env.DB, params);

    return new Response(
      JSON.stringify(result),
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
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

