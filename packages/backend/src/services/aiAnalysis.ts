/**
 * Combined AI analysis service
 * Performs both moderation scoring and tag generation in a single AI call
 * This reduces latency by ~50% compared to sequential calls
 */

import type { CreateAdRequest } from '@threead/shared';
import type { Env } from '../types/env';
import { AVAILABLE_TAGS } from './tags';
import type { ModerationResult } from './moderation';
import { parseAIJSONResponse, extractResponseText } from '../utils/aiResponseParser';

export interface CombinedAIResult {
  success: boolean;
  moderation?: ModerationResult;
  tags?: string[];
  error?: string;
  details?: string;
}

/**
 * Combined system prompt for moderation + tagging
 * Instructs AI to perform both tasks in a single response
 */
const COMBINED_SYSTEM_PROMPT = `You are an AI analysis system for advertisements. Analyze ad content and provide both:
1. A moderation score (0-10) indicating content appropriateness
2. Relevant tags (2-5) from the available tag list

**MODERATION SCORING GUIDELINES:**

**Score 0 (Illegal/Malicious - Auto-Hidden):**
- Child abuse, exploitation, or pornography
- Promotion of illegal drugs or controlled substances
- Incitement to violence, terrorism, or harm
- Money laundering or financial fraud
- Spam or deceptive practices
- Human trafficking or exploitation

**Score 1-4 (Inappropriate - Auto-Hidden):**
- Hate speech targeting protected groups (race, religion, gender, etc.)
- Offensive or profane language
- Misinformation or disinformation
- Content promoting dangerous activities
- Harassment or bullying content
- Explicit adult content WITHOUT proper age gating (min_age < 18 or not set)

**Score 5-6 (Borderline - Visible but Flagged):**
- Controversial political or religious topics
- Mildly provocative or edgy content
- Sensationalist or clickbait material
- Content that may be misleading but not illegal

**Score 6-7 (Age-Restricted but Allowable - Visible):**
- Adult/pornographic content WITH proper age gating (min_age >= 18)
- If min_age < 18 or not set, score should be 1-4 (inappropriate, auto-hidden)

**Score 10 (Perfect - Fully Acceptable):**
- Typical commercial advertisements (restaurants, shops, services, events)
- Professional and casual content with no malicious intent
- Clean, appropriate content suitable for all audiences
- If the ad is a normal business advertisement, score it 10

**Score 7-9 (Acceptable - Visible with Minor Concerns):**
- Generally clean content but may have mild concerns
- Slightly provocative but not harmful
- Professional content with minor edge cases

**TAG SELECTION GUIDELINES:**

**CRITICAL: You MUST ONLY use tags from the list below. Do NOT create new tags or use variations.**

**Available Tags (SELECT ONLY FROM THIS LIST):**
${AVAILABLE_TAGS.map((tag, idx) => `${idx + 1}. ${tag}`).join('\n')}

**Tag Selection Rules:**
1. **MANDATORY**: Select EXACTLY 2-5 tags from the available list above
2. **MANDATORY**: Use ONLY the exact tag names from the list - do not create variations or new tags
3. "product" - Any physical item being sold (clothing, electronics, furniture, vehicles, collectibles, vintage items, etc.)
4. "services" - Service offerings (plumbing, consulting, repair, cleaning, etc.) - NOT physical products
5. "product" and "services" are mutually exclusive - choose one based on whether selling a physical item or offering a service
6. If selling a physical item, ALWAYS include "product" tag
7. If offering a service, ALWAYS include "services" tag
8. Consider primary purpose: selling product? Offering service? Job posting? Event? Looking for something?
9. You can combine tags (e.g., ["product", "clothing"] for clothing sales, or ["services", "repair"] for repair services)

**OUTPUT FORMAT (JSON only, no markdown):**
{
  "score": <number 0-10>,
  "reasons": [<string>, ...] or null,
  "tags": [<string>, <string>, ...]  // MUST be 2-5 tags from the available list above
}

**CRITICAL OUTPUT REQUIREMENTS:**
- The "tags" array MUST contain EXACTLY 2-5 tag strings
- Each tag MUST be an exact match from the available tags list (case-sensitive)
- Do NOT include any tags that are not in the available list
- Do NOT use variations or plurals - use exact tag names as listed

**EXAMPLE OUTPUT:**
For a plumbing service ad:
{"score": 10, "reasons": null, "tags": ["services", "repair"]}

For a vintage clothing sale:
{"score": 10, "reasons": null, "tags": ["product", "clothing"]}

For a financial advisor:
{"score": 10, "reasons": null, "tags": ["finance", "services", "business"]}

Always respond with valid JSON only, no markdown formatting. The score must be between 0 and 10. The tags array must contain 2-5 tag strings from the available list.`;

