/**
 * Tenant management queries for onboarding and multi-tenant operations
 */
import { getClickHouseClient } from '@/lib/clickhouse';
import type { Tenant } from './users';
import { pgIdentityEnabled } from '@/lib/db/identity-flag';
import * as identityPg from './identity-pg';

/**
 * Normalize domain by stripping www. prefix for consistent matching
 */
function normalizeDomain(domain: string): string {
  return domain
    .toLowerCase()
    .trim()
    .replace(/^www\./, '');
}

/**
 * Get a tenant by slug
 */
export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  if (pgIdentityEnabled()) return identityPg.getTenantBySlug(slug);
  const client = getClickHouseClient();

  const result = await client.query({
    query: `
      SELECT TenantId, Name, Slug, AllowedDomains, CreatedAt, UpdatedAt
      FROM opengander.tenants
      WHERE Slug = {slug:String}
      ORDER BY UpdatedAt DESC
      LIMIT 1
    `,
    query_params: { slug },
    format: 'JSONEachRow',
  });

  const rows = await result.json<Tenant[]>();
  return rows[0] || null;
}

/**
 * Create a new tenant
 */
export async function createTenant(
  tenantId: string,
  name: string,
  slug: string,
  allowedDomains: string[]
): Promise<void> {
  if (pgIdentityEnabled()) return identityPg.createTenant(tenantId, name, slug, allowedDomains);
  const client = getClickHouseClient();

  await client.insert({
    table: 'opengander.tenants',
    values: [
      {
        TenantId: tenantId,
        Name: name,
        Slug: slug,
        AllowedDomains: allowedDomains,
        // CreatedAt and UpdatedAt use DEFAULT now64(3)
      },
    ],
    format: 'JSONEachRow',
  });
}

/**
 * Add a domain to a tenant's AllowedDomains list
 */
export async function addDomainToTenant(tenantId: string, domain: string): Promise<void> {
  if (pgIdentityEnabled()) return identityPg.addDomainToTenant(tenantId, domain);
  const client = getClickHouseClient();
  const normalizedDomain = normalizeDomain(domain);

  // First, get current tenant data including domains
  const result = await client.query({
    query: `
      SELECT TenantId, Name, Slug, AllowedDomains
      FROM opengander.tenants
      WHERE TenantId = {tenantId:String}
      ORDER BY UpdatedAt DESC
      LIMIT 1
    `,
    query_params: { tenantId },
    format: 'JSONEachRow',
  });

  const rows = await result.json<Tenant[]>();
  if (rows.length === 0) {
    throw new Error(`Tenant not found: ${tenantId}`);
  }

  const tenant = rows[0];
  const currentDomains = tenant.AllowedDomains || [];

  // Add new domain if not already present
  if (!currentDomains.includes(normalizedDomain)) {
    const newDomains = [...currentDomains, normalizedDomain];

    // Insert new row with updated domains (ReplacingMergeTree will handle versioning)
    await client.insert({
      table: 'opengander.tenants',
      values: [
        {
          TenantId: tenant.TenantId,
          Name: tenant.Name,
          Slug: tenant.Slug,
          AllowedDomains: newDomains,
        },
      ],
      format: 'JSONEachRow',
    });
  }
}

/**
 * Check if a domain is available (not already claimed by another tenant)
 */
export async function isDomainAvailable(domain: string): Promise<boolean> {
  if (pgIdentityEnabled()) return identityPg.isDomainAvailable(domain);
  const client = getClickHouseClient();
  const normalizedDomain = normalizeDomain(domain);

  const result = await client.query({
    query: `
      SELECT TenantId
      FROM opengander.tenants
      WHERE has(AllowedDomains, {domain:String})
      LIMIT 1
    `,
    query_params: { domain: normalizedDomain },
    format: 'JSONEachRow',
  });

  const rows = await result.json<{ TenantId: string }[]>();
  return rows.length === 0;
}

/**
 * Get all domains for a tenant
 */
