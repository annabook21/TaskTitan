import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { handlePullRequestEvent } from '@/lib/github-integration';

/**
 * Verify GitHub webhook signature using HMAC SHA-256
 */
function verifyGitHubSignature(payload: string, signature: string | null, secret: string): boolean {
  if (!signature) {
    return false;
  }

  const hmac = crypto.createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');

  // Use constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
  } catch {
    // Signatures are different lengths - definitely not equal
    return false;
  }
}

/**
 * GitHub webhook endpoint - receives pull_request events
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Get raw body for signature verification
    const payload = await req.text();
    const signature = req.headers.get('x-hub-signature-256');
    const event = req.headers.get('x-github-event');
    const deliveryId = req.headers.get('x-github-delivery');

    logger.info('GitHub webhook received', {
      extra: {
        event,
        deliveryId,
        hasSignature: !!signature,
      },
    });

    // 2. Parse JSON payload
    let webhookPayload;
    try {
      webhookPayload = JSON.parse(payload);
    } catch (error) {
      logger.warn('Invalid JSON payload', { error });
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    // 3. Extract repo info and find matching project
    const repoUrl = webhookPayload.repository?.html_url;
    if (!repoUrl) {
      logger.warn('Missing repository URL in payload');
      return NextResponse.json({ error: 'Missing repository URL' }, { status: 400 });
    }

    const project = await prisma.project.findFirst({
      where: { githubRepoUrl: repoUrl },
      select: {
        id: true,
        ownerId: true,
        githubWebhookSecret: true,
        githubPrTargetStatus: true,
      },
    });

    if (!project || !project.githubWebhookSecret) {
      logger.info('Project not found or webhook not configured', {
        extra: { repoUrl },
      });
      return NextResponse.json({ error: 'Project not found or webhook not configured' }, { status: 404 });
    }

    // 4. Verify signature
    if (!verifyGitHubSignature(payload, signature, project.githubWebhookSecret)) {
      logger.warn('Invalid GitHub webhook signature', {
        extra: {
          repoUrl,
          hasSecret: !!project.githubWebhookSecret,
          deliveryId,
        },
      });
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // 5. Handle pull_request event
    if (event === 'pull_request') {
      await handlePullRequestEvent(webhookPayload, {
        id: project.id,
        ownerId: project.ownerId,
        githubPrTargetStatus: project.githubPrTargetStatus,
      });
    } else {
      logger.info('Ignoring non-pull_request event', {
        extra: { event, deliveryId },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('GitHub webhook error', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
