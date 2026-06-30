/**
 * Postgres implementations of the identity-core data access (tenants, users,
 * user_tenants, invites). These mirror the ClickHouse query functions exactly —
 * same arguments, same PascalCase return shapes — so call sites are unchanged.
 * Dispatch between this and the ClickHouse path is controlled by pgIdentityEnabled()
 * (see ./identity-flag).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { tenants, users, userTenants, invites, tenantAllowedDomains } from '@/lib/db/schema';
import type {
  Role,
  Tenant,
  User,
  UserWithTenant,
  UserTenantMembership,
  MembershipWithTenant,
  Invite,
} from '@/lib/types/user-management';
import { normalizeEmail } from '@/lib/utils/email';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** timestamptz columns come back as Date; the TS shapes use ISO strings. */
function iso(d: Date | string | null | undefined): string {
  if (d == null) return '';
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}
function isoOrNull(d: Date | string | null | undefined): string | null {
  return d == null ? null : iso(d);
}

/** Strip www. and lowercase for consistent domain matching. */
function normalizeDomain(domain: string): string {
  return domain
    .toLowerCase()
    .trim()
    .replace(/^www\./, '');
}

type TenantRow = typeof tenants.$inferSelect;

function mapTenant(row: TenantRow, domains: string[]): Tenant {
  return {
    TenantId: row.tenantId,
    Name: row.name,
    Slug: row.slug,
    AllowedDomains: domains,
    ParentTenantId: row.parentTenantId ?? null,
    CreatedAt: iso(row.createdAt),
    UpdatedAt: iso(row.updatedAt),
  };
}

async function domainsFor(tenantId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ domain: tenantAllowedDomains.domain })
    .from(tenantAllowedDomains)
    .where(eq(tenantAllowedDomains.tenantId, tenantId));
  return rows.map((r) => r.domain);
}

async function loadTenant(row: TenantRow | undefined): Promise<Tenant | null> {
  if (!row) return null;
  return mapTenant(row, await domainsFor(row.tenantId));
}

// ---------------------------------------------------------------------------
// users.ts equivalents
// ---------------------------------------------------------------------------

export async function getUserByEmail(email: string): Promise<User | null> {
  const normalizedEmail = normalizeEmail(email);
  const rows = await getDb().select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function getUserById(userId: string): Promise<User | null> {
  const rows = await getDb().select().from(users).where(eq(users.userId, userId)).limit(1);
  return rows[0] ? mapUser(rows[0]) : null;
}

/** A user joined to its home tenant's name (for impersonation context). */
export async function getUserWithTenantName(
  userId: string
): Promise<(User & { TenantName?: string }) | null> {
  const rows = await getDb()
    .select({ user: users, tenantName: tenants.name })
    .from(users)
    .leftJoin(tenants, eq(users.tenantId, tenants.tenantId))
    .where(eq(users.userId, userId))
    .limit(1);
  if (!rows[0]) return null;
  return { ...mapUser(rows[0].user), TenantName: rows[0].tenantName ?? undefined };
}

function mapUser(row: typeof users.$inferSelect): User {
  return {
    UserId: row.userId,
    Email: row.email,
    TenantId: row.tenantId,
    Role: row.role as Role,
    CreatedAt: iso(row.createdAt),
    UpdatedAt: iso(row.updatedAt),
  };
}

export async function getTenantById(tenantId: string): Promise<Tenant | null> {
  const rows = await getDb().select().from(tenants).where(eq(tenants.tenantId, tenantId)).limit(1);
  return loadTenant(rows[0]);
}

export async function getTenantByDomain(emailDomain: string): Promise<Tenant | null> {
  const domain = normalizeDomain(emailDomain);
  const match = await getDb()
    .select({ tenantId: tenantAllowedDomains.tenantId })
    .from(tenantAllowedDomains)
    .where(eq(tenantAllowedDomains.domain, domain))
    .limit(1);
  if (!match[0]) return null;
  return getTenantById(match[0].tenantId);
}

export async function upsertUser(
  userId: string,
  email: string,
  tenantId: string,
  role: Role = 'user'
): Promise<void> {
  const normalizedEmail = normalizeEmail(email);
  // Upsert keyed on userId — the function's real identity, matching the
  // ClickHouse row it replaces. Re-upserting the SAME userId updates it in
  // place (idempotent). Inserting a NEW userId with an email that already
  // belongs to a different user violates UNIQUE(email) and throws, surfacing
  // the collision instead of silently rebinding the existing account.
  await getDb()
    .insert(users)
    .values({ userId, email: normalizedEmail, tenantId, role })
    .onConflictDoUpdate({
      target: users.userId,
      set: { email: normalizedEmail, tenantId, role, updatedAt: new Date() },
    });
}

// ---------------------------------------------------------------------------
// tenants.ts equivalents
// ---------------------------------------------------------------------------

export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  const rows = await getDb().select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  return loadTenant(rows[0]);
}

