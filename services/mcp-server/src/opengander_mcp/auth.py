"""
Authentication context for the MCP server.

Provides the OAuthContext dataclass used by tools to enforce tenant isolation
and scope checks. The actual token verification is handled by JWTTokenVerifier
in jwt_auth.py.

Note: The class is still named OAuthContext for backward compatibility with
existing tool implementations.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from fastmcp.server.dependencies import get_access_token

from .scopes import get_required_scope, has_scope
from .tenant import Role

logger = logging.getLogger(__name__)


@dataclass
class OAuthContext:
    """
    Authenticated context from a valid session JWT.

    This context is attached to the MCP request and used by tools
    to enforce tenant isolation, scope checks, and audit logging.

    Note: Named OAuthContext for backward compatibility with existing tools.
    """

    subject: str  # User ID (same as user_id for session tokens)
    user_id: str  # OpenGander user ID
    email: str
    home_tenant_id: str
    role: Role
    allowed_tenant_ids: list[str]
    scopes: list[str]  # MCP scopes granted to this session

    def can_use_tool(self, tool_name: str) -> bool:
        """
        Check if the OAuth token has the required scope for a tool.

        Args:
            tool_name: Name of the MCP tool

        Returns:
            True if the scope is granted
        """
        required_scope = get_required_scope(tool_name)
        if required_scope is None:
            # Unknown tool - deny by default
            logger.warning("Unknown tool requested: %s", tool_name)
            return False
        return has_scope(self.scopes, required_scope)

    def can_access_tenant(self, tenant_id: str) -> bool:
        """Check if this context allows access to a specific tenant."""
        return tenant_id in self.allowed_tenant_ids

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "subject": self.subject,
            "user_id": self.user_id,
            "email": self.email,
            "home_tenant_id": self.home_tenant_id,
            "role": self.role,
            "allowed_tenant_ids": self.allowed_tenant_ids,
            "scopes": self.scopes,
        }


def get_auth_context(ctx: Any) -> OAuthContext:
    """
    Extract the OAuthContext from a FastMCP Context.

    Args:
        ctx: The FastMCP Context object (unused but kept for API compatibility)

    Returns:
        The authenticated OAuthContext

    Raises:
        ValueError: If no authentication context is present
    """
    # Use FastMCP's dependency injection to get the access token
    # This retrieves it from the HTTP request scope or context var
    access_token = get_access_token()
    if access_token is None:
        raise ValueError("No authentication context found - missing access_token")

    # Extract claims from AccessToken
    claims = getattr(access_token, "claims", {})
    oauth_context_data = claims.get("oauth_context")

    if not oauth_context_data:
        raise ValueError("No oauth_context found in access token claims")

    # Reconstruct OAuthContext from claims
    return OAuthContext(
        subject=oauth_context_data.get("subject", ""),
        user_id=oauth_context_data.get("user_id", ""),
        email=oauth_context_data.get("email", ""),
        home_tenant_id=oauth_context_data.get("home_tenant_id", ""),
        role=oauth_context_data.get("role", "user"),
        allowed_tenant_ids=oauth_context_data.get("allowed_tenant_ids", []),
        scopes=oauth_context_data.get("scopes", []),
    )
