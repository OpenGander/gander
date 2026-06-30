/**
 * Service Query Module
 * Queries for fetching active ServiceNames from otel_traces and managing display name mappings
 */

import { getClickHouseClient } from '@/lib/clickhouse';
import type {
  ServiceMapping,
  ServiceWithMapping,
  ServicePlatform,
} from '@/lib/types/user-management';
import { pgConfigEnabled } from '@/lib/db/config-flag';
import * as servicesPg from './services-pg';
import logger from '@/lib/logger';

/**
 * Get distinct ServiceNames from otel_traces for a tenant
 * Returns services that have sent data within the lookback period
 */
export async function getActiveServiceNames(
  tenantId: string,
  lookbackDays: number = 30
): Promise<string[]> {
  const client = getClickHouseClient();

  const query = `
    SELECT DISTINCT ServiceName
    FROM opengander.otel_traces
    WHERE TenantId = {tenantId:String}
      AND Timestamp >= now() - INTERVAL {lookbackDays:UInt32} DAY
      AND ServiceName != ''
    ORDER BY ServiceName
  `;

  try {
    const result = await client.query({
      query,
      query_params: { tenantId, lookbackDays },
      format: 'JSONEachRow',
    });
    const data = await result.json<{ ServiceName: string }[]>();
    return data.map((row) => row.ServiceName);
  } catch (error) {
    logger.error({ err: error }, 'Failed to get active service names');
    return [];
  }
}

/**
 * Extended service mapping with stub columns
 */
interface ServiceMappingExtended extends ServiceMapping {
  Status: 'stub' | 'active';
  Platform: string;
  CreatedBy: string;
}

/**
 * Get all service mappings for a tenant (including stub fields)
 */
export async function getServiceMappings(tenantId: string): Promise<ServiceMappingExtended[]> {
  if (pgConfigEnabled()) return servicesPg.getServiceMappings(tenantId);
  const client = getClickHouseClient();

  const query = `
    SELECT
      TenantId,
      ServiceName,
      DisplayName,
      Status,
      Platform,
      CreatedBy,
      CreatedAt,
      UpdatedAt
    FROM opengander.service_mappings FINAL
    WHERE TenantId = {tenantId:String}
    ORDER BY ServiceName
  `;

  try {
    const result = await client.query({
      query,
      query_params: { tenantId },
      format: 'JSONEachRow',
    });
    return await result.json<ServiceMappingExtended[]>();
  } catch (error) {
    logger.error({ err: error }, 'Failed to get service mappings');
    return [];
  }
}

/**
 * Create or update a service mapping
 * Uses ReplacingMergeTree so duplicates are handled automatically
 */
export async function upsertServiceMapping(
  tenantId: string,
  serviceName: string,
  displayName: string
): Promise<boolean> {
  if (pgConfigEnabled()) return servicesPg.upsertServiceMapping(tenantId, serviceName, displayName);
  const client = getClickHouseClient();

  const query = `
    INSERT INTO opengander.service_mappings (TenantId, ServiceName, DisplayName, UpdatedAt)
    VALUES ({tenantId:String}, {serviceName:String}, {displayName:String}, now64(3))
  `;

  try {
    await client.command({
      query,
      query_params: { tenantId, serviceName, displayName },
    });
    return true;
  } catch (error) {
    logger.error({ err: error }, 'Failed to upsert service mapping');
    return false;
  }
}

/**
 * Delete a service mapping
 * Note: In ClickHouse, we use a lightweight delete
 */
export async function deleteServiceMapping(
  tenantId: string,
  serviceName: string
): Promise<boolean> {
  if (pgConfigEnabled()) return servicesPg.deleteServiceMapping(tenantId, serviceName);
  const client = getClickHouseClient();

  const query = `
    ALTER TABLE opengander.service_mappings
    DELETE WHERE TenantId = {tenantId:String} AND ServiceName = {serviceName:String}
  `;

  try {
    await client.command({
      query,
      query_params: { tenantId, serviceName },
    });
    return true;
  } catch (error) {
    logger.error({ err: error }, 'Failed to delete service mapping');
    return false;
  }
}

/**
 * Get services with their mappings combined
 * Returns all services: active (from telemetry) + stubs (from mappings without telemetry)
 */
