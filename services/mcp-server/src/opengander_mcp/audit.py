"""
Audit logging for MCP tool invocations and authentication events.

Logs all tool calls to the mcp_audit_logs table for:
- Security monitoring and compliance
- Usage analytics and rate limiting
- Debugging and troubleshooting

Also logs failed authentication attempts for security monitoring.
Every tool invocation is logged with timing, parameters, and results.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from .db import insert_rows

if TYPE_CHECKING:
    from .auth import OAuthContext

logger = logging.getLogger(__name__)


@dataclass
class AuditEntry:
    """Represents a single audit log entry for an MCP tool invocation."""

    log_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: datetime = field(default_factory=lambda: datetime.now(UTC))
    key_id: str = ""  # OAuth subject (sub claim) or user_id
    user_id: str = ""
    tenant_ids: list[str] = field(default_factory=list)
    tool_name: str = ""
    tool_params: dict[str, Any] = field(default_factory=dict)
    duration_ms: float = 0.0
    response_rows: int = 0
    error_message: str | None = None
    ip_address: str | None = None
    user_agent: str | None = None
    auth_method: str = "oauth"  # Always "oauth" now

    def to_clickhouse_row(self) -> dict[str, Any]:
        """Convert to a dictionary suitable for ClickHouse insertion."""
        return {
            "LogId": self.log_id,
            "Timestamp": self.timestamp.isoformat(),
            "KeyId": self.key_id,
            "UserId": self.user_id,
            "TenantIds": self.tenant_ids,
            "ToolName": self.tool_name,
            "ToolParams": json.dumps(self.tool_params),
            "DurationMs": self.duration_ms,
            "ResponseRows": self.response_rows,
            "ErrorMessage": self.error_message,
            "IpAddress": self.ip_address or "",
            "UserAgent": self.user_agent or "",
            "AuthMethod": self.auth_method,
        }


async def log_audit(
    auth_context: OAuthContext,
    tool_name: str,
    tool_params: dict[str, Any],
    duration_ms: float,
    response_rows: int = 0,
    error_message: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> None:
    """
    Log an audit entry for a tool invocation.

    Args:
        auth_context: The authenticated OAuth context
        tool_name: Name of the MCP tool that was called
        tool_params: Parameters passed to the tool (sanitized)
        duration_ms: How long the tool took to execute in milliseconds
        response_rows: Number of rows returned (for data queries)
        error_message: Error message if the tool failed
        ip_address: Client IP address (from request headers)
        user_agent: Client user agent string
    """
    # Use subject (Auth0 user_id) as key_id, fall back to user_id
    key_id = auth_context.subject or auth_context.user_id

    entry = AuditEntry(
        key_id=key_id,
        user_id=auth_context.user_id,
        tenant_ids=auth_context.allowed_tenant_ids,
        tool_name=tool_name,
        tool_params=_sanitize_params(tool_params),
        duration_ms=duration_ms,
        response_rows=response_rows,
        error_message=error_message,
        ip_address=ip_address,
        user_agent=user_agent,
        auth_method="oauth",
    )

    try:
        await insert_rows(
            table="opengander.mcp_audit_logs",
            data=[entry.to_clickhouse_row()],
        )
        logger.debug(
            "Audit logged: %s called %s (%.2fms, %d rows)",
            auth_context.user_id,
            tool_name,
            duration_ms,
            response_rows,
        )
    except Exception as e:
        # Don't fail the tool call if audit logging fails
        logger.error("Failed to log audit entry: %s", e)


def _sanitize_params(params: dict[str, Any]) -> dict[str, Any]:
    """
    Sanitize tool parameters for logging.

    Removes or masks potentially sensitive values while preserving
    the structure for debugging.

    Args:
        params: Raw tool parameters

    Returns:
        Sanitized parameters safe for logging
    """
    sanitized = {}
    sensitive_keys = {"password", "secret", "token", "key", "api_key", "credential"}

    for key, value in params.items():
        key_lower = key.lower()
        if any(sensitive in key_lower for sensitive in sensitive_keys):
            sanitized[key] = "[REDACTED]"
        elif isinstance(value, dict):
            sanitized[key] = _sanitize_params(value)
        elif isinstance(value, list):
            # Truncate long lists
            if len(value) > 10:
                sanitized[key] = value[:10] + ["... (truncated)"]
            else:
                sanitized[key] = value
        elif isinstance(value, str) and len(value) > 500:
            # Truncate long strings
            sanitized[key] = value[:500] + "... (truncated)"
        else:
            sanitized[key] = value

    return sanitized


@asynccontextmanager
async def audit_tool_call(
    auth_context: OAuthContext,
    tool_name: str,
    tool_params: dict[str, Any],
    ip_address: str | None = None,
    user_agent: str | None = None,
):
    """
    Context manager for auditing tool calls.

    Automatically captures timing and handles errors.

    Usage:
        async with audit_tool_call(ctx, "get_overview", params) as audit:
            result = await do_something()
            audit.set_response_rows(len(result))
            return result

    Args:
        auth_context: The authenticated OAuth context
        tool_name: Name of the MCP tool being called
        tool_params: Parameters passed to the tool
        ip_address: Client IP address
        user_agent: Client user agent string

    Yields:
        AuditHelper object for setting response metadata
    """
    start_time = time.perf_counter()
    helper = _AuditHelper()

    try:
        yield helper
    except Exception as e:
        helper.error_message = str(e)
        raise
    finally:
        duration_ms = (time.perf_counter() - start_time) * 1000

        await log_audit(
            auth_context=auth_context,
            tool_name=tool_name,
            tool_params=tool_params,
            duration_ms=duration_ms,
            response_rows=helper.response_rows,
            error_message=helper.error_message,
            ip_address=ip_address,
            user_agent=user_agent,
        )


class _AuditHelper:
    """Helper class for the audit_tool_call context manager."""

    def __init__(self) -> None:
        self.response_rows: int = 0
        self.error_message: str | None = None

    def set_response_rows(self, count: int) -> None:
        """Set the number of response rows for the audit log."""
        self.response_rows = count

    def set_error(self, message: str) -> None:
        """Set an error message for the audit log."""
        self.error_message = message


# =============================================================================
# Failed Authentication Logging
# =============================================================================


@dataclass
class FailedAuthEntry:
    """Represents a failed authentication attempt."""

    log_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: datetime = field(default_factory=lambda: datetime.now(UTC))
    reason: str = ""  # Why authentication failed
    subject: str = ""  # OAuth sub claim if available
    user_id: str = ""  # User ID if extracted
    ip_address: str | None = None
    user_agent: str | None = None
    error_details: str | None = None  # Additional error context

    def to_clickhouse_row(self) -> dict[str, Any]:
        """Convert to a dictionary suitable for ClickHouse insertion."""
        return {
            "LogId": self.log_id,
            "Timestamp": self.timestamp.isoformat(),
            "EventType": "auth_failed",
            "Reason": self.reason,
            "Subject": self.subject,
            "UserId": self.user_id,
            "IpAddress": self.ip_address or "",
            "UserAgent": self.user_agent or "",
            "ErrorDetails": self.error_details or "",
        }


async def log_failed_auth(
    reason: str,
    subject: str = "",
    user_id: str = "",
    ip_address: str | None = None,
    user_agent: str | None = None,
    error_details: str | None = None,
) -> None:
    """
    Log a failed authentication attempt for security monitoring.

    Args:
        reason: Brief description of why auth failed (e.g., "token_expired", "invalid_role")
        subject: OAuth sub claim if available
        user_id: User ID from token claims if available
        ip_address: Client IP address
        user_agent: Client user agent string
        error_details: Additional error context (stack trace, etc.)
    """
    entry = FailedAuthEntry(
        reason=reason,
        subject=subject,
        user_id=user_id,
        ip_address=ip_address,
        user_agent=user_agent,
        error_details=error_details,
    )

    logger.warning(
        "Authentication failed: reason=%s, subject=%s, user_id=%s, ip=%s",
        reason,
        subject or "(unknown)",
        user_id or "(unknown)",
        ip_address or "(unknown)",
    )

    try:
        await insert_rows(
            table="opengander.mcp_auth_events",
            data=[entry.to_clickhouse_row()],
        )
    except Exception as e:
        # Don't fail the request if audit logging fails
        logger.error("Failed to log auth failure: %s", e)
