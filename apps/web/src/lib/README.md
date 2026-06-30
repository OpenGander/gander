# lib

Shared utilities, business logic, and the data layer for the OpenGander web application. This is the "backend" of the Next.js app -- business logic lives here, not in API routes.

## Contents

- **Data layer:**
  - `clickhouse.ts` - ClickHouse client singleton (connection pooling, query execution)
  - `queries/` - All ClickHouse query builders, one file per domain (see `queries/README.md`)
  - `query-compiler/` - Query builder SQL compilation (compile, validate, schema registry)
  - `query-cache.ts` - Query result caching
  - `query-builder.ts` - Query builder type definitions and helpers
  - `aggregations.ts` - Shared aggregation helpers for analytics queries
- **Auth and access control:**
  - `auth.ts` - JWT session management (getSession, createSession, magic link tokens)
  - `auth.test.ts` - Auth unit tests
  - `rbac.ts` - Role-based access control (requireRole, canAssignRole, getTenantScope, canAccessTenant)
  - `oauth/` - OAuth 2.1 provider implementation
    - `clients.ts` / `dynamic-clients.ts` - Client registration and management
    - `codes.ts` - Authorization code grant
    - `pkce.ts` - PKCE challenge verification
    - `refresh-tokens.ts` - Refresh token management
    - `revocation.ts` - Token revocation
    - `authorization-server-metadata.test.ts` / `authorize.test.ts` / etc. - OAuth test suite
  - `keys.ts` - JWKS key management for MCP auth
  - `keys.test.ts` - Key management tests
- **Infrastructure:**
  - `email.ts` - Transactional email with pluggable providers (mock, SES, Mailgun)
  - `email.test.ts` - Email provider tests
  - `audit.ts` - Audit logging to ClickHouse (logAudit, queryAuditLogs)
  - `rate-limit.ts` - API rate limiting (in-memory, per-IP)
  - `logger.ts` - Pino structured logging (JSON in production, pretty in dev)
  - `dns-verify.ts` - Domain ownership verification via DNS TXT records
- **Utilities:**
  - `api-utils.ts` - API response helpers
  - `snippet.ts` - SDK snippet generation for onboarding
  - `utils.ts` - General utility functions
  - `utils/` - Utility modules
    - `comparison.ts` - Period-over-period comparison logic
    - `email.ts` - Email validation and formatting
    - `ids.ts` - ID generation utilities
  - `types/` - Shared TypeScript types
    - `user-management.ts` - User and tenant type definitions

## Key Patterns

**API routes are thin wrappers.** The pattern across the entire app is: API route validates input, checks auth, calls a function from `lib/`, returns the response. If you find business logic in an API route, it should be moved here. This keeps logic testable and reusable.

**Parameterized queries only.** Every ClickHouse query uses `clickhouse.query()` with parameter binding -- never string interpolation. This is a hard rule for SQL injection prevention. See `queries/README.md` for the full pattern.

**Email provider abstraction.** `email.ts` exports a `sendEmail()` function that dispatches to mock (logs to console), AWS SES, or Mailgun based on the `EMAIL_PROVIDER` environment variable. Adding a new provider means implementing the `EmailProvider` interface.

## Decisions

- **lib/ is the backend.** In a Next.js app, there is no separate backend service. `lib/` serves that role. API routes are the HTTP layer; `lib/` is the business logic and data access layer. This separation makes it possible to test business logic without HTTP, and to reuse logic across routes.
- **Query builders over ORM.** ClickHouse's SQL dialect (FINAL, array functions, materialized view targeting) is different enough from Postgres that ORMs add friction rather than value. Raw parameterized SQL gives full control. Each query file in `queries/` maps to a dashboard page or feature area.
- **OAuth is a full implementation.** The `oauth/` directory implements OAuth 2.1 with PKCE, dynamic client registration, refresh tokens, and revocation. This exists to support MCP server authentication -- AI assistants authenticate via OAuth rather than static API keys.
- **In-memory rate limiting.** `rate-limit.ts` uses in-memory storage, which means limits reset on deploy and don't share across instances. This is fine for single-instance deployment but will need Redis or similar for horizontal scaling.

## Related

- `../../app/api/` - API routes that call into lib/ functions
- `../../components/` - React components that consume data fetched via these utilities
- `../../../services/token-service/` - Separate service for telemetry JWT tokens (not part of this lib)
