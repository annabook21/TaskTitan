import { SignatureV4 } from '@smithy/signature-v4';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { HttpRequest } from '@smithy/protocol-http';
import { Sha256 } from '@aws-crypto/sha256-js';
import { z } from 'zod';
import { logger } from './logger';

const httpEndpoint = process.env.EVENT_HTTP_ENDPOINT!;
const region = process.env.AWS_REGION!;

// Validation schema for event channel names (alphanumeric, hyphens, underscores)
const channelNameSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/, {
  message: 'Channel name must contain only alphanumeric characters, hyphens, and underscores',
});

// Maximum payload size (1MB to prevent memory issues)
const MAX_PAYLOAD_SIZE = 1024 * 1024;

/**
 * Publishes an event to the event bus with validation and error handling.
 *
 * @param channelName - Channel name (alphanumeric, hyphens, underscores only)
 * @param payload - Event payload (will be validated for size)
 * @throws Error if channel name is invalid or payload is too large
 */
export async function sendEvent(channelName: string, payload: unknown) {
  if (httpEndpoint == null) {
    logger.warn('Event API is not configured - skipping event publication');
    return;
  }

  // Validate channel name
  try {
    channelNameSchema.parse(channelName);
  } catch (error) {
    logger.error('Invalid channel name', { channelName, error });
    throw new Error(`Invalid channel name: ${channelName}`);
  }

  // Serialize payload and check size
  const payloadString = JSON.stringify({ payload });
  const payloadSize = Buffer.byteLength(payloadString, 'utf8');

  if (payloadSize > MAX_PAYLOAD_SIZE) {
    logger.error('Event payload too large', {
      channelName,
      payloadSize,
      maxSize: MAX_PAYLOAD_SIZE,
    });
    throw new Error(`Event payload exceeds maximum size of ${MAX_PAYLOAD_SIZE} bytes`);
  }

  const endpoint = `${httpEndpoint}/event`;
  const url = new URL(endpoint);

  // generate request
  const requestToBeSigned = new HttpRequest({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      host: url.host,
    },
    hostname: url.host,
    body: JSON.stringify({
      channel: `event-bus/${channelName}`,
      events: [payloadString],
    }),
    path: url.pathname,
  });

  // initialize signer
  const signer = new SignatureV4({
    credentials: defaultProvider(),
    region,
    service: 'appsync',
    sha256: Sha256,
  });

  try {
    // sign request
    const signed = await signer.sign(requestToBeSigned);
    const request = new Request(endpoint, signed);

    // publish event via fetch
    const res = await fetch(request);

    if (!res.ok) {
      const errorText = await res.text();
      logger.error('Failed to publish event', {
        channelName,
        status: res.status,
        error: errorText,
      });
      throw new Error(`Event publication failed: ${res.status} ${errorText}`);
    }

    const responseText = await res.text();
    logger.info('Event published successfully', {
      channelName,
      payloadSize,
      response: responseText,
    });
  } catch (error) {
    logger.error('Error publishing event', {
      channelName,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
