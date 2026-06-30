/**
 * Drizzle schema for the application/OLTP layer (Postgres).
 *
 * Phase A — identity core. These tables replace the ClickHouse
 * ReplacingMergeTree equivalents (tenants, users, user_tenants, invites) and
 * normalize tenants.AllowedDomains[] into tenant_allowed_domains so that domain
 * lookups become unique-index hits instead of full-scan array membership.
 *
 * Column values are stored snake_case in Postgres; the query layer maps rows
 * back to the existing PascalCase TypeScript shapes (User, Tenant, …) so call
 * sites are unchanged.
 *
 * Analytics/telemetry tables stay in ClickHouse and are NOT modeled here.
 */
import {
  pgTable,
  text,
  timestamp,
  boolean,
  primaryKey,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
  tenantId: text('tenant_id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  // Self-referential agency → client hierarchy. ON DELETE SET NULL so removing
  // a parent doesn't cascade-delete its clients.
  parentTenantId: text('parent_tenant_id').references((): AnyPgColumn => tenants.tenantId, {
    onDelete: 'set null',
  }),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  subscriptionStatus: text('subscription_status').notNull().default('none'),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  'users',
  {
    userId: text('user_id').primaryKey(),
    // Emails are normalized to lowercase by normalizeEmail() before any write or
    // lookup, so a plain unique constraint enforces one account per address
    // without needing the citext extension.
    email: text('email').notNull().unique(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.tenantId),
    role: text('role').notNull().default('user'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('idx_users_tenant').on(t.tenantId),
  })
);

export const userTenants = pgTable(
  'user_tenants',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.tenantId, { onDelete: 'cascade' }),
    role: text('role').notNull().default('user'),
    // invited_by is intentionally NOT a foreign key: it may reference a user
    // that no longer exists, or be null for system-created memberships.
    invitedBy: text('invited_by'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.tenantId] }),
    tenantIdx: index('idx_user_tenants_tenant').on(t.tenantId),
  })
);

export const invites = pgTable(
  'invites',
  {
    inviteId: text('invite_id').primaryKey(),
    email: text('email').notNull(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.tenantId, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    role: text('role').notNull().default('user'),
    invitedBy: text('invited_by').notNull().default(''),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  },
  (t) => ({
    emailIdx: index('idx_invites_email').on(t.email),
    tenantIdx: index('idx_invites_tenant').on(t.tenantId),
  })
);

/**
 * Normalized email domains that map an email domain to its owning tenant.
 * Replaces tenants.AllowedDomains[] (a ClickHouse Array(String)). The domain is
 * the primary key, so it is globally unique — that single constraint enforces
 * "a domain belongs to at most one tenant" and turns getTenantByDomain /
 * isDomainAvailable into index lookups.
 */
export const tenantAllowedDomains = pgTable(
  'tenant_allowed_domains',
  {
    domain: text('domain').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.tenantId, { onDelete: 'cascade' }),
  },
  (t) => ({
    tenantIdx: index('idx_tenant_allowed_domains_tenant').on(t.tenantId),
  })
);

// ===========================================================================
// Phase B — auth/security (OAuth 2.1 + MCP API keys)
//
// These replace the ClickHouse ReplacingMergeTree tables where the lack of real
// UPDATE/transactions is most dangerous: single-use codes, refresh-token
// rotation + family theft detection, and key revocation. Booleans replace the
// UInt8 0/1 flags; the query layer maps them back to 0/1 in record shapes.
// ===========================================================================

export const oauthClients = pgTable(
  'oauth_clients',
  {
    clientId: text('client_id').primaryKey(),
    clientName: text('client_name').notNull().default(''),
    clientUri: text('client_uri').notNull().default(''),
    redirectUris: text('redirect_uris').array().notNull(),
    grantTypes: text('grant_types').array().notNull(),
    responseTypes: text('response_types').array().notNull(),
    scope: text('scope').notNull().default(''),
    tokenEndpointAuthMethod: text('token_endpoint_auth_method').notNull().default('none'),
    softwareId: text('software_id').notNull().default(''),
    softwareVersion: text('software_version').notNull().default(''),
    clientIdIssuedAt: timestamp('client_id_issued_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    isActive: boolean('is_active').notNull().default(true),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    activeIdx: index('idx_oauth_clients_active').on(t.isActive),
  })
);

