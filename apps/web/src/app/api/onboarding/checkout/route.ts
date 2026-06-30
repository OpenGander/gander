import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import {
  verifyOnboardingToken,
  generateOnboardingToken,
  generateSessionToken,
  getSessionCookieOptions,
} from '@/lib/auth';
import { createTenant, getTenantBySlug } from '@/lib/queries/tenants';
import { upsertUser, getUserByEmail } from '@/lib/queries/users';
import { generateTenantId, generateUserId } from '@/lib/utils/ids';
import { normalizeEmail } from '@/lib/utils/email';
import { getClickHouseClient } from '@/lib/clickhouse';
import logger from '@/lib/logger';

const ONBOARDING_COOKIE_NAME = 'opengander_onboarding';

export async function POST(req: NextRequest) {
  try {
    // Get onboarding token from cookie
    const onboardingToken = req.cookies.get(ONBOARDING_COOKIE_NAME)?.value;

    if (!onboardingToken) {
      return NextResponse.json({ error: 'No onboarding session found' }, { status: 401 });
    }

    // Verify onboarding token
    const payload = await verifyOnboardingToken(onboardingToken);

    if (!payload || payload.step !== 'checkout') {
      return NextResponse.json({ error: 'Invalid or expired onboarding session' }, { status: 401 });
    }

    // Normalize email for consistent storage and lookup
    const email = normalizeEmail(payload.email);

    // Parse tenant info from request body
    const body = await req.json();
    const { companyName, slug } = body;

    if (!companyName || typeof companyName !== 'string' || !companyName.trim()) {
      return NextResponse.json({ error: 'Company name is required' }, { status: 400 });
    }

    if (!slug || typeof slug !== 'string' || !slug.trim()) {
      return NextResponse.json({ error: 'URL slug is required' }, { status: 400 });
    }

    const trimmedSlug = slug.trim().toLowerCase();
    const trimmedName = companyName.trim();

    // Validate slug format (alphanumeric and hyphens only)
    if (!/^[a-z0-9-]+$/.test(trimmedSlug)) {
      return NextResponse.json(
        { error: 'Slug can only contain lowercase letters, numbers, and hyphens' },
        { status: 400 }
      );
    }

    // Check if slug is already taken
    const existingTenant = await getTenantBySlug(trimmedSlug);
    if (existingTenant) {
      return NextResponse.json(
        { error: 'This URL slug is already taken. Please choose a different one.' },
        { status: 400 }
      );
    }

    // Reject if an account already exists for this email. Onboarding always
    // mints a fresh userId; without this check a repeat onboarding would either
    // rebind the existing user (Postgres) or create duplicate-email drift
    // (ClickHouse). Checked before tenant creation so we never leave an orphan
    // tenant. (Multi-org for one email is a separate, future feature.)
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return NextResponse.json(
        { error: 'An account already exists for this email. Please sign in instead.' },
        { status: 409 }
      );
    }

    const tenantId = generateTenantId();
    const tenantName = trimmedName;

    // Create tenant (stubbed checkout - always succeeds)
    await createTenant(tenantId, tenantName, trimmedSlug, []);

    // Create user as admin of the new tenant
    const userId = generateUserId();
    await upsertUser(userId, email, tenantId, 'admin');

    // Log audit event for tenant creation
    const client = getClickHouseClient();
    await client.insert({
      table: 'opengander.audit_logs',
      values: [
        {
          AuditId: uuidv4(),
          ActorUserId: userId,
          ActorEmail: email,
          ActorTenantId: tenantId,
          Action: 'create_tenant',
          TargetUserId: null,
          TargetTenantId: tenantId,
          Metadata: JSON.stringify({
            tenantName,
            slug: trimmedSlug,
            source: 'onboarding_checkout',
          }),
          IpAddress: req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown',
          UserAgent: req.headers.get('user-agent') || 'unknown',
        },
      ],
      format: 'JSONEachRow',
    });

    logger.info({ tenantId, tenantName, adminEmail: email }, 'Tenant created');

    // Generate new onboarding token for payment step
    const newOnboardingToken = await generateOnboardingToken(email, 'payment', tenantId);

    // Also create session token for authenticated access
    const sessionToken = await generateSessionToken(userId, email, tenantId, tenantName, 'admin');

    // Create response
    const response = NextResponse.json({
      success: true,
      tenantId,
      tenantName,
      nextStep: '/onboarding/payment',
    });

    // Update onboarding cookie with new token (includes tenantId)
    response.cookies.set({
      name: ONBOARDING_COOKIE_NAME,
      value: newOnboardingToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 3600, // 1 hour
      path: '/',
    });

    // Set session cookie
    const cookieOptions = getSessionCookieOptions();
    response.cookies.set({
      ...cookieOptions,
      value: sessionToken,
    });

    return response;
  } catch (error) {
    logger.error({ err: error }, 'Checkout error');
    return NextResponse.json({ error: 'Checkout failed' }, { status: 500 });
  }
}
