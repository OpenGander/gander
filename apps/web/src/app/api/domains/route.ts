/**
 * Domains API - Manage tenant website domains for telemetry
 * GET /api/domains - List tenant's domains
 * POST /api/domains - Add a new domain
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { validateAction } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import {
  getTenantDomains,
  addTenantDomain,
  isDomainRegistered,
  isValidDomainFormat,
} from '@/lib/queries/domains';

export async function GET(req: NextRequest) {
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

    const domains = await getTenantDomains(session.tenantId);
    return NextResponse.json({ domains });
  } catch (err) {
    console.error('Error listing domains:', err);
    return NextResponse.json({ error: 'Failed to list domains' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
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

    const body = await req.json();
    const { domain, displayName } = body as {
      domain?: string;
      displayName?: string;
    };

    // Validate domain is provided
    if (!domain || typeof domain !== 'string') {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 });
    }

    // Validate domain format
    const normalizedDomain = domain.toLowerCase().trim();
    if (!isValidDomainFormat(normalizedDomain)) {
      return NextResponse.json(
        { error: 'Invalid domain format. Use a hostname like "www.example.com"' },
        { status: 400 }
      );
    }

    // Check if domain is already registered
    const alreadyRegistered = await isDomainRegistered(normalizedDomain);
    if (alreadyRegistered) {
      return NextResponse.json({ error: 'This domain is already registered' }, { status: 409 });
    }

    // Add the domain
    const newDomain = await addTenantDomain(session.tenantId, normalizedDomain, displayName);

    // Log the action
    await logAudit(session, 'add_domain', req, {
      targetTenantId: session.tenantId,
      metadata: {
        domain: normalizedDomain,
        displayName: displayName || null,
        domainId: newDomain.DomainId,
      },
    });

    return NextResponse.json({ success: true, domain: newDomain }, { status: 201 });
  } catch (err) {
    console.error('Error adding domain:', err);
    return NextResponse.json({ error: 'Failed to add domain' }, { status: 500 });
  }
}
