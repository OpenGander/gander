import { NextRequest, NextResponse } from 'next/server';
import { verifyOnboardingToken, generateOnboardingToken } from '@/lib/auth';
import { isDomainAvailable, updateTenantDomains, getTenantDomains } from '@/lib/queries/tenants';
import logger from '@/lib/logger';

const ONBOARDING_COOKIE_NAME = 'opengander_onboarding';

// Domain validation regex - allows subdomains
const DOMAIN_REGEX = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

function isValidDomain(domain: string): boolean {
  return DOMAIN_REGEX.test(domain);
}

/**
 * Normalize domain by stripping www. prefix for consistent matching
 */
function normalizeDomain(domain: string): string {
  return domain
    .toLowerCase()
    .trim()
    .replace(/^www\./, '');
}

// GET: Retrieve current domains for tenant
export async function GET(req: NextRequest) {
  try {
    const onboardingToken = req.cookies.get(ONBOARDING_COOKIE_NAME)?.value;

    if (!onboardingToken) {
      return NextResponse.json({ error: 'No onboarding session found' }, { status: 401 });
    }

    const payload = await verifyOnboardingToken(onboardingToken);

    if (!payload || !payload.tenantId) {
      return NextResponse.json({ error: 'Invalid onboarding session' }, { status: 401 });
    }

    const domains = await getTenantDomains(payload.tenantId);

    return NextResponse.json({ domains });
  } catch (error) {
    logger.error({ err: error }, 'Get domains error');
    return NextResponse.json({ error: 'Failed to get domains' }, { status: 500 });
  }
}

// POST: Add/update domains for tenant
export async function POST(req: NextRequest) {
  try {
    const onboardingToken = req.cookies.get(ONBOARDING_COOKIE_NAME)?.value;

    if (!onboardingToken) {
      return NextResponse.json({ error: 'No onboarding session found' }, { status: 401 });
    }

    const payload = await verifyOnboardingToken(onboardingToken);

    if (!payload || !payload.tenantId) {
      return NextResponse.json(
        { error: 'Invalid onboarding session or missing tenant' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { domains } = body as { domains: string[] };

    if (!domains || !Array.isArray(domains) || domains.length === 0) {
      return NextResponse.json({ error: 'At least one domain is required' }, { status: 400 });
    }

    // Validate and check availability of all domains
    const errors: { domain: string; error: string }[] = [];
    const validDomains: string[] = [];

    for (const domain of domains) {
      // Normalize: lowercase, trim, and strip www. prefix
      const normalizedDomain = normalizeDomain(domain);

      // Validate format
      if (!isValidDomain(normalizedDomain)) {
        errors.push({ domain, error: 'Invalid domain format' });
        continue;
      }

      // Check availability
      const available = await isDomainAvailable(normalizedDomain);
      if (!available) {
        // Check if it's already ours
        const currentDomains = await getTenantDomains(payload.tenantId);
        if (!currentDomains.includes(normalizedDomain)) {
          errors.push({ domain, error: 'Domain already claimed by another tenant' });
          continue;
        }
      }

      validDomains.push(normalizedDomain);
    }

    if (errors.length > 0 && validDomains.length === 0) {
      return NextResponse.json(
        { error: 'No valid domains provided', details: errors },
        { status: 400 }
      );
    }

    // Update tenant with valid domains
    await updateTenantDomains(payload.tenantId, validDomains);

    logger.info(
      { tenantId: payload.tenantId, domains: validDomains },
      'Domains updated for tenant'
    );

    // Generate new onboarding token for snippet step
    const newOnboardingToken = await generateOnboardingToken(
      payload.email,
      'snippet',
      payload.tenantId
    );

    const response = NextResponse.json({
      success: true,
      domains: validDomains,
      errors: errors.length > 0 ? errors : undefined,
      nextStep: '/onboarding/snippet',
    });

    // Update onboarding cookie
    response.cookies.set({
      name: ONBOARDING_COOKIE_NAME,
      value: newOnboardingToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 3600,
      path: '/',
    });

    return response;
  } catch (error) {
    logger.error({ err: error }, 'Update domains error');
    return NextResponse.json({ error: 'Failed to update domains' }, { status: 500 });
  }
}
