# API Routes

Next.js App Router API routes that form the backend of the OpenGander web application.

## Contents

- `analytics/` - All analytics data endpoints
  - `overview/` - Dashboard summary stats (visitors, pageviews, sessions)
  - `page-views/` - Page view time series
  - `top-pages/` - Most visited pages
  - `page-details/` - Single page deep-dive metrics
  - `web-vitals/` - Core Web Vitals (LCP, FID, CLS, TTFB, INP)
  - `traffic-sources/` - Source/medium breakdown
  - `traffic-validation/` - Cross-source validation and discrepancies
  - `campaigns/` - Campaign performance
  - `funnel/` - Conversion funnel analysis (+ preaggregated, segments, sources sub-routes)
  - `user-journey/` - Journey analysis (paths, sankey, sessions, time-on-page)
  - `errors/` - Error counts and types
  - `entry-points/` - Entry point analysis
  - `visitors/` - Visitor metrics (new-vs-returning)
  - `sitemap/` - Sitemap bubble chart data
- `auth/` - Authentication flow
  - `send-magic-link/` - Send passwordless login email
  - `verify/` - Validate magic link token and create session
  - `signout/` - Destroy session
  - `dev-login/` - Development-only login bypass
- `oauth/` - OAuth 2.1 provider endpoints
  - `authorize/` - Authorization endpoint
  - `token/` - Token exchange
  - `register/` - Dynamic client registration
  - `revoke/` - Token revocation
- `audit-logs/` - Query audit trail (admin+)
- `health/` - Health check for load balancers
- `impersonate/` - Superadmin user impersonation (start/end)
- `invites/` - User invitation management (create, accept, delete by ID)
- `mcp-keys/` - MCP API key management (CRUD, by key ID)
- `me/` - Current user profile
- `onboarding/` - New tenant setup (checkout, domains, snippet)
- `query/` - Query builder endpoints (execute, save, list, schema, results by ID)
- `settings/` - Organization settings (domains, services, snippet)
- `tenant-switch/` - Switch active tenant context
- `tenants/` - Tenant management
- `users/` - User management (list, update by ID)
- `waitlist/` - Marketing waitlist signups
- `webhooks/` - Inbound webhook receivers
  - `stripe/` - Stripe webhook receiver (see below)

## Webhooks

### Stripe (`POST /api/webhooks/stripe`)

Public endpoint. Not auth-gated — Stripe authenticates itself via the `stripe-signature` header, verified with the webhook signing secret.

**Flow:** verify signature → insert raw event into ClickHouse `opengander.stripe_events` → apply legacy inline tenant-billing updates → return 200. Downstream consumers (TigerBeetle ledger, subscription state machines, future Solana settlement) read from `stripe_events`, not from Stripe directly.

**Secrets.** Signing secret, API secret key, and publishable key are loaded from `STRIPE_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` env vars. In AWS, these are projected from Secrets Manager (`opengander/stripe/live` for production, `opengander/stripe/test` elsewhere) via the CDK task def; JSON fields are `webhook-signing-secret`, `secret-key`, `publishable-key`.

**Local testing with the Stripe CLI:**

```bash
# One-time: pull test API keys from AWS into apps/web/.env.local
npm run stripe:env   # from repo root; needs aws + jq

# Terminal 1: web app
cd apps/web && npm run dev

# Terminal 2: Stripe CLI — prints a whsec_... secret on startup
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# Paste the whsec_... into apps/web/.env.local as STRIPE_WEBHOOK_SECRET,
# then restart the dev server.

# Terminal 3: fire a test event
stripe trigger payment_intent.succeeded
```

`npm run stripe:env` writes `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` from the `opengander/stripe/test` AWS secret. It deliberately does not write `STRIPE_WEBHOOK_SECRET` — the value from `stripe listen` is different from the one in AWS and must be used when forwarding via the CLI.

**Adding a new event type.** The handler is allowlist-free — any Stripe event is verified, stored in `stripe_events`, and returned with 200. Add handling downstream by consuming `stripe_events` (filtered by `event_type`). The inline `applyLegacyTenantUpdates` switch in `route.ts` is temporary — add new event types to downstream consumers, not to that switch. The inline block goes away when the `stripe_events` consumer ships.

**Idempotency.** `event.id` is the dedup key. `stripe_events` is a `ReplacingMergeTree` keyed loosely by `(received_at, event_id)` — consumers should dedupe by `event_id` (`argMax` by `received_at`, or `SELECT FINAL`). The handler itself does not dedupe.

## Key Patterns

**Every route checks auth.** Routes call `getSession()` from `lib/auth.ts` as the first thing. Unauthenticated requests get a 401. Role checks use `requireRole()` from `lib/rbac.ts`. The only exceptions are `health/`, `waitlist/`, `auth/send-magic-link`, `auth/verify`, and `oauth/` endpoints.

**Routes are thin wrappers.** The pattern is: validate input, check auth/permissions, call a query builder from `lib/queries/`, return the response. Business logic and SQL live in `lib/`, not here. If you find yourself writing SQL in a route file, move it to `lib/queries/`.

**Tenant scoping is automatic.** After auth, `getTenantScope(session)` returns the tenant IDs the user can access. Analytics routes pass this scope to query builders. Superadmins with impersonation see the impersonated tenant's data.

## Decisions

- **App Router conventions.** Each endpoint is a `route.ts` file in a directory matching the URL path. This is Next.js 15 App Router's file-based routing. Dynamic segments use `[param]` directories (e.g., `invites/[inviteId]/route.ts`).
- **Analytics sub-routes mirror dashboard tabs.** Each analytics endpoint maps to a dashboard component. The URL structure (`/api/analytics/web-vitals`, `/api/analytics/top-pages`) mirrors the dashboard navigation so the mapping is obvious.
- **OAuth endpoints are separate from session auth.** The `oauth/` routes implement OAuth 2.1 with PKCE for MCP server authentication. These are a different auth flow from the magic link session auth used by the dashboard.

## Related

- `../../../lib/auth.ts` - Session management (getSession, createSession)
- `../../../lib/rbac.ts` - Role-based access control (requireRole, canAccessTenant)
- `../../../lib/queries/` - All ClickHouse query builders (never inline SQL here)
- `../../../lib/audit.ts` - Audit logging for sensitive actions
- `../../(app)/` - Dashboard pages that consume these API routes
