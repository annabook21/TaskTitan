/**
 * Response Parsing Utilities
 *
 * Helper functions to extract JSON and HTML from Bedrock API responses.
 */

/**
 * Extracts JSON from Bedrock response with 3-tier fallback strategy:
 * 1. Sentinel delimiters (<<<JSON / JSON>>>) - most reliable
 * 2. Markdown code block (```json) - common format
 * 3. Raw content - last resort
 *
 * This approach prevents parsing failures when Claude adds explanatory text
 * before/after the JSON response.
 *
 * @param content - Raw text response from Bedrock API
 * @returns Extracted JSON string ready for parsing
 */
export function extractJsonFromResponse(content: string): string {
  // First try sentinel delimiters (most reliable)
  const startMarker = '<<<JSON';
  const endMarker = 'JSON>>>';
  const startIdx = content.indexOf(startMarker);
  const endIdx = content.lastIndexOf(endMarker);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return content.slice(startIdx + startMarker.length, endIdx).trim();
  }

  // Fallback: try markdown code block
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Last resort: assume entire content is JSON
  return content.trim();
}

/**
 * Extracts HTML from Bedrock response, handling markdown code blocks.
 * Used by generateWireframe() which returns HTML instead of JSON.
 *
 * @param content - Raw text response from Bedrock API
 * @returns Extracted HTML string
 */
export function extractHtmlFromResponse(content: string): string {
  // Try HTML code block first
  const htmlMatch = content.match(/```(?:html)?\s*([\s\S]*?)\s*```/);
  if (htmlMatch) {
    return htmlMatch[1].trim();
  }

  // Assume entire content is HTML
  return content.trim();
}