export async function createTenant(
  tenantId: string,
  name: string,
  slug: string,
  allowedDomains: string[]
): Promise<void> {
  const domains = Array.from(new Set(allowedDomains.map(normalizeDomain).filter(Boolean)));
  await getDb().transaction(async (tx) => {
    await tx.insert(tenants).values({ tenantId, name, slug });
    if (domains.length > 0) {
      await tx
        .insert(tenantAllowedDomains)
        .values(domains.map((domain) => ({ domain, tenantId })))
        .onConflictDoNothing();
    }
  });
}

export async function addDomainToTenant(tenantId: string, domain: string): Promise<void> {
  const normalized = normalizeDomain(domain);
  await getDb()
    .insert(tenantAllowedDomains)
    .values({ domain: normalized, tenantId })
    .onConflictDoNothing();
}

/**
 * Is this EMAIL domain unclaimed by any tenant? Operates on
 * `tenant_allowed_domains` (login matching). Not to be confused with the
 * website-domain check domains-pg.isDomainRegistered (tenant_domains).
 */
export async function isDomainAvailable(domain: string): Promise<boolean> {
  const normalized = normalizeDomain(domain);
  const rows = await getDb()
    .select({ domain: tenantAllowedDomains.domain })
    .from(tenantAllowedDomains)
    .where(eq(tenantAllowedDomains.domain, normalized))
    .limit(1);
  return rows.length === 0;
}

export async function getTenantDomains(tenantId: string): Promise<string[]> {
  return domainsFor(tenantId);
}

export interface TenantStripeUpdate {
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  subscriptionStatus?: string;
  trialEndsAt?: Date | null;
}

export async function updateTenantStripe(
  tenantId: string,
  update: TenantStripeUpdate
): Promise<void> {
  const set: Partial<typeof tenants.$inferInsert> = { updatedAt: new Date() };
  if (update.stripeCustomerId !== undefined) set.stripeCustomerId = update.stripeCustomerId;
  if (update.stripeSubscriptionId !== undefined)
    set.stripeSubscriptionId = update.stripeSubscriptionId;
  if (update.subscriptionStatus !== undefined) set.subscriptionStatus = update.subscriptionStatus;
  if (update.trialEndsAt !== undefined) set.trialEndsAt = update.trialEndsAt;

  const res = await getDb().update(tenants).set(set).where(eq(tenants.tenantId, tenantId));
  if (res.rowCount === 0) throw new Error(`Tenant not found: ${tenantId}`);
}

export async function updateTenantDomains(tenantId: string, domains: string[]): Promise<void> {
  const normalized = Array.from(new Set(domains.map(normalizeDomain).filter(Boolean)));
  await getDb().transaction(async (tx) => {
    const exists = await tx
      .select({ tenantId: tenants.tenantId })
      .from(tenants)
      .where(eq(tenants.tenantId, tenantId))
      .limit(1);
    if (!exists[0]) throw new Error(`Tenant not found: ${tenantId}`);

    await tx.delete(tenantAllowedDomains).where(eq(tenantAllowedDomains.tenantId, tenantId));
    if (normalized.length > 0) {
      await tx
        .insert(tenantAllowedDomains)
        .values(normalized.map((domain) => ({ domain, tenantId })))
        .onConflictDoNothing();
    }
    await tx.update(tenants).set({ updatedAt: new Date() }).where(eq(tenants.tenantId, tenantId));
  });
}

// ---------------------------------------------------------------------------
// user-tenants.ts equivalents
// ---------------------------------------------------------------------------

export async function getUserMemberships(userId: string): Promise<MembershipWithTenant[]> {
  const rows = await getDb()
    .select({
      UserId: userTenants.userId,
      TenantId: userTenants.tenantId,
      Role: userTenants.role,
      JoinedAt: userTenants.joinedAt,
      InvitedBy: userTenants.invitedBy,
      UpdatedAt: userTenants.updatedAt,
      TenantName: tenants.name,
      TenantSlug: tenants.slug,
    })
    .from(userTenants)
    .leftJoin(tenants, eq(userTenants.tenantId, tenants.tenantId))
    .where(eq(userTenants.userId, userId))
    .orderBy(userTenants.joinedAt);

  return rows.map((r) => ({
    UserId: r.UserId,
    TenantId: r.TenantId,
    Role: r.Role as Role,
    JoinedAt: iso(r.JoinedAt),
    InvitedBy: r.InvitedBy ?? null,
    UpdatedAt: iso(r.UpdatedAt),
    TenantName: r.TenantName ?? undefined,
    TenantSlug: r.TenantSlug ?? undefined,
  }));
}

