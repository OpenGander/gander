"""
FastMCP server for OpenGander Analytics.

This server provides authenticated access to ClickHouse analytics data
via MCP tools. It supports:

- JWT authentication using web app session tokens (HS256)
- Multi-tenant data isolation
- Role-based access control
- Audit logging of all tool calls

Usage:
    # Run directly
    python -m opengander_mcp.server

    # Or via uvicorn
    uvicorn opengander_mcp.server:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import Any

from fastmcp import Context, FastMCP
from pydantic_settings import BaseSettings, SettingsConfigDict
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Mount, Route

from .db import close_client, get_client, ping
from .jwt_auth import JWTTokenVerifier, get_jwt_settings
from .scopes import SUPPORTED_SCOPES

# Configure logging
logging.basicConfig(
    level=os.environ.get("MCP_LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


class ServerSettings(BaseSettings):
    """Server configuration from environment."""

    model_config = SettingsConfigDict(env_prefix="", case_sensitive=False)

    mcp_log_level: str = "INFO"
    mcp_port: int = 8000
    env: str = "production"

    # OAuth 2.1 Protected Resource Metadata (RFC 9728)
    mcp_resource_uri: str = "https://mcp.opengander.io"
    authorization_server_uri: str = "https://app.opengander.io"


# Global settings instance for use by endpoints
_settings: ServerSettings | None = None


def get_server_settings() -> ServerSettings:
    """Get or create the server settings singleton."""
    global _settings
    if _settings is None:
        _settings = ServerSettings()
    return _settings


# =============================================================================
# OAuth Protected Resource Metadata (RFC 9728)
# =============================================================================


async def protected_resource_metadata_endpoint(request: Request) -> JSONResponse:
    """
    Return OAuth 2.1 Protected Resource Metadata per RFC 9728.

    This endpoint allows MCP clients to discover:
    - The resource identifier
    - Which authorization servers can issue tokens for this resource
    - What scopes are supported
    - How to present bearer tokens

    MCP clients should:
    1. Get 401 with WWW-Authenticate containing resource_metadata URL
    2. Fetch this endpoint to discover authorization_servers
    3. Fetch authorization server metadata from those servers
    4. Start OAuth flow with the authorization server
    """
    settings = get_server_settings()

    return JSONResponse({
        "resource": settings.mcp_resource_uri,
        "authorization_servers": [settings.authorization_server_uri],
        "scopes_supported": list(SUPPORTED_SCOPES),
        "bearer_methods_supported": ["header"],
    })


# =============================================================================
# Auth Info Endpoint
# =============================================================================


async def auth_info_endpoint(request: Request) -> JSONResponse:
    """
    Return authentication information for MCP clients.

    This endpoint tells clients:
    - What authentication method to use (Bearer JWT)
    - What scopes are supported
    """
    return JSONResponse({
        "auth_method": "bearer_jwt",
        "token_source": "web_app_session",
        "scopes_supported": list(SUPPORTED_SCOPES),
        "bearer_methods_supported": ["header"],
    })


# =============================================================================
# WWW-Authenticate Middleware
# =============================================================================


class AuthErrorMiddleware(BaseHTTPMiddleware):
    """
    Middleware to add WWW-Authenticate header on 401 responses.

    Per OAuth 2.0 Bearer Token Usage (RFC 6750) and RFC 9728,
    401 responses MUST include a WWW-Authenticate header.

    We include resource_metadata URL to enable OAuth 2.1 discovery:
    - Client gets 401 with WWW-Authenticate containing resource_metadata URL
    - Client fetches /.well-known/oauth-protected-resource
    - Client discovers authorization_servers from the metadata
    - Client fetches authorization server metadata and starts OAuth flow
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)

        if response.status_code == 401:
            # Build WWW-Authenticate header per RFC 9728
            # Include resource_metadata URL for OAuth 2.1 discovery
            settings = get_server_settings()
            resource_metadata_url = (
                f"{settings.mcp_resource_uri}/.well-known/oauth-protected-resource"
            )
            www_auth = f'Bearer resource_metadata="{resource_metadata_url}"'
            response.headers["WWW-Authenticate"] = www_auth

        return response


# =============================================================================
# Application Lifespan
# =============================================================================