export async function getTenantDomains(tenantId: string): Promise<string[]> {
  if (pgIdentityEnabled()) return identityPg.getTenantDomains(tenantId);
  const client = getClickHouseClient();

  const result = await client.query({
    query: `
      SELECT AllowedDomains
      FROM opengander.tenants
      WHERE TenantId = {tenantId:String}
      ORDER BY UpdatedAt DESC
      LIMIT 1
    `,
    query_params: { tenantId },
    format: 'JSONEachRow',
  });

  const rows = await result.json<{ AllowedDomains: string[] }[]>();
  return rows.length > 0 ? rows[0].AllowedDomains : [];
}

/**
 * Update tenant Stripe subscription fields
 */
export interface TenantStripeUpdate {
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  subscriptionStatus?: string;
  trialEndsAt?: Date | null;
}

interface TenantWithStripe extends Tenant {
  StripeCustomerId: string | null;
  StripeSubscriptionId: string | null;
  SubscriptionStatus: string;
  TrialEndsAt: string | null;
}

export async function updateTenantStripe(
  tenantId: string,
  update: TenantStripeUpdate
): Promise<void> {
  if (pgIdentityEnabled()) return identityPg.updateTenantStripe(tenantId, update);
  const client = getClickHouseClient();

  // Get current tenant data including Stripe fields
  const result = await client.query({
    query: `
      SELECT TenantId, Name, Slug, AllowedDomains,
             StripeCustomerId, StripeSubscriptionId, SubscriptionStatus, TrialEndsAt
      FROM opengander.tenants
      WHERE TenantId = {tenantId:String}
      ORDER BY UpdatedAt DESC
      LIMIT 1
    `,
    query_params: { tenantId },
    format: 'JSONEachRow',
  });

  const rows = await result.json<TenantWithStripe[]>();
  if (rows.length === 0) {
    throw new Error(`Tenant not found: ${tenantId}`);
  }

  const tenant = rows[0];

  // Insert new row with updated Stripe fields (ReplacingMergeTree versioning)
  await client.insert({
    table: 'opengander.tenants',
    values: [
      {
        TenantId: tenant.TenantId,
        Name: tenant.Name,
        Slug: tenant.Slug,
        AllowedDomains: tenant.AllowedDomains || [],
        StripeCustomerId: update.stripeCustomerId ?? tenant.StripeCustomerId ?? null,
        StripeSubscriptionId: update.stripeSubscriptionId ?? tenant.StripeSubscriptionId ?? null,
        SubscriptionStatus: update.subscriptionStatus ?? tenant.SubscriptionStatus ?? 'none',
        TrialEndsAt:
          update.trialEndsAt !== undefined ? update.trialEndsAt : (tenant.TrialEndsAt ?? null),
      },
    ],
    format: 'JSONEachRow',
  });
}

/**
 * Update tenant with new domains list (replaces all domains)
 */
export async function updateTenantDomains(tenantId: string, domains: string[]): Promise<void> {
  if (pgIdentityEnabled()) return identityPg.updateTenantDomains(tenantId, domains);
  const client = getClickHouseClient();

  // Get current tenant data
  const result = await client.query({
    query: `
      SELECT TenantId, Name, Slug
      FROM opengander.tenants
      WHERE TenantId = {tenantId:String}
      ORDER BY UpdatedAt DESC
      LIMIT 1
    `,
    query_params: { tenantId },
    format: 'JSONEachRow',
  });

  const rows = await result.json<Tenant[]>();
  if (rows.length === 0) {
    throw new Error(`Tenant not found: ${tenantId}`);
  }

  const tenant = rows[0];

  // Insert new row with updated domains
  await client.insert({
    table: 'opengander.tenants',
    values: [
      {
        TenantId: tenant.TenantId,
        Name: tenant.Name,
        Slug: tenant.Slug,
        AllowedDomains: domains,
      },
    ],
    format: 'JSONEachRow',
  });
}