export async function isUserMemberOfTenant(userId: string, tenantId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ userId: userTenants.userId })
    .from(userTenants)
    .where(and(eq(userTenants.userId, userId), eq(userTenants.tenantId, tenantId)))
    .limit(1);
  return rows.length > 0;
}

export async function getUserRoleInTenant(userId: string, tenantId: string): Promise<Role | null> {
  const rows = await getDb()
    .select({ role: userTenants.role })
    .from(userTenants)
    .where(and(eq(userTenants.userId, userId), eq(userTenants.tenantId, tenantId)))
    .limit(1);
  return rows[0] ? (rows[0].role as Role) : null;
}

export async function addUserToTenant(
  userId: string,
  tenantId: string,
  role: Role,
  invitedBy?: string
): Promise<void> {
  await getDb()
    .insert(userTenants)
    .values({ userId, tenantId, role, invitedBy: invitedBy ?? null })
    .onConflictDoUpdate({
      target: [userTenants.userId, userTenants.tenantId],
      set: { role, invitedBy: invitedBy ?? null, updatedAt: new Date() },
    });
}

export async function removeUserFromTenant(userId: string, tenantId: string): Promise<void> {
  await getDb()
    .delete(userTenants)
    .where(and(eq(userTenants.userId, userId), eq(userTenants.tenantId, tenantId)));
}

export async function updateUserRoleInTenant(
  userId: string,
  tenantId: string,
  newRole: Role
): Promise<void> {
  await getDb()
    .update(userTenants)
    .set({ role: newRole, updatedAt: new Date() })
    .where(and(eq(userTenants.userId, userId), eq(userTenants.tenantId, tenantId)));
}

export async function getTenantMembers(
  tenantId: string
): Promise<(UserTenantMembership & { Email: string })[]> {
  const rows = await getDb()
    .select({
      UserId: userTenants.userId,
      TenantId: userTenants.tenantId,
      Role: userTenants.role,
      JoinedAt: userTenants.joinedAt,
      InvitedBy: userTenants.invitedBy,
      UpdatedAt: userTenants.updatedAt,
      Email: users.email,
    })
    .from(userTenants)
    .innerJoin(users, eq(userTenants.userId, users.userId))
    .where(eq(userTenants.tenantId, tenantId))
    .orderBy(sql`${userTenants.role} DESC`, users.email);

  return rows.map((r) => ({
    UserId: r.UserId,
    TenantId: r.TenantId,
    Role: r.Role as Role,
    JoinedAt: iso(r.JoinedAt),
    InvitedBy: r.InvitedBy ?? null,
    UpdatedAt: iso(r.UpdatedAt),
    Email: r.Email,
  }));
}

export async function getUserTenantIds(userId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ tenantId: userTenants.tenantId })
    .from(userTenants)
    .where(eq(userTenants.userId, userId));
  return rows.map((r) => r.tenantId);
}

// ---------------------------------------------------------------------------
// rbac.ts read equivalents
// ---------------------------------------------------------------------------

/** Batch-load domains for a set of tenants into a Map (avoids N+1 in list views). */
async function domainsForMany(tenantIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (tenantIds.length === 0) return map;
  const rows = await getDb()
    .select({ domain: tenantAllowedDomains.domain, tenantId: tenantAllowedDomains.tenantId })
    .from(tenantAllowedDomains)
    .where(inArray(tenantAllowedDomains.tenantId, tenantIds));
  for (const r of rows) {
    const list = map.get(r.tenantId) ?? [];
    list.push(r.domain);
    map.set(r.tenantId, list);
  }
  return map;
}

const orderTenantHierarchy = [sql`${tenants.parentTenantId} ASC NULLS FIRST`, tenants.name];

/** All tenants (superadmin list), ordered for hierarchy building. */
export async function listAllTenants(): Promise<Tenant[]> {
  const rows = await getDb()
    .select()
    .from(tenants)
    .orderBy(...orderTenantHierarchy);
  const domains = await domainsForMany(rows.map((r) => r.tenantId));
  return rows.map((r) => mapTenant(r, domains.get(r.tenantId) ?? []));
}

