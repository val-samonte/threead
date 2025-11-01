/**
 * REST API routes for ads
 */

import type { Env } from '../types/env';
import type { CreateAdRequest, Ad, AdQueryParams, AdSearchResult } from '@threead/shared';
import { validateAdRequest } from '@threead/shared';
import { calculateAdPricing } from '../services/pricing';
import { verifyPayment } from '../services/solana';
import { moderateAd } from '../services/moderation';
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
    // Check x402 payment header
    const paymentHeader = request.headers.get('X-Payment');
    let payment_tx: string;
    
    if (!paymentHeader) {
      // During development, allow ads without payment
      // Use placeholder payment_tx
      const adId = crypto.randomUUID();
      payment_tx = `dev-bypass-${adId}`;
    } else {
      // If payment header is provided, attempt verification (but don't fail if it doesn't work)
      try {
        const paymentProof = JSON.parse(
          Buffer.from(paymentHeader, 'base64').toString()
        ) as { payload: { serializedTransaction?: string }; network?: string };

        // Extract signature from transaction (simplified - actual implementation needs proper parsing)
        // TODO: Parse serialized transaction to get signature
        const signature = 'TODO'; // Placeholder

        const pricing = calculateAdPricing(body.days, !!body.media);
        const verification = await verifyPayment(
          signature,
          pricing.priceSmallestUnits,
          env.RECIPIENT_TOKEN_ACCOUNT,
          env
        );

        if (verification.valid) {
          payment_tx = verification.signature;
        } else {
          // Fall back to dev bypass if verification fails
          const adId = crypto.randomUUID();
          payment_tx = `dev-bypass-${adId}`;
        }
      } catch {
        // If payment parsing fails, use dev bypass
        const adId = crypto.randomUUID();
        payment_tx = `dev-bypass-${adId}`;
      }
    }

    // TODO: Upload media to R2 if provided
    let mediaKey: string | undefined;
    if (body.media) {
      // TODO: Implement R2 upload
      mediaKey = 'TODO';
    }

    // Run moderation
    const moderation = await moderateAd(body);

    // Create ad record
    const adId = crypto.randomUUID();
    const now = new Date();
    const expiry = new Date(now);
    expiry.setDate(expiry.getDate() + body.days);

    const ad: Ad = {
      ad_id: adId,
      title: body.title,
      description: body.description,
      call_to_action: body.call_to_action,
      link_url: body.link_url,
      latitude: body.latitude,
      longitude: body.longitude,
      expiry: expiry.toISOString(),
      min_age: body.min_age,
      max_age: body.max_age,
      location: body.location,
      interests: body.interests?.join(','),
      payment_tx,
      media_key: mediaKey,
      created_at: now.toISOString(),
      moderation_score: moderation.score,
      visible: moderation.visible,
    };

    // Initialize database if needed (idempotent)
    await dbService.initializeDatabase(env.DB);

    // Store in D1 database
    try {
      await dbService.createAd(env.DB, ad);
    } catch (error) {
      return new Response(
        JSON.stringify({ 
          error: 'Failed to create ad',
          details: error instanceof Error ? error.message : 'Unknown error'
        }),
        { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    return new Response(
      JSON.stringify({ success: true, ad }),
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

