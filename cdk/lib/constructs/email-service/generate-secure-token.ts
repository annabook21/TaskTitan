/**
 * Lambda handler for generating cryptographically secure invitation tokens
 * AWS Best Practice: Use crypto.randomBytes for secure token generation
 * Reference: https://docs.aws.amazon.com/appsync/latest/devguide/best-practices.html
 */
import { randomBytes } from 'crypto';

/**
 * Generates a cryptographically secure, URL-safe token
 * Uses 32 bytes (256 bits) of random data, Base64URL encoded
 * Result: 43 characters, URL-safe, cryptographically secure
 */
export const handler = async (): Promise<{ token: string }> => {
  // Generate 32 bytes (256 bits) of cryptographically secure random data
  const randomBytesBuffer = randomBytes(32);
  
  // Convert to Base64URL encoding (URL-safe variant of Base64)
  // Base64URL: uses '-' and '_' instead of '+' and '/', and omits padding '='
  const token = randomBytesBuffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, ''); // Remove padding
  
  return { token };
};