/** Tenants in scope: directly listed, or a child of a listed tenant. */
export async function listTenantsInScope(tenantIds: string[]): Promise<Tenant[]> {
  if (tenantIds.length === 0) return [];
  const rows = await getDb()
    .select()
    .from(tenants)
    .where(sql`${tenants.tenantId} IN ${tenantIds} OR ${tenants.parentTenantId} IN ${tenantIds}`)
    .orderBy(...orderTenantHierarchy);
  const domains = await domainsForMany(rows.map((r) => r.tenantId));
  return rows.map((r) => mapTenant(r, domains.get(r.tenantId) ?? []));
}

/** Users in the given tenants, with tenant name/slug, newest first. */
export async function listUsersInScope(tenantIds: string[]): Promise<UserWithTenant[]> {
  if (tenantIds.length === 0) return [];
  const rows = await getDb()
    .select({
      UserId: users.userId,
      Email: users.email,
      TenantId: users.tenantId,
      Role: users.role,
      CreatedAt: users.createdAt,
      UpdatedAt: users.updatedAt,
      TenantName: tenants.name,
      TenantSlug: tenants.slug,
    })
    .from(users)
    .leftJoin(tenants, eq(users.tenantId, tenants.tenantId))
    .where(inArray(users.tenantId, tenantIds))
    .orderBy(sql`${users.createdAt} DESC`);
  return rows.map((r) => ({
    UserId: r.UserId,
    Email: r.Email,
    TenantId: r.TenantId,
    Role: r.Role as Role,
    CreatedAt: iso(r.CreatedAt),
    UpdatedAt: iso(r.UpdatedAt),
    TenantName: r.TenantName ?? undefined,
    TenantSlug: r.TenantSlug ?? undefined,
  }));
}

export async function getAllTenantIds(): Promise<string[]> {
  const rows = await getDb().select({ tenantId: tenants.tenantId }).from(tenants);
  return rows.map((r) => r.tenantId);
}

export async function getChildTenantIds(parentTenantId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ tenantId: tenants.tenantId })
    .from(tenants)
    .where(eq(tenants.parentTenantId, parentTenantId));
  return rows.map((r) => r.tenantId);
}

export async function isChildTenant(tenantId: string, parentTenantId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ tenantId: tenants.tenantId })
    .from(tenants)
    .where(and(eq(tenants.tenantId, tenantId), eq(tenants.parentTenantId, parentTenantId)))
    .limit(1);
  return rows.length > 0;
}

/** rbac.getTenant — same as getTenantById; kept as a named alias for clarity. */
export async function getTenant(tenantId: string): Promise<Tenant | null> {
  return getTenantById(tenantId);
}

export async function getChildTenants(parentTenantId: string): Promise<Tenant[]> {
  const rows = await getDb()
    .select()
    .from(tenants)
    .where(eq(tenants.parentTenantId, parentTenantId))
    .orderBy(tenants.name);
  const out: Tenant[] = [];
  for (const row of rows) {
    out.push(mapTenant(row, await domainsFor(row.tenantId)));
  }
  return out;
}

// ---------------------------------------------------------------------------
// invites
// ---------------------------------------------------------------------------

export interface InviteWithTenant extends Invite {
  TenantName?: string;
}

function mapInvite(row: typeof invites.$inferSelect, tenantName?: string | null): InviteWithTenant {
  return {
    InviteId: row.inviteId,
    Email: row.email,
    TenantId: row.tenantId,
    Token: row.token,
    Role: row.role as Role,
    InvitedBy: row.invitedBy,
    ExpiresAt: iso(row.expiresAt),
    CreatedAt: iso(row.createdAt),
    AcceptedAt: isoOrNull(row.acceptedAt),
    ...(tenantName !== undefined ? { TenantName: tenantName ?? undefined } : {}),
  };
}

export async function getInviteByToken(token: string): Promise<InviteWithTenant | null> {
  const rows = await getDb()
    .select({ invite: invites, tenantName: tenants.name })
    .from(invites)
    .leftJoin(tenants, eq(invites.tenantId, tenants.tenantId))
    .where(eq(invites.token, token))
    .limit(1);
  return rows[0] ? mapInvite(rows[0].invite, rows[0].tenantName) : null;
}

