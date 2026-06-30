/**
 * Domain Management API
 * GET - List all domains for the tenant
 * POST - Add a new domain (creates pending verification)
 * DELETE - Remove a domain
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import {
  createDomainVerification,
  getDomainVerifications,
  deleteDomainVerification,
  isDomainClaimedByOtherTenant,
} from '@/lib/queries/domains';
import { getTenantDomains, updateTenantDomains } from '@/lib/queries/tenants';
import { getDNSInstructions } from '@/lib/dns-verify';
import logger from '@/lib/logger';

// Domain validation regex - allows subdomains
const DOMAIN_REGEX = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

function isValidDomain(domain: string): boolean {
  return DOMAIN_REGEX.test(domain);
}

function normalizeDomain(domain: string): string {
  return domain
    .toLowerCase()
    .trim()
    .replace(/^www\./, '');
}

/**
 * GET /api/settings/domains
 * List all domains for the current tenant with their verification status
 */
export async function GET(req: NextRequest) {
  try {
    const session = await verifySession(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get verified domains from tenant
    const verifiedDomains = await getTenantDomains(session.tenantId);

    // Get pending verifications
    const verifications = await getDomainVerifications(session.tenantId);

    // Combine into unified list
    const domains = [
      // Verified domains (from tenant.AllowedDomains)
      ...verifiedDomains.map((domain) => ({
        domain,
        status: 'verified' as const,
        createdAt: null,
        verifiedAt: null,
      })),
      // Pending verifications (not yet in AllowedDomains)
      ...verifications
        .filter((v) => v.Status === 'pending' && !verifiedDomains.includes(v.Domain))
        .map((v) => ({
          domain: v.Domain,
          status: v.Status,
          createdAt: v.CreatedAt,
          verifiedAt: v.VerifiedAt,
          verificationToken: v.VerificationToken,
        })),
    ];

    return NextResponse.json({ domains });
  } catch (error) {
    logger.error({ err: error }, 'List domains error');
    return NextResponse.json({ error: 'Failed to list domains' }, { status: 500 });
  }
}

/**
 * POST /api/settings/domains
 * Add a new domain and create pending verification
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

    // Validate domain format
    if (!isValidDomain(normalizedDomain)) {
      return NextResponse.json({ error: 'Invalid domain format' }, { status: 400 });
    }

    // Check if already owned by this tenant
    const existingDomains = await getTenantDomains(session.tenantId);
    if (existingDomains.includes(normalizedDomain)) {
      return NextResponse.json({ error: 'Domain already added to your account' }, { status: 400 });
    }

    // Check if claimed by another tenant
    const claimCheck = await isDomainClaimedByOtherTenant(normalizedDomain, session.tenantId);
    if (claimCheck.claimed) {
      return NextResponse.json(
        { error: 'Domain is already claimed by another account' },
        { status: 400 }
      );
    }

    // Create pending verification
    const verification = await createDomainVerification(session.tenantId, normalizedDomain);

    // Generate DNS instructions
    const dnsInstructions = getDNSInstructions(normalizedDomain, verification.VerificationToken);

    return NextResponse.json({
      domain: normalizedDomain,
      verificationToken: verification.VerificationToken,
      status: 'pending',
      dnsInstructions,
    });
  } catch (error) {
    logger.error({ err: error }, 'Add domain error');
    return NextResponse.json({ error: 'Failed to add domain' }, { status: 500 });
  }
}

/**
 * DELETE /api/settings/domains
 * Remove a domain from the tenant
 */
export async function DELETE(req: NextRequest) {
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

    // Remove from tenant's AllowedDomains
    const currentDomains = await getTenantDomains(session.tenantId);
    const updatedDomains = currentDomains.filter((d) => d !== normalizedDomain);

    if (updatedDomains.length !== currentDomains.length) {
      await updateTenantDomains(session.tenantId, updatedDomains);
    }

    // Remove verification record
    await deleteDomainVerification(session.tenantId, normalizedDomain);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'Delete domain error');
    return NextResponse.json({ error: 'Failed to delete domain' }, { status: 500 });
  }
}
