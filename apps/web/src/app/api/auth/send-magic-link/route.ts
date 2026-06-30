import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { generateMagicLinkToken } from '@/lib/auth';
import { sendMagicLinkEmail } from '@/lib/email';
import { getClickHouseClient, isUnknownTableError } from '@/lib/clickhouse';
import { normalizeEmail } from '@/lib/utils/email';
import { pgConfigEnabled } from '@/lib/db/config-flag';
import * as miscPg from '@/lib/queries/misc-pg';
import { checkRateLimit, getClientIP } from '@/lib/rate-limit';
import { z } from 'zod';
import logger from '@/lib/logger';

const emailSchema = z.object({
  email: z.string().email('Invalid email address'),
});

// Rate limit: 3 requests per email per 15 minutes
const EMAIL_LIMIT = 3;
const EMAIL_WINDOW_MS = 15 * 60 * 1000;

// Rate limit: 10 requests per IP per 15 minutes
const IP_LIMIT = 10;
const IP_WINDOW_MS = 15 * 60 * 1000;

export async function POST(req: Request) {
  try {
    // Check IP rate limit first (before parsing body)
    const clientIP = getClientIP(req);
    const ipCheck = checkRateLimit(`magic-link:ip:${clientIP}`, IP_LIMIT, IP_WINDOW_MS);
    if (!ipCheck.allowed) {
      const retryAfter = Math.ceil((ipCheck.resetAt - Date.now()) / 1000);
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfter),
            'X-RateLimit-Limit': String(IP_LIMIT),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil(ipCheck.resetAt / 1000)),
          },
        }
      );
    }

    const body = await req.json();

    // Validate email
    const result = emailSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: result.error.errors[0].message }, { status: 400 });
    }

    const { email: rawEmail } = result.data;
    const email = normalizeEmail(rawEmail);

    // Check per-email rate limit
    const emailCheck = checkRateLimit(`magic-link:email:${email}`, EMAIL_LIMIT, EMAIL_WINDOW_MS);
    if (!emailCheck.allowed) {
      const retryAfter = Math.ceil((emailCheck.resetAt - Date.now()) / 1000);
      return NextResponse.json(
        { error: 'Too many requests for this email. Please try again later.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfter),
            'X-RateLimit-Limit': String(EMAIL_LIMIT),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil(emailCheck.resetAt / 1000)),
          },
        }
      );
    }

    // Generate magic link token
    const token = await generateMagicLinkToken(email);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const magicLink = `${baseUrl}/api/auth/verify?token=${token}`;

    // Store in waitlist for easy retrieval (until SES is configured)
    try {
      const waitlistId = `wl_${uuidv4().replace(/-/g, '').substring(0, 16)}`;
      if (pgConfigEnabled()) {
        await miscPg.upsertWaitlistEntry({
          waitlistId,
          email,
          magicLink,
          token,
          source: 'signup',
        });
      } else {
        await getClickHouseClient().insert({
          table: 'opengander.waitlist',
          values: [
            {
              WaitlistId: waitlistId,
              Email: email,
              MagicLink: magicLink,
              Token: token,
              Source: 'signup',
            },
          ],
          format: 'JSONEachRow',
        });
      }
    } catch (err) {
      // Don't fail the request if waitlist insert fails
      if (isUnknownTableError(err)) {
        logger.warn('Waitlist table does not exist yet, skipping storage');
      } else {
        logger.error({ err }, 'Failed to store in waitlist');
      }
    }

    // Send magic link email (email.ts handles provider selection internally)
    await sendMagicLinkEmail({ to: email, magicLink });

    // Return success response
    return NextResponse.json({
      success: true,
      message: 'Magic link sent! Check your email.',
      // Include link in dev mode for easy testing
      ...(process.env.NODE_ENV === 'development' && { _dev_link: magicLink }),
    });
  } catch (error) {
    logger.error({ err: error }, 'Error in send-magic-link');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
