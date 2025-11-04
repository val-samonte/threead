/**
 * REST API routes for ads
 */

import type { Env } from '../types/env';
import type { CreateAdRequest, Ad, AdQueryParams, AdSearchResult, PaymentDetails } from '@threead/shared';
import { validateAdRequest } from '@threead/shared';
import { createAdWithPayment } from '../services/createAdWithPayment';
import * as dbService from '../services/db';
import { semanticSearch } from '../services/vectorize';
import { calculateAdPricing } from '../services/pricing';

export async function handleAdsRoute(
  request: Request,
  env: Env,
  path: string
): Promise<Response> {
  const method = request.method;

  // Handle impression tracking endpoint: /api/ads/:id/impression
  const impressionMatch = path.match(/^\/api\/ads\/([^/]+)\/impression$/);
  if (impressionMatch) {
    const adId = impressionMatch[1];
    if (method === 'POST' || method === 'GET') {
      return await trackImpression(request, env, adId);
    }
    return new Response('Method Not Allowed', { status: 405 });
  }

  // Handle click tracking endpoint: /api/ads/:id/click (redirects to ad link_url)
  const clickMatch = path.match(/^\/api\/ads\/([^/]+)\/click$/);
  if (clickMatch) {
    const adId = clickMatch[1];
    if (method === 'GET') {
      return await trackClick(request, env, adId);
    }
    return new Response('Method Not Allowed', { status: 405 });
  }

  if (method === 'POST') {
    return await createAd(request, env);
  } else if (method === 'GET') {
    return await getAds(request, env, path);
  }

  return new Response('Method Not Allowed', { status: 405 });
}

/**
 * Generate payment details for 402 Payment Required response
 */
async function generatePaymentDetails(
  adRequest: CreateAdRequest,
  env: Env
): Promise<PaymentDetails> {
  // Calculate expected price
  const pricing = calculateAdPricing(adRequest.days, !!adRequest.media);
  
  // Determine network from RPC URL
  const network = env.SOLANA_RPC_URL.includes('devnet') ? 'devnet' : 'mainnet-beta';
  
  return {
    paymentRequired: true,
    paymentDetails: {
      amount: pricing.priceUSDC.toFixed(6),
      currency: 'USDC',
      recipient: env.RECIPIENT_WALLET, // Wallet address (not ATA) - client will derive ATA when creating transaction
      mint: env.USDC_MINT,
      network,
      scheme: 'exact',
      facilitatorUrl: 'https://x402.org/facilitator', // Optional facilitator URL
    },
  };
}