export async function getServicesWithMappings(
  tenantId: string,
  lookbackDays: number = 30
): Promise<ServiceWithMapping[]> {
  // Fetch active services and mappings in parallel
  const [activeServices, mappings] = await Promise.all([
    getActiveServiceNames(tenantId, lookbackDays),
    getServiceMappings(tenantId),
  ]);

  // Set of active service names for quick lookup
  const activeSet = new Set(activeServices);

  // Create a map of mappings for quick lookup
  const mappingMap = new Map(mappings.map((m) => [m.ServiceName, m]));

  const result: ServiceWithMapping[] = [];

  // Add all active services (from telemetry)
  for (const serviceName of activeServices) {
    const mapping = mappingMap.get(serviceName);
    result.push({
      serviceName,
      displayName: mapping?.DisplayName || serviceName,
      hasData: true,
      status: 'active',
      platform: (mapping?.Platform || '') as ServicePlatform,
      createdBy: mapping?.CreatedBy || '',
    });
  }

  // Add stub services (mappings without telemetry data)
  for (const mapping of mappings) {
    if (!activeSet.has(mapping.ServiceName)) {
      result.push({
        serviceName: mapping.ServiceName,
        displayName: mapping.DisplayName || mapping.ServiceName,
        hasData: false,
        status: 'stub',
        platform: (mapping.Platform || '') as ServicePlatform,
        createdBy: mapping.CreatedBy || '',
      });
    }
  }

  // Sort by display name
  result.sort((a, b) => a.displayName.localeCompare(b.displayName));

  return result;
}

/**
 * Create a service stub (pre-registers a service before telemetry arrives)
 */
export async function createServiceStub(
  tenantId: string,
  serviceName: string,
  displayName: string,
  platform: ServicePlatform,
  createdBy: string
): Promise<boolean> {
  if (pgConfigEnabled())
    return servicesPg.createServiceStub(tenantId, serviceName, displayName, platform, createdBy);
  const client = getClickHouseClient();

  const query = `
    INSERT INTO opengander.service_mappings
    (TenantId, ServiceName, DisplayName, Status, Platform, CreatedBy, UpdatedAt)
    VALUES ({tenantId:String}, {serviceName:String}, {displayName:String}, 'stub', {platform:String}, {createdBy:String}, now64(3))
  `;

  try {
    await client.command({
      query,
      query_params: { tenantId, serviceName, displayName, platform, createdBy },
    });
    return true;
  } catch (error) {
    logger.error({ err: error }, 'Failed to create service stub');
    return false;
  }
}

/**
 * Delete a service stub (only deletes if service has no telemetry data)
 * Returns false if the service has telemetry data (cannot delete active services)
 */
export async function deleteServiceStub(
  tenantId: string,
  serviceName: string
): Promise<{ success: boolean; error?: string }> {
  const client = getClickHouseClient();

  // First check if service has telemetry data
  const checkQuery = `
    SELECT count() as count
    FROM opengander.otel_traces
    WHERE TenantId = {tenantId:String}
      AND ServiceName = {serviceName:String}
      AND Timestamp >= now() - INTERVAL 30 DAY
    LIMIT 1
  `;

  try {
    const checkResult = await client.query({
      query: checkQuery,
      query_params: { tenantId, serviceName },
      format: 'JSONEachRow',
    });
    const checkData = await checkResult.json<{ count: string }[]>();
    const hasData = parseInt(checkData[0]?.count || '0', 10) > 0;

    if (hasData) {
      return { success: false, error: 'Cannot delete a service that has telemetry data' };
    }

    // Safe to delete the stub
    if (pgConfigEnabled()) {
      await servicesPg.deleteServiceMapping(tenantId, serviceName);
    } else {
      await client.command({
        query: `
          ALTER TABLE opengander.service_mappings
          DELETE WHERE TenantId = {tenantId:String} AND ServiceName = {serviceName:String}
        `,
        query_params: { tenantId, serviceName },
      });
    }

    return { success: true };
  } catch (error) {
    logger.error({ err: error }, 'Failed to delete service stub');
    return { success: false, error: 'Failed to delete service' };
  }
}
