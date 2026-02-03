/**
 * Lambda handler for sending email invitations via SES
 * AWS Documentation: https://docs.aws.amazon.com/ses/latest/dg/send-email-using-sdk.html
 */
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const sesClient = new SESClient({});
const fromEmail = process.env.FROM_EMAIL || 'noreply@tasktitan.live';
const frontendUrl = process.env.FRONTEND_URL || 'https://tasktitan.live';

interface InvitationEmailPayload {
  toEmail: string;
  token: string; // Plaintext token (not hash) - used in invitation link
  teamName: string;
  projectName?: string | null;
  inviterName: string;
  role: string;
  expiresAt: string;
}

// AppSync Lambda invocation format: { version, operation, payload }
interface AppSyncLambdaEvent {
  version?: string;
  operation?: string;
  payload?: InvitationEmailPayload;
  // Handle direct payload (if AppSync unwraps it)
  toEmail?: string;
  token?: string;
  teamName?: string;
  projectName?: string | null;
  inviterName?: string;
  role?: string;
  expiresAt?: string;
}

export const handler = async (event: AppSyncLambdaEvent | InvitationEmailPayload): Promise<void> => {
  // Handle both AppSync wrapped format and direct payload
  let payload: InvitationEmailPayload;
  if ((event as AppSyncLambdaEvent).payload) {
    payload = (event as AppSyncLambdaEvent).payload as InvitationEmailPayload;
  } else if ((event as AppSyncLambdaEvent).toEmail) {
    // Direct fields from AppSync unwrapped format
    payload = {
      toEmail: (event as AppSyncLambdaEvent).toEmail!,
      token: (event as AppSyncLambdaEvent).token!,
      teamName: (event as AppSyncLambdaEvent).teamName!,
      projectName: (event as AppSyncLambdaEvent).projectName,
      inviterName: (event as AppSyncLambdaEvent).inviterName!,
      role: (event as AppSyncLambdaEvent).role!,
      expiresAt: (event as AppSyncLambdaEvent).expiresAt!,
    };
  } else {
    payload = event as InvitationEmailPayload;
  }
  
  const { toEmail, token, teamName, projectName, inviterName, role, expiresAt } = payload;

  // Format expiration date for display
  const expiresDate = new Date(expiresAt);
  const expiresDateStr = expiresDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Build invitation link
  const invitationLink = `${frontendUrl}/accept-invite?token=${encodeURIComponent(token)}`;

  // Determine invitation context
  const invitationContext = projectName
    ? `the "${projectName}" project in the "${teamName}" team`
    : `the "${teamName}" team`;

  // HTML email template
  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 28px;">You're Invited to TaskTitan</h1>
  </div>
  <div style="background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px;">
    <p style="font-size: 16px; margin-top: 0;">Hi there,</p>
    <p style="font-size: 16px;">
      <strong>${inviterName}</strong> has invited you to join ${invitationContext} as a <strong>${role}</strong>.
    </p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${invitationLink}" style="display: inline-block; background: #667eea; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">Accept Invitation</a>
    </div>
    <p style="font-size: 14px; color: #666; margin-bottom: 0;">
      This invitation expires on <strong>${expiresDateStr}</strong>. If the button doesn't work, copy and paste this link into your browser:
    </p>
    <p style="font-size: 12px; color: #999; word-break: break-all; margin-top: 10px;">
      ${invitationLink}
    </p>
    <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">
    <p style="font-size: 12px; color: #999; margin-bottom: 0;">
      If you didn't expect this invitation, you can safely ignore this email.
    </p>
  </div>
</body>
</html>
  `.trim();

  // Plain text fallback
  const textBody = `
You're Invited to TaskTitan

Hi there,

${inviterName} has invited you to join ${invitationContext} as a ${role}.

Accept your invitation by clicking this link:
${invitationLink}

This invitation expires on ${expiresDateStr}.

If you didn't expect this invitation, you can safely ignore this email.
  `.trim();

  try {
    const command = new SendEmailCommand({
      Source: fromEmail,
      Destination: {
        ToAddresses: [toEmail],
      },
      Message: {
        Subject: {
          Data: `You're Invited to Join ${teamName} on TaskTitan`,
          Charset: 'UTF-8',
        },
        Body: {
          Html: {
            Data: htmlBody,
            Charset: 'UTF-8',
          },
          Text: {
            Data: textBody,
            Charset: 'UTF-8',
          },
        },
      },
    });

    await sesClient.send(command);
    console.log('Invitation email sent successfully', { toEmail, teamName });
  } catch (error) {
    console.error('Failed to send invitation email', {
      toEmail,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};
