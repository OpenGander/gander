/**
 * Domain management queries for tenant website domains
 * These are domains registered for telemetry collection (separate from email domains)
 */
import { v4 as uuidv4 } from 'uuid';
import { getClickHouseClient } from '@/lib/clickhouse';
import type { TenantDomain } from '@/lib/types/user-management';
import { pgConfigEnabled } from '@/lib/db/config-flag';
import * as domainsPg from './domains-pg';

/**
 * Get all domains registered for a tenant
 */
export async function getTenantDomains(tenantId: string): Promise<TenantDomain[]> {
  if (pgConfigEnabled()) return domainsPg.getTenantDomains(tenantId);
  const client = getClickHouseClient();

  const result = await client.query({
    query: `
      SELECT
        DomainId,
        TenantId,
        Domain,
        DisplayName,
        Verified,
        VerificationToken,
        CreatedAt,
        UpdatedAt
      FROM opengander.tenant_domains FINAL
      WHERE TenantId = {tenantId:String}
      ORDER BY Domain ASC
    `,
    query_params: { tenantId },
    format: 'JSONEachRow',
  });

  const rows = await result.json<
    {
      DomainId: string;
      TenantId: string;
      Domain: string;
      DisplayName: string;
      Verified: number;
      VerificationToken: string;
      CreatedAt: string;
      UpdatedAt: string;
    }[]
  >();

  // Convert UInt8 Verified to boolean
  return rows.map((row) => ({
    ...row,
    Verified: row.Verified === 1,
  }));
}

/**
 * Get a single domain by ID
 */
export async function getDomainById(domainId: string): Promise<TenantDomain | null> {
  if (pgConfigEnabled()) return domainsPg.getDomainById(domainId);
  const client = getClickHouseClient();

  const result = await client.query({
    query: `
      SELECT
        DomainId,
        TenantId,
        Domain,
        DisplayName,
        Verified,
        VerificationToken,
        CreatedAt,
        UpdatedAt
      FROM opengander.tenant_domains FINAL
      WHERE DomainId = {domainId:String}
      LIMIT 1
    `,
    query_params: { domainId },
    format: 'JSONEachRow',
  });

  const rows = await result.json<
    {
      DomainId: string;
      TenantId: string;
      Domain: string;
      DisplayName: string;
      Verified: number;
      VerificationToken: string;
      CreatedAt: string;
      UpdatedAt: string;
    }[]
  >();

  if (rows.length === 0) {
    return null;
  }

  return {
    ...rows[0],
    Verified: rows[0].Verified === 1,
  };
}

/**
 * Add a new domain to a tenant
 * Generates DomainId and VerificationToken automatically
 */
export async function addTenantDomain(
  tenantId: string,
  domain: string,
  displayName?: string
): Promise<TenantDomain> {
  if (pgConfigEnabled()) return domainsPg.addTenantDomain(tenantId, domain, displayName);
  const client = getClickHouseClient();

  const domainId = `domain_${uuidv4()}`;
  const verificationToken = `og-verify-${uuidv4().replace(/-/g, '')}`;
  const normalizedDomain = domain.toLowerCase().trim();

  await client.insert({
    table: 'opengander.tenant_domains',
    values: [
      {
        DomainId: domainId,
        TenantId: tenantId,
        Domain: normalizedDomain,
        DisplayName: displayName || '',
        Verified: 0,
        VerificationToken: verificationToken,
      },
    ],
    format: 'JSONEachRow',
  });

  // Return the created domain
  return {
    DomainId: domainId,
    TenantId: tenantId,
    Domain: normalizedDomain,
    DisplayName: displayName || '',
    Verified: false,
    VerificationToken: verificationToken,
    CreatedAt: new Date().toISOString(),
    UpdatedAt: new Date().toISOString(),
  };
}

/**
 * Remove a domain from a tenant
 * Uses ReplacingMergeTree pattern - marks as deleted by setting UpdatedAt
 * Actually deletes using ALTER TABLE DELETE for clean removal
 */