@asynccontextmanager
async def lifespan(app: FastMCP):
    """Application lifespan handler for startup/shutdown."""
    # Startup
    logger.info("Starting OpenGander MCP Server...")

    # Verify JWT configuration
    jwt_settings = get_jwt_settings()
    if not jwt_settings.jwt_secret:
        logger.warning("JWT_SECRET not configured - authentication will fail")
    else:
        logger.info("JWT authentication configured (HS256)")

    # Initialize ClickHouse connection
    try:
        await get_client()
        if await ping():
            logger.info("ClickHouse connection verified")
        else:
            logger.warning("ClickHouse connection failed - server may not work correctly")
    except Exception as e:
        logger.error("Failed to connect to ClickHouse: %s", e)

    yield

    # Shutdown
    logger.info("Shutting down OpenGander MCP Server...")
    await close_client()


# =============================================================================
# FastMCP Application
# =============================================================================

# Create the FastMCP app with JWT authentication and lifespan
mcp = FastMCP(
    "OpenGander Analytics",
    auth=JWTTokenVerifier(),
    lifespan=lifespan,
)


# =============================================================================
# Health Check Endpoints
# =============================================================================


async def health_endpoint(request: Request) -> JSONResponse:
    """
    Unauthenticated HTTP health check endpoint for ALB/load balancers.

    This is a simple HTTP endpoint that doesn't require authentication,
    suitable for ALB health checks, Kubernetes probes, etc.
    """
    ch_healthy = await ping()

    status_code = 200 if ch_healthy else 503

    return JSONResponse(
        {
            "status": "healthy" if ch_healthy else "degraded",
            "clickhouse": "connected" if ch_healthy else "disconnected",
            "version": "0.1.0",
        },
        status_code=status_code,
    )


@mcp.tool()
async def health_check(ctx: Context) -> dict[str, Any]:
    """
    Check the health of the MCP server and its dependencies.

    This is an authenticated MCP tool for clients that want to verify
    connectivity. For unauthenticated health checks (ALB, K8s probes),
    use the /health HTTP endpoint instead.

    Returns:
        Health status including ClickHouse connection status
    """
    ch_healthy = await ping()

    return {
        "status": "healthy" if ch_healthy else "degraded",
        "clickhouse": "connected" if ch_healthy else "disconnected",
        "version": "0.1.0",
    }


# =============================================================================
# Register MCP Tools
# =============================================================================
# Tools are implemented in the tools/ module and registered here.
# Import must happen after mcp is created to avoid circular imports.

from .tools.analytics import get_overview  # noqa: E402
from .tools.errors import get_errors, get_user_journey  # noqa: E402
from .tools.pages import get_page_views, get_top_pages, get_web_vitals  # noqa: E402
from .tools.schema import describe_table, list_tables  # noqa: E402
from .tools.traffic import get_campaigns, get_traffic_sources  # noqa: E402

# Schema discovery tools (no tenant filter - metadata only)
mcp.tool()(list_tables)
mcp.tool()(describe_table)

# Analytics overview
mcp.tool()(get_overview)

# Page performance tools
mcp.tool()(get_page_views)
mcp.tool()(get_top_pages)
mcp.tool()(get_web_vitals)

# Traffic source tools
mcp.tool()(get_traffic_sources)
mcp.tool()(get_campaigns)

# Error and journey tools
mcp.tool()(get_errors)
mcp.tool()(get_user_journey)


# =============================================================================
# App Factory and Main Entry Point
# =============================================================================


def create_app() -> FastMCP:
    """Create and configure the FastMCP application."""
    return mcp


# Expose the ASGI app for uvicorn
# Wrap the MCP app with unauthenticated endpoints and middleware
_mcp_app = mcp.http_app(stateless_http=True)

app = Starlette(
    routes=[
        Route("/health", health_endpoint, methods=["GET"]),
        Route("/auth-info", auth_info_endpoint, methods=["GET"]),
        Route(
            "/.well-known/oauth-protected-resource",
            protected_resource_metadata_endpoint,
            methods=["GET"],
        ),
        Mount("/", app=_mcp_app),
    ],
    middleware=[
        Middleware(AuthErrorMiddleware),
    ],
    # Pass FastMCP's lifespan to initialize the StreamableHTTPSessionManager
    lifespan=_mcp_app.lifespan,
)


def main() -> None:
    """Main entry point for running the server directly."""
    import uvicorn

    settings = ServerSettings()

    # Set log level
    logging.getLogger().setLevel(settings.mcp_log_level.upper())

    logger.info("Starting OpenGander MCP Server on port %d", settings.mcp_port)

    uvicorn.run(
        "opengander_mcp.server:app",
        host="0.0.0.0",
        port=settings.mcp_port,
        log_level=settings.mcp_log_level.lower(),
        reload=settings.env == "development",
    )


if __name__ == "__main__":
    main()
