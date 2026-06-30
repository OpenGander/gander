# MCP Server

Model Context Protocol server that gives Claude, Cursor, and other AI assistants tools to query OpenGander analytics data from ClickHouse.

## Running

```bash
cd services/mcp-server
uv venv && source .venv/bin/activate
uv pip install -e .
opengander-mcp                    # stdio mode for Claude Desktop / Claude Code
# or: uvicorn opengander_mcp.server:app --port 8000   # HTTP mode
```

## Contents

- `src/opengander_mcp/server.py` - FastMCP server entry point and configuration
- `src/opengander_mcp/tools/` - MCP tool implementations (one file per domain)
  - `analytics.py` - Overview stats, page views, web vitals
  - `pages.py` - Top pages and page engagement
  - `traffic.py` - Traffic sources, campaigns, user journeys
  - `errors.py` - Error counts and types
  - `schema.py` - Table listing and column descriptions
  - `_common.py` - Shared query helpers
- `src/opengander_mcp/db.py` - ClickHouse client connection
- `src/opengander_mcp/auth.py` - Authentication logic
- `src/opengander_mcp/jwt_auth.py` - JWT token validation
- `src/opengander_mcp/jwks.py` - JWKS key fetching and caching
- `src/opengander_mcp/scopes.py` - OAuth scope definitions
- `src/opengander_mcp/tenant.py` - Multi-tenant context
- `src/opengander_mcp/audit.py` - Audit logging for MCP queries
- `src/opengander_mcp/revocation.py` - Token revocation checking
- `tests/` - pytest test suite (auth, JWKS, scopes, revocation, integration)
- `promptfoo/` - Prompt evaluation configs
- `pyproject.toml` - Python project config (hatchling build, ruff, mypy, pytest)

## Available Tools (11)

| Tool                  | Purpose                                                |
| --------------------- | ------------------------------------------------------ |
| `health_check`        | Server and ClickHouse connectivity check               |
| `list_tables`         | Tables and materialized views with row counts          |
| `describe_table`      | Column definitions for a specific table                |
| `get_overview`        | Dashboard stats (visitors, pageviews, load time)       |
| `get_page_views`      | Time series with hourly/daily aggregation              |
| `get_top_pages`       | Most visited pages with engagement metrics             |
| `get_web_vitals`      | Core Web Vitals percentiles (LCP, FID, CLS, TTFB, INP) |
| `get_traffic_sources` | Source/medium breakdown                                |
| `get_campaigns`       | Campaign performance metrics                           |
| `get_errors`          | Error counts and types over time                       |
| `get_user_journey`    | User session paths and sequences                       |

## Key Patterns

Tools are organized by domain in `src/opengander_mcp/tools/`, one file per area (analytics, pages, traffic, errors, schema). Shared helpers like date range parsing and result formatting live in `_common.py`. All tools query ClickHouse via the `db.py` client with parameterized queries.

Authentication uses OAuth 2.1 with PKCE via JWT tokens. The server validates tokens using JWKS (JSON Web Key Sets) with caching, checks scopes for authorization, and logs all queries to the audit trail. Token revocation is checked on every request.

## Decisions

- **Python with FastMCP.** MCP servers are typically Python (the reference SDK is Python). FastMCP provides the MCP protocol handling, letting us focus on tool implementations. Uses `uv` for dependency management.
- **OAuth 2.1 over static API keys.** The MCP server supports proper OAuth authentication with PKCE, scopes, and token revocation. This integrates with the web app's auth system rather than requiring separate credentials.
- **Tools mirror dashboard pages.** The 11 tools map to the same data the dashboard shows. If someone can see it in the UI, they can query it via MCP. The tool names and parameters intentionally match the API routes.

## Related

- `../../apps/web/src/app/api/analytics/` - Web API routes that serve the same data
- `../../apps/web/src/lib/queries/` - ClickHouse query builders (similar SQL patterns)
- `../../apps/web/src/app/api/mcp-keys/` - API key management UI for MCP access
