/**
 * Postgres implementation of service_mappings (Phase C). Mirrors the mutable
 * pieces of queries/services.ts (the otel_traces reads stay in ClickHouse).
 * Functions are resilient — they log and return a falsy/empty result on error,
 * matching the ClickHouse module's behaviour. Dispatch gated by pgConfigEnabled().
 */
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { serviceMappings } from '@/lib/db/schema';
import type { ServicePlatform } from '@/lib/types/user-management';
import logger from '@/lib/logger';

export interface ServiceMappingExtended {
  TenantId: string;
  ServiceName: string;
  DisplayName: string;
  Status: 'stub' | 'active';
  Platform: string;
  CreatedBy: string;
  CreatedAt: string;
  UpdatedAt: string;
}

export async function getServiceMappings(tenantId: string): Promise<ServiceMappingExtended[]> {
  try {
    const rows = await getDb()
      .select()
      .from(serviceMappings)
      .where(eq(serviceMappings.tenantId, tenantId))
      .orderBy(serviceMappings.serviceName);
    return rows.map((r) => ({
      TenantId: r.tenantId,
      ServiceName: r.serviceName,
      DisplayName: r.displayName,
      Status: r.status === 'active' ? 'active' : 'stub',
      Platform: r.platform,
      CreatedBy: r.createdBy,
      CreatedAt: r.createdAt.toISOString(),
      UpdatedAt: r.updatedAt.toISOString(),
    }));
  } catch (error) {
    logger.error({ err: error }, 'Failed to get service mappings');
    return [];
  }
}

/** Set the display name, preserving status/platform/created_by on update. */
export async function upsertServiceMapping(
  tenantId: string,
  serviceName: string,
  displayName: string
): Promise<boolean> {
  try {
    await getDb()
      .insert(serviceMappings)
      .values({ tenantId, serviceName, displayName })
      .onConflictDoUpdate({
        target: [serviceMappings.tenantId, serviceMappings.serviceName],
        set: { displayName, updatedAt: new Date() },
      });
    return true;
  } catch (error) {
    logger.error({ err: error }, 'Failed to upsert service mapping');
    return false;
  }
}

export async function deleteServiceMapping(
  tenantId: string,
  serviceName: string
): Promise<boolean> {
  try {
    await getDb()
      .delete(serviceMappings)
      .where(
        and(eq(serviceMappings.tenantId, tenantId), eq(serviceMappings.serviceName, serviceName))
      );
    return true;
  } catch (error) {
    logger.error({ err: error }, 'Failed to delete service mapping');
    return false;
  }
}

export async function createServiceStub(
  tenantId: string,
  serviceName: string,
  displayName: string,
  platform: ServicePlatform,
  createdBy: string
): Promise<boolean> {
  try {
    await getDb()
      .insert(serviceMappings)
      .values({ tenantId, serviceName, displayName, status: 'stub', platform, createdBy })
      .onConflictDoUpdate({
        target: [serviceMappings.tenantId, serviceMappings.serviceName],
        set: { displayName, status: 'stub', platform, createdBy, updatedAt: new Date() },
      });
    return true;
  } catch (error) {
    logger.error({ err: error }, 'Failed to create service stub');
    return false;
  }
}
