/**
 * Moderation service
 * AI-powered moderation scoring (0-10) using Cloudflare Workers AI
 * 0 = malicious/illegal, 10 = clean
 * Requires AI binding - fails if AI is unavailable or returns invalid response
 */

import type { CreateAdRequest } from '@threead/shared';
import type { Env } from '../types/env';

export interface ModerationResult {
  score: number; // 0-10
  visible: boolean; // true if score >= 5 (threshold)
  reasons?: string[]; // Reasons for low score
}

/**
 * System prompt for content moderation (reusable, not rebuilt each time)
 * Based on industry standards (Twitter/X policies)
 */
const MODERATION_SYSTEM_PROMPT = `You are a content moderation system for advertisements. Analyze ad content and assign a moderation score from 0 to 10.

**Scoring Guidelines:**

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
  - Adult content that is legally compliant but requires age restriction
  - Should score 6-7 if min_age >= 18 is set correctly
  - If min_age < 18 or not set, score should be 1-4 (inappropriate, auto-hidden)

**Score 10 (Perfect - Fully Acceptable):**
- Typical commercial advertisements (restaurants, shops, services, events)
- Professional and casual content with no malicious intent
- Clean, appropriate content suitable for all audiences
- Clear, honest advertising in standard commercial format
- No controversial, inappropriate, or problematic content
- If the ad is a normal business advertisement (like "Best Pizza in San Francisco", "Coffee Shop Opening", "Yoga Classes"), it should score 10

**Score 7-9 (Acceptable - Visible with Minor Concerns):**
- Generally clean content but may have mild concerns
- Slightly provocative but not harmful
- Professional content with minor edge cases
- Content that mostly complies with platform standards but has minor issues

**Score 5-6 (Borderline - Visible but Flagged):**
- Controversial political or religious topics
- Mildly provocative or edgy content
- Sensationalist or clickbait material
- Content that may be misleading but not illegal

**Important Age-Gating Rules:**
- If content is adult/pornographic/explicit:
  - If min_age >= 18: Score 6-7 (allowable but age-gated)
  - If min_age < 18 or not set: Score 1-4 (inappropriate, auto-hidden)
- Always consider the age parameters (min_age, max_age) when evaluating content appropriateness
- Content that requires age restriction but lacks proper age gating should be penalized

**Instructions:**
1. **Default score is 10** - Most typical commercial advertisements (restaurants, shops, services, events) should score 10
2. Analyze the ad title, description, call-to-action, and age parameters (min_age, max_age)
3. Check for any illegal, harmful, or inappropriate content
4. Evaluate age-gating requirements - adult content must have min_age >= 18
5. **Only downgrade from 10 if you find actual concerns:**
   - Illegal content (0)
   - Hate speech, offensive language (1-4)
   - Controversial political/religious topics (5-6)
   - Adult content without age gating (1-4)
   - Adult content with age gating (6-7)
   - Minor edge cases or mild concerns (7-9)
6. If the ad is a normal business advertisement with professional, casual content and no malicious intent, **score it 10**
7. Provide 1-3 specific reasons if score < 7

**Output Format (JSON only, no markdown):**
{
  "score": <number 0-10>,
  "reasons": [<string>, ...] or null
}

Always respond with valid JSON only, no markdown formatting.`;

/**
 * Moderate ad content using Cloudflare Workers AI
 * Requires AI to be available - fails if AI is unavailable or returns invalid response
 */
export async function moderateAd(
  adRequest: CreateAdRequest,
  env: Env
): Promise<ModerationResult> {
  // Verify AI is available
  if (!env.AI) {
    throw new Error('AI moderation service is not available. Workers AI binding is required.');
  }

  // Build text content for analysis
  const title = adRequest.title || '';
  const description = adRequest.description || '';
  const callToAction = adRequest.call_to_action || '';
  const location = adRequest.location || '';
  const interests = adRequest.interests?.join(', ') || '';

  // Perform AI moderation with age parameters
  const aiResult = await performAIModeration(env, {
    title,
    description,
    callToAction,
    location,
    interests,
    minAge: adRequest.min_age,
    maxAge: adRequest.max_age,
  });

  // Validate AI response
  if (!aiResult || typeof aiResult.score !== 'number' || aiResult.score < 0 || aiResult.score > 10) {
    throw new Error(`Invalid AI moderation response: score must be between 0 and 10, got ${aiResult?.score}`);
  }

  const score = Math.round(aiResult.score);
  const visible = score >= 5;

  return {
    score,
    visible,
    reasons: aiResult.reasons && aiResult.reasons.length > 0 ? aiResult.reasons : undefined,
  };
}

/**
 * Perform AI-based moderation using Cloudflare Workers AI
 */
async function performAIModeration(
  env: Env,
  content: {
    title: string;
    description: string;
    callToAction: string;
    location: string;
    interests: string;
    minAge?: number;
    maxAge?: number;
  }
): Promise<{ score: number; reasons: string[] | null }> {
  // Build user message with just the ad content (dynamic part)
  const adContentParts: string[] = [];
  if (content.title) adContentParts.push(`Title: ${content.title}`);
  if (content.description) adContentParts.push(`Description: ${content.description}`);
  if (content.callToAction) adContentParts.push(`Call to Action: ${content.callToAction}`);
  if (content.location) adContentParts.push(`Location: ${content.location}`);
  if (content.interests) adContentParts.push(`Interests: ${content.interests}`);
  
  // Include age parameters - critical for adult content moderation
  if (content.minAge !== undefined) {
    adContentParts.push(`Minimum Age: ${content.minAge}`);
  }
  if (content.maxAge !== undefined) {
    adContentParts.push(`Maximum Age: ${content.maxAge}`);
  }
  if (content.minAge === undefined && content.maxAge === undefined) {
    adContentParts.push(`Age Restriction: None`);
  }
  
  const userMessage = adContentParts.length > 0 
    ? adContentParts.join('\n')
    : '(empty ad content)';

  // Use Cloudflare Workers AI text generation model
  // @cf/meta/llama-3.2-3b-instruct is a good general-purpose model for this
  // System prompt contains reusable moderation guidelines
  // User message contains only the dynamic ad content
  const response = await (env.AI.run as any)('@cf/meta/llama-3.2-3b-instruct', {
    messages: [
      {
        role: 'system',
        content: MODERATION_SYSTEM_PROMPT,
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
    throw new Error('Empty response from AI moderation');
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
  
  if (!parsed || typeof parsed.score !== 'number') {
    throw new Error('Invalid AI response format');
  }

  return {
    score: parsed.score,
    reasons: parsed.reasons || null,
  };
}

