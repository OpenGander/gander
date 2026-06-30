/**
 * Services API Route
 * GET - List all services with mappings (combines active ServiceNames + stored mappings + stubs)
 * POST - Create/update a service mapping or create a new stub
 * DELETE - Remove a service mapping (only stubs without telemetry)
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { getViewingTenantId } from '@/lib/api-utils';
import {
  getServicesWithMappings,
  upsertServiceMapping,
  createServiceStub,
  deleteServiceStub,
} from '@/lib/queries/services';
import { generateTrackingSnippet, getPlatformInstructions } from '@/lib/snippet';
import type { ServicePlatform } from '@/lib/types/user-management';
import logger from '@/lib/logger';

export async function GET(req: NextRequest) {
  // 1. Verify authentication
  const session = await verifySession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Verify tenant access
  if (!session.tenantId) {
    return NextResponse.json({ error: 'No tenant access' }, { status: 403 });
  }

  // 3. Get viewing tenant (supports multi-tenant switching)
  const tenantId = await getViewingTenantId(req, session);

  // 4. Parse optional lookback parameter
  const { searchParams } = new URL(req.url);
  const lookbackDays = parseInt(searchParams.get('lookback') || '30', 10);

  try {
    const services = await getServicesWithMappings(tenantId, lookbackDays);

    // Add installation snippet and instructions for each service
    const servicesWithSnippets = services.map((service) => ({
      ...service,
      installSnippet:
        service.platform === 'web' || !service.platform
          ? generateTrackingSnippet({ serviceName: service.serviceName })
          : null,
      installInstructions: getPlatformInstructions(service.platform || 'web'),
    }));

    return NextResponse.json({ services: servicesWithSnippets });
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch services');
    return NextResponse.json({ error: 'Failed to fetch services' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  // 1. Verify authentication
  const session = await verifySession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Verify tenant access
  if (!session.tenantId) {
    return NextResponse.json({ error: 'No tenant access' }, { status: 403 });
  }

  // 3. Get viewing tenant
  const tenantId = await getViewingTenantId(req, session);

  // 4. Parse request body
  let body: {
    serviceName?: string;
    displayName?: string;
    platform?: string;
    isStub?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { serviceName, displayName, platform, isStub } = body;

  if (!serviceName || typeof serviceName !== 'string') {
    return NextResponse.json({ error: 'serviceName is required' }, { status: 400 });
  }

  // Validate serviceName format (alphanumeric, hyphens, underscores only)
  if (!/^[a-zA-Z0-9_-]+$/.test(serviceName)) {
    return NextResponse.json(
      { error: 'serviceName must contain only letters, numbers, hyphens, and underscores' },
      { status: 400 }
    );
  }

  try {
    if (isStub) {
      // Creating a new service stub
      const validPlatforms: ServicePlatform[] = ['web', 'nodejs', 'python', ''];
      const normalizedPlatform = (platform || 'web') as ServicePlatform;

      if (!validPlatforms.includes(normalizedPlatform)) {
        return NextResponse.json(
          { error: 'Invalid platform. Must be: web, nodejs, or python' },
          { status: 400 }
        );
      }

      const success = await createServiceStub(
        tenantId,
        serviceName,
        displayName || serviceName,
        normalizedPlatform,
        session.userId
      );

      if (success) {
        return NextResponse.json({ success: true });
      }
      return NextResponse.json({ error: 'Failed to create service' }, { status: 500 });
    } else {
      // Updating display name for existing service
      if (!displayName || typeof displayName !== 'string') {
        return NextResponse.json({ error: 'displayName is required' }, { status: 400 });
      }

      const success = await upsertServiceMapping(tenantId, serviceName, displayName);
      if (success) {
        return NextResponse.json({ success: true });
      }
      return NextResponse.json({ error: 'Failed to save mapping' }, { status: 500 });
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to save service');
    return NextResponse.json({ error: 'Failed to save service' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  // 1. Verify authentication
  const session = await verifySession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Verify tenant access
  if (!session.tenantId) {
    return NextResponse.json({ error: 'No tenant access' }, { status: 403 });
  }

  // 3. Get viewing tenant
  const tenantId = await getViewingTenantId(req, session);

  // 4. Parse request body
  let body: { serviceName?: string; deleteStub?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { serviceName, deleteStub } = body;

  if (!serviceName || typeof serviceName !== 'string') {
    return NextResponse.json({ error: 'serviceName is required' }, { status: 400 });
  }

  try {
    if (deleteStub) {
      // Deleting a service stub (only works if no telemetry data)
      const result = await deleteServiceStub(tenantId, serviceName);
      if (result.success) {
        return NextResponse.json({ success: true });
      }
      return NextResponse.json(
        { error: result.error || 'Failed to delete service' },
        { status: 400 }
      );
    } else {
      // Legacy behavior: reset display name (delete mapping but keep data)
      // This is for services that have telemetry - just removes the custom display name
      const { deleteServiceMapping } = await import('@/lib/queries/services');
      const success = await deleteServiceMapping(tenantId, serviceName);
      if (success) {
        return NextResponse.json({ success: true });
      }
      return NextResponse.json({ error: 'Failed to delete mapping' }, { status: 500 });
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to delete service');
    return NextResponse.json({ error: 'Failed to delete service' }, { status: 500 });
  }
}
