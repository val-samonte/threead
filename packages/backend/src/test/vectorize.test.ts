/**
 * Vectorize service integration tests
 * Tests semantic search with real Vectorize service (remote calls)
 * 
 * Like AI.run() which calls remote AI in tests, we test Vectorize via remote calls.
 * When wrangler dev is running, API endpoints have access to real Vectorize/AI bindings.
 * 
 * To run:
 * 1. Start wrangler dev: cd packages/backend && npm run dev  
 * 2. Run: npm test -- vectorize.test.ts
 * 
 * Make sure Vectorize index exists:
 * npx wrangler vectorize create ads-vectors --dimensions=384 --metric=cosine
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8787';

/**
 * Verify worker is accessible with real bindings
 */
async function requireWorkerRunning(): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    
    const response = await fetch(`${WORKER_URL}/health`, {
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      throw new Error(`Worker health check failed: ${response.status}`);
    }
  } catch (error) {
    throw new Error(
      `Worker not accessible at ${WORKER_URL}. ` +
      `Make sure wrangler dev is running: cd packages/backend && npm run dev\n` +
      `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Retry semantic search until expected ad is found or timeout
 * Handles Vectorize eventual consistency - vectors may not be immediately searchable after upsert
 */
async function searchUntilFound(
  query: string,
  expectedAdId: string,
  options: { maxAttempts?: number; delayMs?: number; queryParams?: string } = {}
): Promise<{ ads: Array<{ ad_id?: string }>; total: number }> {
  const maxAttempts = options.maxAttempts ?? 10;
  const delayMs = options.delayMs ?? 500;
  const queryParams = options.queryParams || '';
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const searchResponse = await fetch(
      `${WORKER_URL}/api/ads?query=${encodeURIComponent(query)}&limit=10${queryParams ? `&${queryParams}` : ''}`
    );
    
    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      throw new Error(
        `Failed to search ads: ${searchResponse.status} ${searchResponse.statusText}\n` +
        `Response: ${errorText}`
      );
    }
    
    const searchData = await searchResponse.json() as { 
      ads?: Array<{ ad_id?: string }>; 
      total?: number 
    };
    
    if (searchData.ads && searchData.ads.some(ad => ad.ad_id === expectedAdId)) {
      return { ads: searchData.ads, total: searchData.total || 0 };
    }
    
    // If not found and not last attempt, wait before retrying
    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  // Final attempt - return whatever we got for debugging
  const searchResponse = await fetch(
    `${WORKER_URL}/api/ads?query=${encodeURIComponent(query)}&limit=10${queryParams ? `&${queryParams}` : ''}`
  );
  const searchData = await searchResponse.json() as { 
    ads?: Array<{ ad_id?: string }>; 
    total?: number 
  };
  
  return { ads: searchData.ads || [], total: searchData.total || 0 };
}

describe('Vectorize Service Tests', () => {
  const testAdIds: string[] = [];

  beforeAll(async () => {
    await requireWorkerRunning();
  });

  afterAll(async () => {
    // Cleanup: Vectorize cleanup happens automatically when ads expire
    // Or we could add a cleanup endpoint if needed
  });

  describe('indexAd via API (tests Vectorize remotely)', () => {
    it('should index ad and make it searchable via semantic search', async () => {
      // Create ad via API - this calls indexAd() which uses real Vectorize bindings
      const createResponse = await fetch(`${WORKER_URL}/api/ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Best Pizza in San Francisco',
          description: 'Authentic Italian pizza with wood-fired oven. We serve the best margherita and pepperoni pizza in the Bay Area.',
          location: 'San Francisco, CA',
          interests: ['pizza', 'italian', 'restaurant', 'food'],
          days: 7,
          latitude: 37.7749,
          longitude: -122.4194,
        }),
      });

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        throw new Error(
          `Failed to create ad: ${createResponse.status} ${createResponse.statusText}\n` +
          `Response: ${errorText}`
        );
      }
      
      const createData = await createResponse.json() as { ad?: { ad_id?: string } };
      expect(createData.ad).toBeDefined();
      const adId = createData.ad!.ad_id!;
      testAdIds.push(adId);

      // Vectorize has eventual consistency - vectors may not be immediately searchable after upsert
      // Retry search until ad is found or timeout (max 5 seconds)
      const searchData = await searchUntilFound(
        'italian pizza restaurant',
        adId,
        { maxAttempts: 10, delayMs: 500 }
      );
      
      // Debug: log what we got
      console.log(`Search results:`, JSON.stringify({ 
        total: searchData.total, 
        adCount: searchData.ads?.length,
        adIds: searchData.ads?.map(a => a.ad_id),
        expectedAdId: adId
      }, null, 2));
      
      expect(searchData.ads).toBeDefined();
      expect(searchData.total).toBeGreaterThan(0);
      
      // Should find our test ad via semantic search
      const foundAd = searchData.ads.find(ad => ad.ad_id === adId);
      if (!foundAd) {
        // If not found after retries, check if ad exists in D1
        const directResponse = await fetch(`${WORKER_URL}/api/ads?limit=100`);
        const directData = await directResponse.json() as { ads?: Array<{ ad_id?: string }> };
        const hasAdInD1 = directData.ads?.some(a => a.ad_id === adId);
        
        throw new Error(
          `Vectorize semantic search did not find ad after retries.\n` +
          `Ad ID: ${adId}\n` +
          `Ad exists in D1: ${hasAdInD1}\n` +
          `Search returned ${searchData.total} total results, but expected ad was not in top results.\n` +
          `This may indicate: (1) Vectorize indexing propagation delay exceeded timeout, ` +
          `(2) Semantic similarity is lower than expected, or (3) Vectorize index issue.\n` +
          `Found ad IDs: ${searchData.ads.map(a => a.ad_id).join(', ')}`
        );
      }
    });
  });

  describe('semanticSearch via API', () => {
    it('should find semantically similar ads', async () => {
      // Create multiple ads with similar but different wording
      const ad1Response = await fetch(`${WORKER_URL}/api/ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Sushi Bar Tokyo',
          description: 'Fresh Japanese sushi and sashimi',
          days: 7,
        }),
      });
      const ad1 = await ad1Response.json() as { ad?: { ad_id?: string } };
      if (ad1.ad?.ad_id) testAdIds.push(ad1.ad.ad_id);

      const ad2Response = await fetch(`${WORKER_URL}/api/ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Japanese Cuisine Restaurant',
          description: 'Authentic Japanese dishes including sushi rolls',
          days: 7,
        }),
      });
      const ad2 = await ad2Response.json() as { ad?: { ad_id?: string } };
      if (ad2.ad?.ad_id) testAdIds.push(ad2.ad.ad_id);

      // Vectorize has eventual consistency - retry search until both ads are found
      // Wait for both ads to be indexed, checking for both simultaneously
      let foundBoth = false;
      for (let attempt = 1; attempt <= 10; attempt++) {
        const searchResponse = await fetch(
          `${WORKER_URL}/api/ads?query=japanese food sushi&limit=10`
        );

        if (!searchResponse.ok) {
          const errorText = await searchResponse.text();
          throw new Error(
            `Failed to search ads: ${searchResponse.status} ${searchResponse.statusText}\n` +
            `Response: ${errorText}`
          );
        }
        
        const searchData = await searchResponse.json() as { ads?: Array<{ ad_id?: string }> };
        const foundIds = searchData.ads?.map(a => a.ad_id) || [];
        
        const hasAd1 = ad1.ad?.ad_id && foundIds.includes(ad1.ad.ad_id);
        const hasAd2 = ad2.ad?.ad_id && foundIds.includes(ad2.ad.ad_id);
        
        if ((ad1.ad?.ad_id && hasAd1) && (ad2.ad?.ad_id && hasAd2)) {
          foundBoth = true;
          break;
        }
        
        if (attempt < 10) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      // Final check
      const finalSearchResponse = await fetch(
        `${WORKER_URL}/api/ads?query=japanese food sushi&limit=10`
      );
      const finalSearchData = await finalSearchResponse.json() as { ads?: Array<{ ad_id?: string }> };
      const foundIds = finalSearchData.ads?.map(a => a.ad_id) || [];
      
      if (ad1.ad?.ad_id) expect(foundIds).toContain(ad1.ad.ad_id);
      if (ad2.ad?.ad_id) expect(foundIds).toContain(ad2.ad.ad_id);
    });
  });

  describe('Vectorize filters', () => {
    it('should combine semantic search with geo filters', async () => {
      // Create ad in San Francisco
      const sfAdResponse = await fetch(`${WORKER_URL}/api/ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Coffee Shop',
          description: 'Best coffee in SF',
          location: 'San Francisco',
          days: 7,
          latitude: 37.7749,
          longitude: -122.4194,
        }),
      });
      const sfAd = await sfAdResponse.json() as { ad?: { ad_id?: string } };
      expect(sfAd.ad?.ad_id).toBeDefined();
      const sfAdId = sfAd.ad!.ad_id!;
      testAdIds.push(sfAdId);

      // Vectorize has eventual consistency - retry search until ad is found
      const searchData = await searchUntilFound(
        'coffee',
        sfAdId,
        { 
          maxAttempts: 10, 
          delayMs: 500,
          queryParams: 'latitude=37.7749&longitude=-122.4194&radius=50'
        }
      );
      
      const foundIds = searchData.ads?.map(a => a.ad_id) || [];
      expect(foundIds).toContain(sfAdId);
    });
  });
});
