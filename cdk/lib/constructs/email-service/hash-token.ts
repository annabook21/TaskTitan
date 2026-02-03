/**
 * Lambda handler for hashing invitation tokens using SHA-256
 * AWS Best Practice: Hash sensitive tokens before storage
 * Reference: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices-security-preventative.html
 */
import { createHash } from 'crypto';

interface HashTokenEvent {
  token: string;
}

/**
 * Hashes a token using SHA-256
 * Returns the hex-encoded hash (64 characters)
 */
export const handler = async (event: HashTokenEvent): Promise<{ hash: string }> => {
  const { token } = event;
  
  if (!token || typeof token !== 'string') {
    throw new Error('Token is required and must be a string');
  }
  
  // Create SHA-256 hash
  const hash = createHash('sha256')
    .update(token)
    .digest('hex');
  
  return { hash };
};