export async function getPendingInvitesForTenants(
  tenantIds: string[]
): Promise<InviteWithTenant[]> {
  if (tenantIds.length === 0) return [];
  const rows = await getDb()
    .select({ invite: invites, tenantName: tenants.name })
    .from(invites)
    .leftJoin(tenants, eq(invites.tenantId, tenants.tenantId))
    .where(and(inArray(invites.tenantId, tenantIds), sql`${invites.acceptedAt} IS NULL`))
    .orderBy(sql`${invites.createdAt} DESC`);
  return rows.map((r) => mapInvite(r.invite, r.tenantName));
}

export async function getInviteById(inviteId: string): Promise<Invite | null> {
  const rows = await getDb().select().from(invites).where(eq(invites.inviteId, inviteId)).limit(1);
  return rows[0] ? mapInvite(rows[0]) : null;
}

/** Pending invites across the given tenants, with tenant name + inviter email for the admin list. */
export async function getPendingInvitesDetailed(
  tenantIds: string[]
): Promise<(InviteWithTenant & { InviterEmail?: string })[]> {
  if (tenantIds.length === 0) return [];
  const inviter = users; // invited_by references users.user_id
  const rows = await getDb()
    .select({ invite: invites, tenantName: tenants.name, inviterEmail: inviter.email })
    .from(invites)
    .leftJoin(tenants, eq(invites.tenantId, tenants.tenantId))
    .leftJoin(inviter, eq(invites.invitedBy, inviter.userId))
    .where(and(inArray(invites.tenantId, tenantIds), sql`${invites.acceptedAt} IS NULL`))
    .orderBy(sql`${invites.createdAt} DESC`);
  return rows.map((r) => ({
    ...mapInvite(r.invite, r.tenantName),
    InviterEmail: r.inviterEmail ?? undefined,
  }));
}

/** True if a still-valid pending invite already exists for (email, tenant). */
export async function hasPendingInvite(email: string, tenantId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ inviteId: invites.inviteId })
    .from(invites)
    .where(
      and(
        eq(invites.email, normalizeEmail(email)),
        eq(invites.tenantId, tenantId),
        sql`${invites.acceptedAt} IS NULL`,
        sql`${invites.expiresAt} > now()`
      )
    )
    .limit(1);
  return rows.length > 0;
}

export async function createInvite(invite: {
  inviteId: string;
  email: string;
  tenantId: string;
  token: string;
  role: Role;
  invitedBy: string;
  expiresAt: Date;
}): Promise<void> {
  await getDb()
    .insert(invites)
    .values({
      inviteId: invite.inviteId,
      email: normalizeEmail(invite.email),
      tenantId: invite.tenantId,
      token: invite.token,
      role: invite.role,
      invitedBy: invite.invitedBy,
      expiresAt: invite.expiresAt,
    });
}

export async function deleteInvite(inviteId: string): Promise<void> {
  await getDb().delete(invites).where(eq(invites.inviteId, inviteId));
}

/**
 * Accept an invite atomically: create the user and mark the invite accepted in a
 * single transaction. Returns the created user id, or a typed failure the route
 * maps to an HTTP response. The audit log stays in ClickHouse (append-only) and
 * is written by the caller outside this transaction.
 */
export type AcceptInviteResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'already_accepted' | 'expired' | 'user_exists' | 'not_found' };

export async function acceptInvite(token: string, userId: string): Promise<AcceptInviteResult> {
  return getDb().transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(invites)
      .where(eq(invites.token, token))
      .limit(1)
      .for('update');
    const invite = rows[0];
    if (!invite) return { ok: false, reason: 'not_found' as const };
    if (invite.acceptedAt) return { ok: false, reason: 'already_accepted' as const };
    if (invite.expiresAt < new Date()) return { ok: false, reason: 'expired' as const };

    const email = normalizeEmail(invite.email);
    const existing = await tx
      .select({ userId: users.userId })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing[0]) return { ok: false, reason: 'user_exists' as const };

    await tx.insert(users).values({ userId, email, tenantId: invite.tenantId, role: invite.role });
    await tx
      .update(invites)
      .set({ acceptedAt: new Date() })
      .where(eq(invites.inviteId, invite.inviteId));

    return { ok: true, userId };
  });
}

// ---------------------------------------------------------------------------
// users (global role / deletion for the members admin surface)
// ---------------------------------------------------------------------------

export async function updateUserRole(userId: string, newRole: Role): Promise<void> {
  await getDb()
    .update(users)
    .set({ role: newRole, updatedAt: new Date() })
    .where(eq(users.userId, userId));
}

export async function deleteUser(userId: string): Promise<void> {
  // user_tenants rows cascade via FK ON DELETE CASCADE.
  await getDb().delete(users).where(eq(users.userId, userId));
}
