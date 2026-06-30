/**
 * Postgres implementation of tenant website-domain storage (Phase C). Mirrors
 * the ClickHouse module in queries/domains.ts — same args, same TenantDomain
 * shape. Dispatch is gated by pgConfigEnabled().
 */
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { tenantDomains } from '@/lib/db/schema';
import type { TenantDomain } from '@/lib/types/user-management';

function iso(d: Date): string {
  return d.toISOString();
}

function mapRow(r: typeof tenantDomains.$inferSelect): TenantDomain {
  return {
    DomainId: r.domainId,
    TenantId: r.tenantId,
    Domain: r.domain,
    DisplayName: r.displayName,
    Verified: r.verified,
    VerificationToken: r.verificationToken,
    CreatedAt: iso(r.createdAt),
    UpdatedAt: iso(r.updatedAt),
  };
}

export async function getTenantDomains(tenantId: string): Promise<TenantDomain[]> {
  const rows = await getDb()
    .select()
    .from(tenantDomains)
    .where(eq(tenantDomains.tenantId, tenantId))
    .orderBy(tenantDomains.domain);
  return rows.map(mapRow);
}

export async function getDomainById(domainId: string): Promise<TenantDomain | null> {
  const rows = await getDb()
    .select()
    .from(tenantDomains)
    .where(eq(tenantDomains.domainId, domainId))
    .limit(1);
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function addTenantDomain(
  tenantId: string,
  domain: string,
  displayName?: string
): Promise<TenantDomain> {
  const domainId = `domain_${uuidv4()}`;
  const verificationToken = `og-verify-${uuidv4().replace(/-/g, '')}`;
  const normalizedDomain = domain.toLowerCase().trim();
  const rows = await getDb()
    .insert(tenantDomains)
    .values({
      domainId,
      tenantId,
      domain: normalizedDomain,
      displayName: displayName || '',
      verified: false,
      verificationToken,
    })
    .returning();
  return mapRow(rows[0]);
}

export async function removeTenantDomain(domainId: string): Promise<void> {
  await getDb().delete(tenantDomains).where(eq(tenantDomains.domainId, domainId));
}

/**
 * Is this WEBSITE domain registered by any tenant? Operates on `tenant_domains`
 * (telemetry/origin). Distinct from the email-domain check
 * identity-pg.isDomainAvailable (tenant_allowed_domains), which has inverted
 * polarity (available vs. registered).
 */
export async function isDomainRegistered(domain: string): Promise<boolean> {
  const normalizedDomain = domain.toLowerCase().trim();
  const rows = await getDb()
    .select({ domainId: tenantDomains.domainId })
    .from(tenantDomains)
    .where(eq(tenantDomains.domain, normalizedDomain))
    .limit(1);
  return rows.length > 0;
}

export async function getDomainByHostname(hostname: string): Promise<TenantDomain | null> {
  const normalizedHostname = hostname.toLowerCase().trim();
  const rows = await getDb()
    .select()
    .from(tenantDomains)
    .where(eq(tenantDomains.domain, normalizedHostname))
    .limit(1);
  return rows[0] ? mapRow(rows[0]) : null;
}
