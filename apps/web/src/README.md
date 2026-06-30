# apps/web/src

Source code for the OpenGander web application — the primary frontend for the platform.

## Contents

- `app/` - Next.js App Router pages and API routes
- `components/` - React components organized by feature area
- `lib/` - Shared utilities, database queries, auth, and business logic
- `hooks/` - Custom React hooks (SWR data fetching, UI state)
- `contexts/` - React context providers (tenant, session)
- `types/` - TypeScript type definitions
- `middleware.ts` - Next.js middleware (auth session validation, redirects)

## Key Patterns

**Server vs Client:** Default to server components. Use `'use client'` only when you need browser APIs, hooks, or interactivity. API routes are all server-side.

**Data flow:** API routes (`app/api/`) call query functions (`lib/queries/`) which use the ClickHouse client (`lib/clickhouse.ts`). Client components fetch from API routes via SWR hooks (`hooks/`).

**Auth:** Every API route and protected page checks the session via `lib/auth.ts`. The middleware handles redirects for unauthenticated users.

## Decisions

- **Next.js App Router over Pages Router:** Adopted when starting the project on Next.js 15. Server components reduce client bundle size for an analytics-heavy app where most pages are read-only data display.
- **SWR over React Query:** Lighter weight, good enough for the read-heavy dashboard pattern. Most data is fetched once per page load with time-based revalidation.
- **API routes as the data layer:** ClickHouse queries go through API routes rather than server components directly. This keeps the query logic testable, cacheable, and reusable across pages.
- **shadcn/ui over a component library:** Copy-paste components we own and can modify. No version-lock to an upstream library's opinions.

## Related

- `../../CLAUDE.md` - Project-wide patterns and rules
- `lib/queries/` - All ClickHouse query builders (never inline SQL in API routes)
- `components/ui/` - shadcn/ui primitives (don't reinvent these)
