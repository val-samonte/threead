/**
 * Shared utility for parsing AI responses
 * Extracts JSON from various AI response formats and handles markdown code blocks
 */

export interface ParseAIResponseResult<T> {
  success: boolean;
  parsed?: T;
  error?: string;
  details?: string;
}

/**
 * Parse AI response text from various formats
 * Handles both string and object responses
 */
export function extractResponseText(response: unknown): string {
  if (typeof response === 'string') {
    return response;
  }
  
  if (response && typeof response === 'object') {
    // Try various response formats
    if ('response' in response) {
      return String(response.response);
    } else if ('content' in response) {
      return String(response.content);
    } else if ('text' in response) {
      return String(response.text);
    } else if (Array.isArray(response)) {
      // Some models return array of message objects
      const lastMessage = response[response.length - 1];
      if (lastMessage && typeof lastMessage === 'object' && 'content' in lastMessage) {
        return String(lastMessage.content);
      }
    }
  }
  
  return '';
}

/**
 * Extract JSON from AI response text
 * Handles markdown code blocks and incomplete JSON
 */
export function extractJSONFromResponse(responseText: string): {
  success: boolean;
  jsonText?: string;
  error?: string;
  details?: string;
  hadMarkdown?: boolean;
} {
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
        error: 'Markdown code block found but no JSON object detected',
        details: `Response contained markdown code blocks but could not extract JSON. Full response: ${originalResponseText}`,
        hadMarkdown: true,
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
        error: 'No JSON object found in response',
        details: `Could not find a JSON object (no opening brace '{') in the AI response. Full response: ${originalResponseText}. Full response length: ${originalResponseText.length} chars${hadMarkdown ? ' (markdown code blocks were removed)' : ''}`,
        hadMarkdown,
      };
    }
  }
  
  return {
    success: true,
    jsonText: extractedJson,
    hadMarkdown,
  };
}

/**
 * Parse AI JSON response with comprehensive error handling
 */
export function parseAIJSONResponse<T>(
  response: unknown,
  validator?: (parsed: unknown) => parsed is T
): ParseAIResponseResult<T> {
  // Extract response text
  const responseText = extractResponseText(response);
  
  if (!responseText || responseText.trim().length === 0) {
    return {
      success: false,
      error: 'Empty AI response',
      details: `The AI service returned an empty response. Response type: ${typeof response}, raw response: ${JSON.stringify(response, null, 2)}`,
    };
  }

  // Extract JSON from response
  const extractionResult = extractJSONFromResponse(responseText);
  if (!extractionResult.success || !extractionResult.jsonText) {
    return {
      success: false,
      error: extractionResult.error || 'Failed to extract JSON',
      details: extractionResult.details,
    };
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractionResult.jsonText);
  } catch (parseError) {
    const parseErrorMsg = parseError instanceof Error ? parseError.message : String(parseError);
    return {
      success: false,
      error: 'Failed to parse JSON response',
      details: `JSON parsing failed: ${parseErrorMsg}. Extracted JSON text: ${extractionResult.jsonText}. Original full response: ${responseText}`,
    };
  }

  // Validate parsed result if validator provided
  if (validator && !validator(parsed)) {
    return {
      success: false,
      error: 'Invalid parsed JSON structure',
      details: `Parsed JSON did not pass validation. Parsed value: ${JSON.stringify(parsed)}. Original full response: ${responseText}`,
    };
  }

  return {
    success: true,
    parsed: parsed as T,
  };
}

