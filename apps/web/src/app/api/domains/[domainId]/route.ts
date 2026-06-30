/**
 * Domain API - Manage a specific domain
 * DELETE /api/domains/[domainId] - Remove a domain
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { validateAction, canAccessTenant } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { getDomainById, removeTenantDomain } from '@/lib/queries/domains';

interface RouteParams {
  params: Promise<{ domainId: string }>;
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await verifySession(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Require admin role to manage domains
    const validationError = validateAction(session, 'manage_tenant');
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 403 });
    }

    const { domainId } = await params;

    // Get the domain to verify ownership
    const domain = await getDomainById(domainId);
    if (!domain) {
      return NextResponse.json({ error: 'Domain not found' }, { status: 404 });
    }

    // Verify the domain belongs to a tenant the user can access
    const hasAccess = await canAccessTenant(session, domain.TenantId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Remove the domain
    await removeTenantDomain(domainId);

    // Log the action
    await logAudit(session, 'remove_domain', req, {
      targetTenantId: domain.TenantId,
      metadata: {
        domain: domain.Domain,
        domainId: domain.DomainId,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error removing domain:', err);
    return NextResponse.json({ error: 'Failed to remove domain' }, { status: 500 });
  }
}
