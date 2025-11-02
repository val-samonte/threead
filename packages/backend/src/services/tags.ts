/**
 * Tag generation service
 * AI-powered tag generation for categorizing ads
 * Uses Cloudflare Workers AI to analyze ad content and generate relevant tags
 */

import type { CreateAdRequest } from '@threead/shared';
import type { Env } from '../types/env';

/**
 * Available tags that can be assigned to ads
 * This list is used as a constraint for AI tag generation
 */
export const AVAILABLE_TAGS = [
  'job',
  'services',
  'product',
  'looking-for',
  'event',
  'housing',
  'food',
  'entertainment',
  'education',
  'healthcare',
  'automotive',
  'clothing',
  'electronics',
  'furniture',
  'real-estate',
  'transportation',
  'business',
  'community',
  'sports',
  'art',
  'music',
  'travel',
  'beauty',
  'fitness',
  'technology',
  'finance',
  'legal',
  'repair',
  'cleaning',
  'delivery',
] as const;

export type AvailableTag = typeof AVAILABLE_TAGS[number];

/**
 * System prompt for tag generation
 * Instructs AI to select relevant tags from the available list
 */
const TAG_GENERATION_SYSTEM_PROMPT = `You are a tag classification system for advertisements. Analyze ad content and select 2-5 relevant tags from the available tag list.

**Available Tags:**
${AVAILABLE_TAGS.map((tag, idx) => `${idx + 1}. ${tag}`).join('\n')}

**Instructions:**
1. Analyze the ad title, description, call-to-action, location, and interests
2. Select 2-5 tags that best categorize this advertisement
3. Choose tags that accurately represent what the ad is about
4. Consider the primary purpose: is it selling a product? Offering a service? Looking for something? Advertising a job? Promoting an event?
5. Be specific but not overly granular - use the most relevant tags from the list

**Tag Selection Guidelines:**
- "job" - Job postings, hiring, employment opportunities
- "services" - Service offerings (plumbing, consulting, repair, cleaning, etc.) - NOT physical products
- "product" - **CRITICAL**: Any physical item being sold or for sale (clothing, electronics, furniture, vehicles, collectibles, vintage items, etc.). If someone is selling a physical item, ALWAYS include "product" tag
- "looking-for" - Wanted ads, seeking something, searching for items/people
- "event" - Events, gatherings, activities, concerts, festivals
- "housing" - Real estate, rentals, property, apartments
- "food" - Food-related (restaurants, delivery, catering, etc.)
- "entertainment" - Movies, shows, fun activities, games
- "education" - Classes, courses, learning, tutoring
- "healthcare" - Medical, health services
- "clothing" - Can be used alongside "product" for clothing items
- "automotive" - Can be used alongside "product" for vehicles/car parts
- "electronics" - Can be used alongside "product" for electronic devices
- "furniture" - Can be used alongside "product" for furniture items
- And other tags as appropriate based on the ad content

**Important Rules:**
1. If an ad is selling a PHYSICAL ITEM (clothing, electronics, furniture, vintage items, collectibles, etc.), you MUST include "product" as one of the tags
2. "product" and "services" are mutually exclusive - if selling a physical item, use "product"; if offering a service, use "services"
3. You can combine "product" with more specific tags like "clothing", "electronics", "furniture", etc.

**Output Format (JSON only, no markdown):**
{
  "tags": [<string>, <string>, ...]
}

Always respond with valid JSON only, no markdown formatting. The tags array should contain 2-5 tag strings from the available list.`;

/**
 * Generate tags for an ad using AI
 * Returns an array of tag strings selected from the available tag list
 */
export async function generateTags(
  adRequest: CreateAdRequest,
  env: Env
): Promise<string[]> {
  // Verify AI is available
  if (!env.AI) {
    console.warn('AI tag generation service is not available. Returning empty tags.');
    return [];
  }

  try {
    // Build text content for analysis
    const title = adRequest.title || '';
    const description = adRequest.description || '';
    const callToAction = adRequest.call_to_action || '';
    const location = adRequest.location || '';
    const interests = adRequest.interests?.join(', ') || '';

    // Build user message with ad content
    const adContentParts: string[] = [];
    if (title) adContentParts.push(`Title: ${title}`);
    if (description) adContentParts.push(`Description: ${description}`);
    if (callToAction) adContentParts.push(`Call to Action: ${callToAction}`);
    if (location) adContentParts.push(`Location: ${location}`);
    if (interests) adContentParts.push(`Interests: ${interests}`);

    const userMessage = adContentParts.length > 0
      ? adContentParts.join('\n')
      : '(empty ad content)';

    // Use Cloudflare Workers AI text generation model
    const response = await (env.AI.run as any)('@cf/meta/llama-3.2-3b-instruct', {
      messages: [
        {
          role: 'system',
          content: TAG_GENERATION_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: userMessage,
        },
      ],
      max_tokens: 200,
    });

    // Parse response - could be string or object
    let responseText = '';
    if (typeof response === 'string') {
      responseText = response;
    } else if (response && typeof response === 'object') {
      // Try various response formats
      if ('response' in response) {
        responseText = String(response.response);
      } else if ('content' in response) {
        responseText = String(response.content);
      } else if ('text' in response) {
        responseText = String(response.text);
      } else if (Array.isArray(response)) {
        // Some models return array of message objects
        const lastMessage = response[response.length - 1];
        if (lastMessage && typeof lastMessage === 'object' && 'content' in lastMessage) {
          responseText = String(lastMessage.content);
        }
      }
    }

    if (!responseText) {
      console.warn('Empty response from AI tag generation');
      return [];
    }

    // Extract JSON from response (may have markdown code blocks or extra text)
    let jsonText = responseText.trim();

    // Remove markdown code blocks if present
    if (jsonText.startsWith('```')) {
      const lines = jsonText.split('\n');
      const startIdx = lines.findIndex(line => line.includes('{'));
      const endIdx = lines.findIndex((line, idx) => idx > startIdx && line.includes('}'));
      if (startIdx >= 0 && endIdx >= 0) {
        jsonText = lines.slice(startIdx, endIdx + 1).join('\n');
      }
    }

    // Extract JSON object if surrounded by text
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }

    // Parse JSON
    const parsed = JSON.parse(jsonText);

    if (!parsed || !Array.isArray(parsed.tags)) {
      console.warn('Invalid AI response format for tag generation');
      return [];
    }

    // Validate tags are strings and filter to only include valid tags from our list
    const validTags = parsed.tags
      .filter((tag: unknown): tag is string => typeof tag === 'string')
      .filter((tag: string) => AVAILABLE_TAGS.includes(tag as AvailableTag))
      .slice(0, 5); // Limit to 5 tags max

    if (validTags.length === 0) {
      console.warn('No valid tags generated from AI response');
      return [];
    }

    return validTags;
  } catch (error) {
    // Log error but don't throw - tag generation is non-blocking
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`Failed to generate tags:`, errorMsg);
    return [];
  }
}