export async function removeTenantDomain(domainId: string): Promise<void> {
  if (pgConfigEnabled()) return domainsPg.removeTenantDomain(domainId);
  const client = getClickHouseClient();

  // With ReplacingMergeTree, we need to actually delete the row
  await client.command({
    query: `
      ALTER TABLE opengander.tenant_domains
      DELETE WHERE DomainId = {domainId:String}
    `,
    query_params: { domainId },
  });
}

/**
 * Check if a domain is already registered by any tenant
 */
export async function isDomainRegistered(domain: string): Promise<boolean> {
  if (pgConfigEnabled()) return domainsPg.isDomainRegistered(domain);
  const client = getClickHouseClient();

  const normalizedDomain = domain.toLowerCase().trim();

  const result = await client.query({
    query: `
      SELECT DomainId
      FROM opengander.tenant_domains FINAL
      WHERE Domain = {domain:String}
      LIMIT 1
    `,
    query_params: { domain: normalizedDomain },
    format: 'JSONEachRow',
  });

  const rows = await result.json<{ DomainId: string }[]>();
  return rows.length > 0;
}

/**
 * Get domain by hostname (for token service lookups)
 */
export async function getDomainByHostname(hostname: string): Promise<TenantDomain | null> {
  if (pgConfigEnabled()) return domainsPg.getDomainByHostname(hostname);
  const client = getClickHouseClient();

  const normalizedHostname = hostname.toLowerCase().trim();

  const result = await client.query({
    query: `
      SELECT
        DomainId,
        TenantId,
        Domain,
        DisplayName,
        Verified,
        VerificationToken,
        CreatedAt,
        UpdatedAt
      FROM opengander.tenant_domains FINAL
      WHERE Domain = {domain:String}
      LIMIT 1
    `,
    query_params: { domain: normalizedHostname },
    format: 'JSONEachRow',
  });

  const rows = await result.json<
    {
      DomainId: string;
      TenantId: string;
      Domain: string;
      DisplayName: string;
      Verified: number;
      VerificationToken: string;
      CreatedAt: string;
      UpdatedAt: string;
    }[]
  >();

  if (rows.length === 0) {
    return null;
  }

  return {
    ...rows[0],
    Verified: rows[0].Verified === 1,
  };
}

/**
 * Validate domain format (hostname only, no protocol or path)
 */
export function isValidDomainFormat(domain: string): boolean {
  // Must be a valid hostname format
  const hostnameRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
  return hostnameRegex.test(domain.toLowerCase().trim());
}

// =============================================================================
// Domain Verification Stubs (TODO: implement for settings/domains routes)
// =============================================================================

interface DomainVerification {
  Domain: string;
  Status: string;
  VerificationToken: string;
  CreatedAt: string;
  VerifiedAt: string | null;
}

export async function createDomainVerification(
  _tenantId: string,
  _domain: string
): Promise<DomainVerification> {
  throw new Error('Not implemented: createDomainVerification');
}

export async function getDomainVerifications(_tenantId: string): Promise<DomainVerification[]> {
  throw new Error('Not implemented: getDomainVerifications');
}

export async function getDomainVerification(
  _tenantId: string,
  _domain: string
): Promise<DomainVerification | null> {
  throw new Error('Not implemented: getDomainVerification');
}

export async function deleteDomainVerification(_tenantId: string, _domain: string): Promise<void> {
  throw new Error('Not implemented: deleteDomainVerification');
}

export async function isDomainClaimedByOtherTenant(
  _domain: string,
  _tenantId: string
): Promise<{ claimed: boolean }> {
  throw new Error('Not implemented: isDomainClaimedByOtherTenant');
}

export async function updateDomainStatus(
  _tenantId: string,
  _domain: string,
  _status: string,
  _verifiedAt: Date
): Promise<void> {
  throw new Error('Not implemented: updateDomainStatus');
}
