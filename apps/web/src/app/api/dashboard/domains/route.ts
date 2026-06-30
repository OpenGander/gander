/**
 * Dashboard Domains API - Get domains for sidebar selector
 * GET /api/dashboard/domains - List domains for current tenant (any authenticated user)
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { getTenantDomains } from '@/lib/queries/domains';

export async function GET(req: NextRequest) {
  try {
    const session = await verifySession(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const allDomains = await getTenantDomains(session.tenantId);

    // Return only the fields needed for the sidebar
    const domains = allDomains.map((d) => ({
      DomainId: d.DomainId,
      Domain: d.Domain,
      DisplayName: d.DisplayName,
      Verified: d.Verified,
    }));

    return NextResponse.json({ domains });
  } catch (err) {
    console.error('Error listing dashboard domains:', err);
    return NextResponse.json({ error: 'Failed to list domains' }, { status: 500 });
  }
}
