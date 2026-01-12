/**
 * AI Configuration
 *
 * Central configuration for Amazon Bedrock model settings.
 */

/**
 * Bedrock model ID for all AI generation functions.
 * Using global inference profile for ~10% cost savings vs geographic profile.
 * Override via BEDROCK_MODEL_ID environment variable.
 *
 * Cost comparison (per 1M input tokens):
 * - us.anthropic.claude-sonnet-4-5: $3.30
 * - global.anthropic.claude-sonnet-4-5: ~$3.00 (estimated 10% savings)
 *
 * Supports: US West (Oregon), US East (N. Virginia), US East (Ohio), Europe (Ireland), Asia Pacific (Tokyo)
 */
export const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'global.anthropic.claude-sonnet-4-5-20250929-v1:0';

/**
 * Checks if AI is available (Bedrock is always available if we have AWS credentials)
 * In Lambda, we always have credentials via the execution role
 */
export function isAIConfigured(): boolean {
  // In Lambda, we always have AWS credentials
  // The real check is whether we have Bedrock model access (handled at runtime)
  return true;
}
