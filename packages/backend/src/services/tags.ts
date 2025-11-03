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

export interface GenerateTagsResult {
  success: boolean;
  tags: string[];
  error?: string;
  details?: string;
}

/**
 * Generate tags for an ad using AI
 * Returns a result object with success status, tags array, and error details if failed
 */
export async function generateTags(
  adRequest: CreateAdRequest,
  env: Env
): Promise<GenerateTagsResult> {
  // Verify AI is available
  if (!env.AI) {
    return {
      success: false,
      tags: [],
      error: 'AI service not available',
      details: 'The AI service is not configured in the environment.',
    };
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

    // Log raw AI response for debugging
    console.log('[generateTags] Raw AI response:', JSON.stringify(response, null, 2));

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

    // Log extracted response text
    console.log('[generateTags] Extracted response text:', responseText);
    console.log('[generateTags] Response text length:', responseText.length);

    if (!responseText || responseText.trim().length === 0) {
      return {
        success: false,
        tags: [],
        error: 'Empty AI response',
        details: `The AI service returned an empty response. Response type: ${typeof response}, raw response: ${JSON.stringify(response, null, 2)}`,
      };
    }

    // Extract JSON from response (may have markdown code blocks or extra text)
    const originalResponseText = responseText.trim();
    let jsonText = originalResponseText;
    let hadMarkdown = false;

    // Remove markdown code blocks if present
    if (jsonText.startsWith('```')) {
      hadMarkdown = true;
      const lines = jsonText.split('\n');
      const startIdx = lines.findIndex(line => line.includes('{'));
      const endIdx = lines.findIndex((line, idx) => idx > startIdx && line.includes('}'));
      if (startIdx >= 0 && endIdx >= 0) {
        jsonText = lines.slice(startIdx, endIdx + 1).join('\n');
      } else {
        return {
          success: false,
          tags: [],
          error: 'Markdown code block found but no JSON object detected',
          details: `Response contained markdown code blocks but could not extract JSON. Full response: ${originalResponseText}`,
        };
      }
    }

    // Extract JSON object if surrounded by text
    // Try multiple strategies to find JSON
    let extractedJson = jsonText;
    
    // Strategy 1: Try regex match for complete JSON object
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      extractedJson = jsonMatch[0];
    } else {
      // Strategy 2: Find opening brace and try to extract everything from there
      const openingBraceIdx = jsonText.indexOf('{');
      if (openingBraceIdx >= 0) {
        // Try to find closing brace
        const closingBraceIdx = jsonText.lastIndexOf('}');
        if (closingBraceIdx > openingBraceIdx) {
          extractedJson = jsonText.substring(openingBraceIdx, closingBraceIdx + 1);
        } else {
          // No closing brace found - try to extract from opening brace to end and see if we can parse it
          // This handles cases where response is truncated
          extractedJson = jsonText.substring(openingBraceIdx);
          // Try to fix incomplete JSON by adding closing brace if it looks like it's missing
          const openBraces = (extractedJson.match(/\{/g) || []).length;
          const closeBraces = (extractedJson.match(/\}/g) || []).length;
          if (openBraces > closeBraces) {
            extractedJson += '}'.repeat(openBraces - closeBraces);
          }
        }
      } else {
        return {
          success: false,
          tags: [],
          error: 'No JSON object found in response',
          details: `Could not find a JSON object (no opening brace '{') in the AI response. Full response: ${originalResponseText}. Full response length: ${originalResponseText.length} chars${hadMarkdown ? ' (markdown code blocks were removed)' : ''}`,
        };
      }
    }
    
    jsonText = extractedJson;

    // Parse JSON with error handling
    let parsed: { tags?: unknown[] };
    try {
      parsed = JSON.parse(jsonText);
    } catch (parseError) {
      const parseErrorMsg = parseError instanceof Error ? parseError.message : String(parseError);
      return {
        success: false,
        tags: [],
        error: 'Failed to parse JSON response',
        details: `JSON parsing failed: ${parseErrorMsg}. Extracted JSON text: ${jsonText}. Original full response: ${originalResponseText}`,
      };
    }

    if (!parsed || typeof parsed !== 'object') {
      return {
        success: false,
        tags: [],
        error: 'Invalid parsed JSON structure',
        details: `Parsed JSON is not an object. Parsed value: ${JSON.stringify(parsed)}. Original full response: ${originalResponseText}`,
      };
    }

    if (!Array.isArray(parsed.tags)) {
      return {
        success: false,
        tags: [],
        error: 'Tags array missing or invalid',
        details: `Expected "tags" property to be an array, but got: ${typeof parsed.tags}. Parsed object: ${JSON.stringify(parsed)}. Original full response: ${originalResponseText}`,
      };
    }

    // Validate tags are strings and filter to only include valid tags from our list
    const stringTags = parsed.tags.filter((tag: unknown): tag is string => typeof tag === 'string');
    const validTags = stringTags
      .filter((tag: string) => AVAILABLE_TAGS.includes(tag as AvailableTag))
      .slice(0, 5); // Limit to 5 tags max

    if (validTags.length === 0) {
      const invalidTags = stringTags.filter((tag: string) => !AVAILABLE_TAGS.includes(tag as AvailableTag));
      return {
        success: false,
        tags: [],
        error: 'No valid tags found',
        details: `Parsed ${parsed.tags.length} tags, but none matched the available tag list. Invalid tags: ${invalidTags.join(', ')}. Available tags: ${AVAILABLE_TAGS.slice(0, 10).join(', ')}...`,
      };
    }

    // Success - return valid tags
    return {
      success: true,
      tags: validTags,
    };
  } catch (error) {
    // Unexpected error during tag generation
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    return {
      success: false,
      tags: [],
      error: 'Unexpected error during tag generation',
      details: `Error: ${errorMsg}${errorStack ? `. Stack: ${errorStack.substring(0, 300)}` : ''}`,
    };
  }
}