/**
 * Perform combined moderation and tag generation in a single AI call
 * This is more efficient than calling moderation and tagging separately
 */
export async function analyzeAdWithAI(
  adRequest: CreateAdRequest,
  env: Env
): Promise<CombinedAIResult> {
  // Verify AI is available
  if (!env.AI) {
    return {
      success: false,
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
    
    // Include age parameters - critical for adult content moderation
    if (adRequest.min_age !== undefined) {
      adContentParts.push(`Minimum Age: ${adRequest.min_age}`);
    }
    if (adRequest.max_age !== undefined) {
      adContentParts.push(`Maximum Age: ${adRequest.max_age}`);
    }
    if (adRequest.min_age === undefined && adRequest.max_age === undefined) {
      adContentParts.push(`Age Restriction: None`);
    }

    const userMessage = adContentParts.length > 0
      ? adContentParts.join('\n')
      : '(empty ad content)';

    // Use Cloudflare Workers AI text generation model
    const response = await (env.AI.run as any)('@cf/meta/llama-3.2-3b-instruct', {
      messages: [
        {
          role: 'system',
          content: COMBINED_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: userMessage,
        },
      ],
      max_tokens: 300, // Slightly more tokens for combined response
    });

    // Parse AI response using shared utility
    const parseResult = parseAIJSONResponse<{
      score?: number;
      reasons?: string[] | null;
      tags?: unknown[];
    }>(response);

    if (!parseResult.success || !parseResult.parsed) {
      // Check if AI refused to process the content (common for illegal content)
      const responseText = extractResponseText(response);
      const lowerResponse = responseText.toLowerCase();
      if (lowerResponse.includes('cannot') || lowerResponse.includes('refuse') || 
          lowerResponse.includes('not provide') || lowerResponse.includes('not facilitate') ||
          lowerResponse.includes('illegal') || lowerResponse.includes('promote')) {
        // AI refused to process - treat as illegal content (score 0, no tags)
        console.warn('[analyzeAdWithAI] AI refused to process content, treating as illegal (score 0)');
        return {
          success: true,
          moderation: {
            score: 0,
            visible: false,
            reasons: ['AI refused to process content - likely illegal or highly inappropriate'],
          },
          tags: [], // No tags for illegal content
        };
      }
      
      return {
        success: false,
        error: parseResult.error || 'Failed to parse AI response',
        details: parseResult.details,
      };
    }

    const parsed = parseResult.parsed;

    // Validate moderation score
    if (typeof parsed.score !== 'number' || parsed.score < 0 || parsed.score > 10) {
      return {
        success: false,
        error: 'Invalid moderation score',
        details: `Score must be between 0 and 10, got: ${parsed.score}. Parsed object: ${JSON.stringify(parsed)}`,
      };
    }

    // Validate tags
    if (!Array.isArray(parsed.tags)) {
      return {
        success: false,
        error: 'Tags array missing or invalid',
        details: `Expected "tags" property to be an array, but got: ${typeof parsed.tags}. Parsed object: ${JSON.stringify(parsed)}`,
      };
    }

    // Validate tags are strings and include all tags (no filtering)
    const stringTags = parsed.tags.filter((tag: unknown): tag is string => typeof tag === 'string');
    const allTags = stringTags.slice(0, 5); // Limit to 5 tags max
    
    // Warn if we have fewer than 2 tags (should be 2-5)
    if (allTags.length < 2) {
      console.warn(`[analyzeAdWithAI] Only ${allTags.length} tag(s) found, expected 2-5`);
    }

    const score = Math.round(parsed.score);
    const visible = score >= 5;

    // Success - return both moderation and tags (including any that aren't in AVAILABLE_TAGS)
    return {
      success: true,
      moderation: {
        score,
        visible,
        reasons: parsed.reasons && parsed.reasons.length > 0 ? parsed.reasons : undefined,
      },
      tags: allTags,
    };
  } catch (error) {
    // Unexpected error during AI analysis
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    return {
      success: false,
      error: 'Unexpected error during AI analysis',
      details: `Error: ${errorMsg}${errorStack ? `. Stack: ${errorStack.substring(0, 300)}` : ''}`,
    };
  }
}