async function createAd(request: Request, env: Env): Promise<Response> {
  try {
    // Parse request body
    let body: CreateAdRequest;
    try {
      const bodyText = await request.text();
      body = JSON.parse(bodyText);
    } catch (jsonError) {
      console.error('[createAd] JSON parse error:', jsonError);
      return new Response(
        JSON.stringify({ 
          error: 'Invalid JSON in request body',
          details: jsonError instanceof Error ? jsonError.message : 'Failed to parse JSON'
        }),
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Validate request (without payment_tx for now)
    const validation = validateAdRequest(body);
    if (!validation.valid) {
      console.error('[createAd] Validation failed:', validation.errors);
      try {
        const errorResponse = JSON.stringify({ error: 'Validation failed', errors: validation.errors });
        return new Response(
          errorResponse,
          { 
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      } catch (stringifyError) {
        console.error('[createAd] Failed to stringify validation errors:', stringifyError);
        return new Response(
          JSON.stringify({ error: 'Validation failed', errors: ['Failed to serialize validation errors'] }),
          { 
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }
    }

    // Check for payment: X-PAYMENT header (new x402 flow) or payment_tx field (backward compatibility)
    const paymentSignature = request.headers.get('X-PAYMENT') || body.payment_tx;

    // If no payment provided, return 402 Payment Required
    if (!paymentSignature) {
      const paymentDetails = await generatePaymentDetails(body, env);
      return new Response(
        JSON.stringify(paymentDetails),
        {
          status: 402,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Payment provided - set payment_tx in body for createAdWithPayment
    body.payment_tx = paymentSignature;

    // Execute shared ad creation flow with payment verification
    const result = await createAdWithPayment(body, env);

    if (!result.success) {
      // Determine appropriate status code based on error type
      let status = 400; // Default to Bad Request
      
      // Handle duplicate payment (idempotency)
      if (result.error === 'Payment already used' || result.duplicate) {
        status = 409; // Conflict
        // Return existing ad if available
        if (result.ad) {
          return new Response(
            JSON.stringify({
              success: true,
              duplicate: true,
              ad: result.ad,
              message: 'Transaction already processed'
            }),
            {
              status: 409,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }
      } else if (result.error === 'Insufficient USDC balance' || 
          result.error?.includes('Payment verification failed') ||
          result.error?.includes('Payment amount mismatch') ||
          result.error?.includes('Transaction not found') ||
          result.error?.includes('Transaction failed') ||
          result.error?.includes('Transaction not confirmed')) {
        status = 402; // Payment Required
      } else if (result.error?.includes('extract')) {
        status = 400; // Bad Request - extraction errors
      }

      return new Response(
        JSON.stringify({ 
          error: result.error || 'Failed to create ad',
          details: result.details
        }),
        { 
          status,
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
      interests: url.searchParams.get('interests')?.split(',').filter(i => i.length > 0),
      tags: url.searchParams.get('tags')?.split(',').filter(t => t.length > 0),
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
          tags: params.tags,
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

/**
 * Track an impression for an ad
 * Supports both POST and GET
 * Query params: ?source=mcp|app
 */
async function trackImpression(
  request: Request,
  env: Env,
  adId: string
): Promise<Response> {
  try {
    // Initialize database if needed
    await dbService.initializeDatabase(env.DB);

    // Verify ad exists
    const ad = await dbService.getAd(env.DB, adId);
    if (!ad) {
      return new Response(
        JSON.stringify({ error: 'Ad not found' }),
        { 
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
          }
        }
      );
    }

    // Get source from query param (defaults to 'app' for REST API)
    const url = new URL(request.url);
    const sourceParam = url.searchParams.get('source') || 'app';
    const source = (sourceParam === 'mcp' || sourceParam === 'app') 
      ? sourceParam 
      : 'app';

    // Extract metadata from request
    const userAgent = request.headers.get('user-agent') || undefined;
    const referrer = request.headers.get('referer') || url.searchParams.get('ref') || undefined;
    
    // Extract IP address (Cloudflare-specific)
    // Cloudflare sets CF-Connecting-IP header
    const ipAddress = request.headers.get('cf-connecting-ip') || 
                     request.headers.get('x-forwarded-for')?.split(',')[0] || 
                     undefined;

    // Record impression
    await dbService.recordImpression(env.DB, {
      ad_id: adId,
      source,
      user_agent: userAgent,
      referrer,
      ip_address: ipAddress,
    });

    return new Response(
      JSON.stringify({ success: true, ad_id: adId, source }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      }
    );
  } catch (error) {
    console.error('Failed to track impression:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      { 
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        }
      }
    );
  }
}

/**
 * Track a click and redirect to ad link_url
 * Query params: ?source=mcp|app
 */
async function trackClick(
  request: Request,
  env: Env,
  adId: string
): Promise<Response> {
  try {
    // Initialize database if needed
    await dbService.initializeDatabase(env.DB);

    // Get ad from database
    const ad = await dbService.getAd(env.DB, adId);
    if (!ad) {
      return new Response('Ad not found', { status: 404 });
    }

    // Verify ad has a link_url
    if (!ad.link_url) {
      return new Response('Ad has no link URL', { status: 400 });
    }

    // Get source from query param (defaults to 'app' for REST API)
    const url = new URL(request.url);
    const sourceParam = url.searchParams.get('source') || 'app';
    const source = (sourceParam === 'mcp' || sourceParam === 'app') 
      ? sourceParam 
      : 'app';

    // Extract metadata from request
    const userAgent = request.headers.get('user-agent') || undefined;
    const referrer = request.headers.get('referer') || url.searchParams.get('ref') || undefined;
    
    // Extract IP address (Cloudflare-specific)
    const ipAddress = request.headers.get('cf-connecting-ip') || 
                     request.headers.get('x-forwarded-for')?.split(',')[0] || 
                     undefined;

    // Record click (non-blocking - don't delay redirect)
    dbService.recordClick(env.DB, {
      ad_id: adId,
      source,
      user_agent: userAgent,
      referrer,
      ip_address: ipAddress,
    }).catch(err => {
      // Log error but don't fail redirect
      console.error('Failed to track click:', err);
    });

    // Redirect to ad link_url
    return new Response(null, {
      status: 302,
      headers: {
        'Location': ad.link_url,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  } catch (error) {
    console.error('Failed to handle click:', error);
    // Even on error, try to redirect if we have the URL
    try {
      const ad = await dbService.getAd(env.DB, adId);
      if (ad?.link_url) {
        return new Response(null, {
          status: 302,
          headers: { 'Location': ad.link_url },
        });
      }
    } catch {
      // Ignore errors here
    }
    return new Response('Internal server error', { status: 500 });
  }
}

