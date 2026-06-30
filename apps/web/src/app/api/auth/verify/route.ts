import { NextRequest, NextResponse } from 'next/server';
import {
  verifyToken,
  generateSessionToken,
  generateOnboardingToken,
  getSessionCookieOptions,
  MagicLinkPayload,
} from '@/lib/auth';
import { getUserByEmail, getTenantById } from '@/lib/queries/users';
import { normalizeEmail } from '@/lib/utils/email';
import type { Role } from '@/lib/types/user-management';
import logger from '@/lib/logger';

const ONBOARDING_COOKIE_NAME = 'opengander_onboarding';
const RETURN_URL_COOKIE_NAME = 'opengander_return_url';

// Registration is disabled by default unless explicitly set to 'false'
const REGISTRATION_DISABLED = process.env.REGISTRATION_DISABLED !== 'false';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }

    // Verify magic link token
    const payload = await verifyToken<MagicLinkPayload>(token);

    if (!payload || payload.type !== 'magic_link') {
      return NextResponse.json({ error: 'Invalid or expired magic link' }, { status: 401 });
    }

    // Extract email from magic link and normalize for consistent lookup
    const email = normalizeEmail(payload.email);

    // Look up existing user
    const existingUser = await getUserByEmail(email);

    let userId: string;
    let tenantId: string;
    let tenantName: string | undefined;
    let role: Role = 'user';

    if (existingUser) {
      // Existing user - use their tenant
      userId = existingUser.UserId;
      tenantId = existingUser.TenantId;
      role = existingUser.Role;

      // Get tenant name
      const tenant = await getTenantById(tenantId);
      tenantName = tenant?.Name;

      logger.info({ email, tenantId }, 'Existing user found');
    } else {
      // New user - check if registration is disabled
      if (REGISTRATION_DISABLED) {
        logger.warn({ email }, 'Registration disabled - new user blocked');
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
        const errorUrl = new URL('/signup', baseUrl);
        errorUrl.searchParams.set('error', 'registration_disabled');
        return NextResponse.redirect(errorUrl);
      }

      // New user - redirect to onboarding to create tenant
      logger.info({ email }, 'New user - redirecting to onboarding');

      const onboardingToken = await generateOnboardingToken(email, 'checkout');
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const response = NextResponse.redirect(new URL('/onboarding', baseUrl));

      // Set onboarding cookie
      response.cookies.set({
        name: ONBOARDING_COOKIE_NAME,
        value: onboardingToken,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 3600, // 1 hour
        path: '/',
      });

      return response;
    }

    // Create session token with tenant info
    const sessionToken = await generateSessionToken(userId, email, tenantId, tenantName, role);

    // Get return URL from cookie, default to /
    const returnUrlCookie = req.cookies.get(RETURN_URL_COOKIE_NAME)?.value;
    let redirectPath = '/';

    // Validate returnUrl to prevent open redirect attacks
    // Cookie value is encodeURIComponent'd by the signin page, so decode it first
    if (returnUrlCookie) {
      const decoded = decodeURIComponent(returnUrlCookie);
      if (decoded.startsWith('/') && !decoded.startsWith('//')) {
        redirectPath = decoded;
      }
    }

    // Create response with redirect
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const response = NextResponse.redirect(new URL(redirectPath, baseUrl));

    // Set session cookie
    const cookieOptions = getSessionCookieOptions();
    logger.info(
      { cookieOptions: { ...cookieOptions, value: '[REDACTED]' } },
      'Setting session cookie'
    );

    response.cookies.set({
      ...cookieOptions,
      value: sessionToken,
    });

    // Clear the return URL cookie
    response.cookies.delete(RETURN_URL_COOKIE_NAME);

    logger.info({ redirectUrl: baseUrl + redirectPath }, 'Cookie set, redirecting');
    return response;
  } catch (error) {
    logger.error({ err: error }, 'Error in verify');
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
}
