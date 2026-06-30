import { NextRequest, NextResponse } from 'next/server';
import { verifyOnboardingToken } from '@/lib/auth';
import { getTenantDomains } from '@/lib/queries/tenants';
import { generateTrackingSnippet } from '@/lib/snippet';
import logger from '@/lib/logger';

const ONBOARDING_COOKIE_NAME = 'opengander_onboarding';

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
    const snippet = generateTrackingSnippet({ domains });

    return NextResponse.json({
      snippet,
      domains,
      tenantId: payload.tenantId,
    });
  } catch (error) {
    logger.error({ err: error }, 'Get snippet error');
    return NextResponse.json({ error: 'Failed to generate snippet' }, { status: 500 });
  }
}
