/**
 * Domain Verification API
 * POST - Verify domain ownership via DNS TXT record lookup
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { getDomainVerification, updateDomainStatus } from '@/lib/queries/domains';
import { addDomainToTenant } from '@/lib/queries/tenants';
import { verifyDomainDNS } from '@/lib/dns-verify';
import logger from '@/lib/logger';

function normalizeDomain(domain: string): string {
  return domain
    .toLowerCase()
    .trim()
    .replace(/^www\./, '');
}

/**
 * POST /api/settings/domains/verify
 * Verify domain ownership via DNS TXT record
 */
export async function POST(req: NextRequest) {
  try {
    const session = await verifySession(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { domain } = body;

    if (!domain || typeof domain !== 'string') {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 });
    }

    const normalizedDomain = normalizeDomain(domain);

    // Get the pending verification record
    const verification = await getDomainVerification(session.tenantId, normalizedDomain);

    if (!verification) {
      return NextResponse.json(
        { error: 'Domain verification not found. Please add the domain first.' },
        { status: 404 }
      );
    }

    if (verification.Status === 'verified') {
      return NextResponse.json({
        verified: true,
        message: 'Domain is already verified',
      });
    }

    // Perform DNS verification
    const result = await verifyDomainDNS(normalizedDomain, verification.VerificationToken);

    if (result.verified) {
      // Update verification status
      await updateDomainStatus(session.tenantId, normalizedDomain, 'verified', new Date());

      // Add to tenant's AllowedDomains
      await addDomainToTenant(session.tenantId, normalizedDomain);

      return NextResponse.json({
        verified: true,
        message: 'Domain verified successfully',
      });
    }

    // Verification failed
    return NextResponse.json({
      verified: false,
      error: result.error || 'DNS verification failed',
    });
  } catch (error) {
    logger.error({ err: error }, 'Verify domain error');
    return NextResponse.json({ error: 'Failed to verify domain' }, { status: 500 });
  }
}
