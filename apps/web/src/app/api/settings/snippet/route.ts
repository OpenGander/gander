/**
 * Settings Snippet API
 * Returns the tracking snippet for authenticated users
 * Supports optional domain parameter for domain-specific snippets
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { getTenantDomains } from '@/lib/queries/tenants';
import { generateTrackingSnippet } from '@/lib/snippet';
import logger from '@/lib/logger';

export async function GET(req: NextRequest) {
  try {
    const session = await verifySession(req);

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get optional domain parameter for domain-specific snippet
    const { searchParams } = new URL(req.url);
    const requestedDomain = searchParams.get('domain');

    const domains = await getTenantDomains(session.tenantId);

    // If a specific domain is requested, validate it belongs to this tenant
    if (requestedDomain) {
      const normalizedDomain = requestedDomain
        .toLowerCase()
        .trim()
        .replace(/^www\./, '');
      if (!domains.includes(normalizedDomain)) {
        return NextResponse.json({ error: 'Domain not found in your account' }, { status: 404 });
      }
      // Generate snippet for specific domain
      const snippet = generateTrackingSnippet({ domains: [normalizedDomain] });
      return NextResponse.json({
        snippet,
        domain: normalizedDomain,
        tenantId: session.tenantId,
      });
    }

    // Default: generate snippet for first domain (or generic)
    const snippet = generateTrackingSnippet({ domains });

    return NextResponse.json({
      snippet,
      domains,
      tenantId: session.tenantId,
    });
  } catch (error) {
    logger.error({ err: error }, 'Get snippet error');
    return NextResponse.json({ error: 'Failed to generate snippet' }, { status: 500 });
  }
}