export const oauthAuthorizationCodes = pgTable('oauth_authorization_codes', {
  code: text('code').primaryKey(),
  clientId: text('client_id').notNull(),
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  codeChallengeMethod: text('code_challenge_method').notNull(),
  userId: text('user_id').notNull(),
  tenantId: text('tenant_id').notNull(),
  scope: text('scope').notNull(),
  resource: text('resource').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  used: boolean('used').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const oauthRefreshTokens = pgTable(
  'oauth_refresh_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    familyId: text('family_id').notNull(),
    userId: text('user_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    clientId: text('client_id').notNull(),
    scope: text('scope').notNull(),
    resource: text('resource').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    rotated: boolean('rotated').notNull().default(false),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    revoked: boolean('revoked').notNull().default(false),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    familyIdx: index('idx_oauth_refresh_family').on(t.familyId),
    userClientIdx: index('idx_oauth_refresh_user_client').on(t.userId, t.clientId),
  })
);

export const oauthRevokedTokens = pgTable('oauth_revoked_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }).notNull().defaultNow(),
  revokedBy: text('revoked_by').notNull(),
  reason: text('reason').notNull().default(''),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const apiKeys = pgTable(
  'api_keys',
  {
    keyId: text('key_id').primaryKey(),
    keyHash: text('key_hash').notNull().unique(),
    keyPrefix: text('key_prefix').notNull(),
    name: text('name').notNull(),
    userId: text('user_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    role: text('role').notNull(),
    allowedTenants: text('allowed_tenants').array().notNull(),
    allowedTools: text('allowed_tools').array().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_api_keys_user').on(t.userId),
  })
);

// ===========================================================================
// Phase C — config & misc
//
// Mutable per-tenant config plus the waitlist and the Stripe webhook event log.
// tenant_id is left as plain text (no FK to tenants) so these slices can be cut
// over independently of USE_PG_IDENTITY. stripe_events gains a real UNIQUE
// event_id (its primary key) — genuine webhook idempotency the ClickHouse
// ReplacingMergeTree only approximated.
// ===========================================================================

/**
 * Website domains a tenant has registered for telemetry collection, with DNS
 * verification status. NOT the same as `tenant_allowed_domains` above:
 *   - tenant_allowed_domains — email domains; `domain` is a globally-unique PK;
 *     used for login email→tenant matching (identity-pg.isDomainAvailable).
 *   - tenant_domains (this) — website hostnames; `domain` is only indexed
 *     (non-unique: a host can be re-added after removal, history kept by
 *     domain_id); used for SDK/collector origin checks
 *     (domains-pg.isDomainRegistered).
 * A cold reader should confirm which concept they are in before reusing either.
 */
export const tenantDomains = pgTable(
  'tenant_domains',
  {
    domainId: text('domain_id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    domain: text('domain').notNull(),
    displayName: text('display_name').notNull().default(''),
    verified: boolean('verified').notNull().default(false),
    verificationToken: text('verification_token').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('idx_tenant_domains_tenant').on(t.tenantId),
    domainIdx: index('idx_tenant_domains_domain').on(t.domain),
  })
);

export const serviceMappings = pgTable(
  'service_mappings',
  {
    tenantId: text('tenant_id').notNull(),
    serviceName: text('service_name').notNull(),
    displayName: text('display_name').notNull().default(''),
    status: text('status').notNull().default('stub'),
    platform: text('platform').notNull().default(''),
    createdBy: text('created_by').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.serviceName] }),
  })
);

export const waitlist = pgTable('waitlist', {
  waitlistId: text('waitlist_id').primaryKey(),
  email: text('email').notNull().unique(),
  company: text('company'),
  magicLink: text('magic_link').notNull().default(''),
  token: text('token').notNull().default(''),
  source: text('source').notNull().default('signup'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
});

export const stripeEvents = pgTable(
  'stripe_events',
  {
    eventId: text('event_id').primaryKey(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    eventType: text('event_type').notNull(),
    livemode: boolean('livemode').notNull().default(false),
    apiVersion: text('api_version').notNull().default(''),
    stripeEvent: text('stripe_event').notNull(),
  },
  (t) => ({
    typeIdx: index('idx_stripe_events_type').on(t.eventType),
  })
);
