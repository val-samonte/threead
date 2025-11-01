/**
 * REST API routes for ads
 */

import type { Env } from '../types/env';
import type { CreateAdRequest, Ad, AdQueryParams, AdSearchResult } from '@threead/shared';
import { validateAdRequest } from '@threead/shared';
import { createAdService } from '../services/adCreation';
import * as dbService from '../services/db';

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

    // Query ads from D1 database
    const result = await dbService.queryAds(env.DB, params);
    
    // TODO: Apply semantic search with Vectorize if query provided

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

