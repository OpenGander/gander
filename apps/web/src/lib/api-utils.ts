/**
 * API Utilities
 * Shared helpers for API route handlers
 */

import { NextRequest } from 'next/server';
import type { SessionPayload } from './auth';
import { canAccessTenant } from './rbac';
import logger from './logger';

/**
 * Get the viewing tenant ID from request params or session
 *
 * Priority:
 * 1. Query param `viewingTenant` (if user has access)
 * 2. Session's tenantId (fallback)
 *
 * @param req - The NextRequest object
 * @param session - The validated session
 * @returns The tenant ID to use for queries
 */
export async function getViewingTenantId(
  req: NextRequest,
  session: SessionPayload
): Promise<string> {
  const { searchParams } = new URL(req.url);
  const viewingTenant = searchParams.get('viewingTenant');

  // No override requested, use session tenant
  if (!viewingTenant) {
    return session.tenantId;
  }

  // Same as session tenant, no need to validate
  if (viewingTenant === session.tenantId) {
    return session.tenantId;
  }

  // Validate access to requested tenant
  const hasAccess = await canAccessTenant(session, viewingTenant);
  if (!hasAccess) {
    logger.warn(
      { email: session.email, tenantId: viewingTenant },
      'Unauthorized tenant access attempt'
    );
    return session.tenantId;
  }

  return viewingTenant;
}
