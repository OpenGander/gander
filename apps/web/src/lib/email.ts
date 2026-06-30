import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import Mailgun from 'mailgun.js';
import formData from 'form-data';
import logger from './logger';

const log = logger.child({ component: 'email' });

const sesClient = new SESClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

// Lazy-initialize Mailgun client only when needed (avoids build-time errors when API key is not set)
let mgClient: ReturnType<InstanceType<typeof Mailgun>['client']> | null = null;

function getMailgunClient() {
  if (!mgClient) {
    const apiKey = process.env.MAILGUN_API_KEY;
    if (!apiKey) {
      throw new Error(
        'MAILGUN_API_KEY environment variable is required when using Mailgun provider'
      );
    }
    const mailgun = new Mailgun(formData);
    mgClient = mailgun.client({
      username: 'api',
      key: apiKey,
    });
  }
  return mgClient;
}

const FROM_EMAIL = process.env.SES_FROM_EMAIL || 'noreply@opengander.com';
const MAILGUN_FROM = process.env.MAILGUN_FROM_EMAIL || 'noreply@opengander.com';
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || '';

export interface SendMagicLinkEmailParams {
  to: string;
  magicLink: string;
}

export async function sendMagicLinkEmail({
  to,
  magicLink,
}: SendMagicLinkEmailParams): Promise<void> {
  const subject = 'Sign in to OpenGander';

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">OpenGander</h1>
  </div>
  <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb; border-top: none;">
    <h2 style="margin-top: 0; color: #111827;">Sign in to your account</h2>
    <p>Click the button below to sign in to OpenGander. This link will expire in 15 minutes.</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${magicLink}" style="background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 500; display: inline-block;">Sign In</a>
    </div>
    <p style="color: #6b7280; font-size: 14px;">If you didn't request this email, you can safely ignore it.</p>
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
    <p style="color: #9ca3af; font-size: 12px; margin-bottom: 0;">
      If the button doesn't work, copy and paste this link into your browser:<br>
      <a href="${magicLink}" style="color: #667eea; word-break: break-all;">${magicLink}</a>
    </p>
  </div>
</body>
</html>
  `.trim();

  const textBody = `
Sign in to OpenGander

Click the link below to sign in to your account. This link will expire in 15 minutes.

${magicLink}

If you didn't request this email, you can safely ignore it.
  `.trim();

  const emailProvider = process.env.EMAIL_PROVIDER || 'mock';

  if (emailProvider === 'mock') {
    log.info({ to, type: 'magic_link' }, 'Mock email sent');
    return;
  }

  if (emailProvider === 'mailgun') {
    await getMailgunClient().messages.create(MAILGUN_DOMAIN, {
      from: MAILGUN_FROM,
      to: [to],
      subject,
      html: htmlBody,
      text: textBody,
    });
    return;
  }

  // Default to SES
  const command = new SendEmailCommand({
    Source: FROM_EMAIL,
    Destination: {
      ToAddresses: [to],
    },
    Message: {
      Subject: {
        Data: subject,
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
}

export interface SendInviteEmailParams {
  to: string;
  inviteLink: string;
  tenantName: string;
  role: string;
  inviterEmail: string;
  expiresAt: Date;
}

export async function sendInviteEmail({
  to,
  inviteLink,
  tenantName,
  role,
  inviterEmail,
  expiresAt,
}: SendInviteEmailParams): Promise<void> {
  const subject = `You've been invited to ${tenantName} on OpenGander`;
  const expiresFormatted = expiresAt.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">OpenGander</h1>
  </div>
  <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb; border-top: none;">
    <h2 style="margin-top: 0; color: #111827;">You've been invited!</h2>
    <p><strong>${inviterEmail}</strong> has invited you to join <strong>${tenantName}</strong> on OpenGander as a <strong>${role}</strong>.</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${inviteLink}" style="background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 500; display: inline-block;">Accept Invitation</a>
    </div>
    <p style="color: #6b7280; font-size: 14px;">This invitation will expire on ${expiresFormatted}.</p>
    <p style="color: #6b7280; font-size: 14px;">If you weren't expecting this invitation, you can safely ignore this email.</p>
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
    <p style="color: #9ca3af; font-size: 12px; margin-bottom: 0;">
      If the button doesn't work, copy and paste this link into your browser:<br>
      <a href="${inviteLink}" style="color: #667eea; word-break: break-all;">${inviteLink}</a>
    </p>
  </div>
</body>
</html>
  `.trim();

  const textBody = `
You've been invited to ${tenantName} on OpenGander

${inviterEmail} has invited you to join ${tenantName} as a ${role}.

Click the link below to accept the invitation:
${inviteLink}

This invitation will expire on ${expiresFormatted}.

If you weren't expecting this invitation, you can safely ignore this email.
  `.trim();

  const emailProvider = process.env.EMAIL_PROVIDER || 'mock';

  if (emailProvider === 'mock') {
    log.info({ to, type: 'invite', tenantName, role }, 'Mock email sent');
    return;
  }

  if (emailProvider === 'mailgun') {
    await getMailgunClient().messages.create(MAILGUN_DOMAIN, {
      from: MAILGUN_FROM,
      to: [to],
      subject,
      html: htmlBody,
      text: textBody,
    });
    return;
  }

  // Default to SES
  const command = new SendEmailCommand({
    Source: FROM_EMAIL,
    Destination: {
      ToAddresses: [to],
    },
    Message: {
      Subject: {
        Data: subject,
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
}

export interface SendAddedToTenantEmailParams {
  to: string;
  tenantName: string;
  role: string;
  inviterEmail: string;
}

export async function sendAddedToTenantEmail({
  to,
  tenantName,
  role,
  inviterEmail,
}: SendAddedToTenantEmailParams): Promise<void> {
  const subject = `You've been added to ${tenantName} on OpenGander`;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const dashboardLink = `${baseUrl}/`;

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">OpenGander</h1>
  </div>
  <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb; border-top: none;">
    <h2 style="margin-top: 0; color: #111827;">You've been added to a new organization!</h2>
    <p><strong>${inviterEmail}</strong> has added you to <strong>${tenantName}</strong> on OpenGander as a <strong>${role}</strong>.</p>
    <p>You can now switch to this organization from your dashboard to view its analytics data.</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${dashboardLink}" style="background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 500; display: inline-block;">Go to Dashboard</a>
    </div>
    <p style="color: #6b7280; font-size: 14px;">Use the organization switcher in the top navigation to switch between your organizations.</p>
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
    <p style="color: #9ca3af; font-size: 12px; margin-bottom: 0;">
      If the button doesn't work, copy and paste this link into your browser:<br>
      <a href="${dashboardLink}" style="color: #667eea; word-break: break-all;">${dashboardLink}</a>
    </p>
  </div>
</body>
</html>
  `.trim();

  const textBody = `
You've been added to ${tenantName} on OpenGander

${inviterEmail} has added you to ${tenantName} as a ${role}.

You can now switch to this organization from your dashboard to view its analytics data.

Go to Dashboard: ${dashboardLink}

Use the organization switcher in the top navigation to switch between your organizations.
  `.trim();

  const emailProvider = process.env.EMAIL_PROVIDER || 'mock';

  if (emailProvider === 'mock') {
    log.info({ to, type: 'added_to_tenant', tenantName, role }, 'Mock email sent');
    return;
  }

  if (emailProvider === 'mailgun') {
    await getMailgunClient().messages.create(MAILGUN_DOMAIN, {
      from: MAILGUN_FROM,
      to: [to],
      subject,
      html: htmlBody,
      text: textBody,
    });
    return;
  }

  // Default to SES
  const command = new SendEmailCommand({
    Source: FROM_EMAIL,
    Destination: {
      ToAddresses: [to],
    },
    Message: {
      Subject: {
        Data: subject,
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
}

export interface SendWaitlistNotificationParams {
  email: string;
  company?: string;
}

export async function sendWaitlistNotification({
  email,
  company,
}: SendWaitlistNotificationParams): Promise<void> {
  const subject = `New Waitlist Signup: ${email}`;
  const notifyEmail = process.env.WAITLIST_NOTIFY_EMAIL || 'hello@opengander.com';

  const companyLine = company ? `Company: ${company}` : 'Company: Not provided';

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">New Waitlist Signup</h1>
  </div>
  <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb; border-top: none;">
    <p><strong>Email:</strong> ${email}</p>
    <p><strong>${companyLine}</strong></p>
    <p style="color: #6b7280; font-size: 14px; margin-top: 20px;">Submitted at: ${new Date().toISOString()}</p>
  </div>
</body>
</html>
  `.trim();

  const textBody = `
New Waitlist Signup

Email: ${email}
${companyLine}

Submitted at: ${new Date().toISOString()}
  `.trim();

  const emailProvider = process.env.EMAIL_PROVIDER || 'mock';

  if (emailProvider === 'mock') {
    log.info({ email, company: company || 'Not provided', type: 'waitlist' }, 'Mock email sent');
    return;
  }

  if (emailProvider === 'mailgun') {
    await getMailgunClient().messages.create(MAILGUN_DOMAIN, {
      from: MAILGUN_FROM,
      to: [notifyEmail],
      subject,
      html: htmlBody,
      text: textBody,
    });
    return;
  }

  // Default to SES
  const command = new SendEmailCommand({
    Source: FROM_EMAIL,
    Destination: {
      ToAddresses: [notifyEmail],
    },
    Message: {
      Subject: {
        Data: subject,
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
}
