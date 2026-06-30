"""
Error tracking and user journey tools for OpenGander MCP.

Provides error analytics and user session path analysis
for debugging and understanding user behavior.
"""

from __future__ import annotations

import logging
from typing import Any

from fastmcp import Context

from ..audit import audit_tool_call
from ..auth import get_auth_context
from ..db import execute_query
from ._common import (
    access_denied_response,
    error_response,
    format_date_range,
    parse_date_range,
    validate_interval,
    validate_limit,
)

logger = logging.getLogger(__name__)


async def get_errors(
    ctx: Context,
    start_date: str | None = None,
    end_date: str | None = None,
    all_time: bool = False,
    interval: str | None = None,
    limit: int | None = None,
    tenant_id: str | None = None,
) -> dict[str, Any]:
    """
    Get error counts and types over time with affected users and pages.

    Returns errors grouped by time period and error type, showing
    how many users were affected and which pages had errors.

    Args:
        start_date: Start date in ISO format (default: 7 days ago)
        end_date: End date in ISO format (default: now)
        interval: Time aggregation - 'hour' or 'day' (default: 'hour')
        limit: Maximum number of error groups to return (1-100, default: 50)
        tenant_id: Optional specific tenant to query

    Returns:
        Error data including:
        - date_range: The queried time period
        - interval: The aggregation interval used
        - errors: Array of {time, error_type, error_count, affected_users, affected_pages}
    """
    auth_ctx = get_auth_context(ctx)

    # Resolve tenant filter
    if tenant_id:
        if not auth_ctx.can_access_tenant(tenant_id):
            return access_denied_response(tenant_id)
        tenant_ids = [tenant_id]
    else:
        tenant_ids = auth_ctx.allowed_tenant_ids

    if not tenant_ids:
        return error_response("No accessible tenants found")

    # Parse and validate parameters
    start, end = parse_date_range(start_date, end_date, all_time=all_time)
    interval = validate_interval(interval, default="hour")
    limit = validate_limit(limit, default=50)

    tool_params = {
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "interval": interval,
        "limit": limit,
        "tenant_id": tenant_id,
    }

    async with audit_tool_call(auth_ctx, "get_errors", tool_params) as audit:
        try:
            # Use different aggregation function based on interval
            if interval == "hour":
                time_func = "toStartOfHour"
            else:
                time_func = "toStartOfDay"

            rows = await execute_query(
                f"""
                SELECT
                    {time_func}(Timestamp) AS time,
                    coalesce(
                        SpanAttributes['exception.type'],
                        SpanAttributes['error.type'],
                        StatusMessage,
                        'unknown'
                    ) AS error_type,
                    count() AS error_count,
                    uniq(SpanAttributes['user.id']) AS affected_users,
                    groupArray(DISTINCT SpanAttributes['http.target'])[1:5] AS affected_pages
                FROM opengander.otel_traces
                WHERE TenantId IN {{tenant_ids:Array(String)}}
                  AND Timestamp >= {{start:DateTime}}
                  AND Timestamp <= {{end:DateTime}}
                  AND StatusCode = 'ERROR'
                GROUP BY time, error_type
                ORDER BY time DESC, error_count DESC
                LIMIT {{limit:UInt32}}
                """,
                {
                    "tenant_ids": tenant_ids,
                    "start": start,
                    "end": end,
                    "limit": limit,
                },
            )

            audit.set_response_rows(len(rows))

            return {
                "date_range": format_date_range(start, end),
                "interval": interval,
                "errors": [
                    {
                        "time": row["time"].isoformat() if hasattr(row["time"], "isoformat") else str(row["time"]),
                        "error_type": row.get("error_type", "unknown"),
                        "error_count": row.get("error_count", 0) or 0,
                        "affected_users": row.get("affected_users", 0) or 0,
                        "affected_pages": [p for p in (row.get("affected_pages") or []) if p],
                    }
                    for row in rows
                ],
            }

        except Exception as e:
            logger.error("get_errors failed: %s", e)
            audit.set_error(str(e))
            return error_response(f"Failed to get errors: {e}")


async def get_user_journey(
    ctx: Context,
    start_date: str | None = None,
    end_date: str | None = None,
    all_time: bool = False,
    session_id: str | None = None,
    limit: int | None = None,
    tenant_id: str | None = None,
) -> dict[str, Any]:
    """
    Get user session paths and sequences for understanding user behavior.

    Returns detailed session information including the sequence of pages
    visited, traffic source, device information, and timing.

    Args:
        start_date: Start date in ISO format (default: 7 days ago)
        end_date: End date in ISO format (default: now)
        session_id: Optional specific session to query
        limit: Maximum number of sessions to return (1-100, default: 50)
        tenant_id: Optional specific tenant to query

    Returns:
        User journey data including:
        - date_range: The queried time period
        - sessions: Array of session objects with:
          - session_id, user_id
          - session_start, session_end
          - total_steps
          - steps: Array of page paths in order
          - traffic_source: source / medium
          - device_category
    """
    auth_ctx = get_auth_context(ctx)

    # Resolve tenant filter
    if tenant_id:
        if not auth_ctx.can_access_tenant(tenant_id):
            return access_denied_response(tenant_id)
        tenant_ids = [tenant_id]
    else:
        tenant_ids = auth_ctx.allowed_tenant_ids

    if not tenant_ids:
        return error_response("No accessible tenants found")

    # Parse and validate parameters
    start, end = parse_date_range(start_date, end_date, all_time=all_time)
    limit = validate_limit(limit, default=50)

    tool_params = {
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "session_id": session_id,
        "limit": limit,
        "tenant_id": tenant_id,
    }

    async with audit_tool_call(auth_ctx, "get_user_journey", tool_params) as audit:
        try:
            # Build query based on whether session_id filter is provided
            if session_id:
                # Get detailed journey for a specific session
                rows = await execute_query(
                    """
                    SELECT
                        session_id,
                        user_id,
                        min(step_timestamp) AS session_start,
                        max(step_timestamp) AS session_end,
                        max(session_total_steps) AS total_steps,
                        groupArray(step_name) AS steps,
                        any(traffic_source) AS traffic_source,
                        any(traffic_medium) AS traffic_medium,
                        any(device_category) AS device_category
                    FROM opengander.user_journey
                    WHERE TenantId IN {tenant_ids:Array(String)}
                      AND journey_date >= {start_date:Date}
                      AND journey_date <= {end_date:Date}
                      AND session_id = {session_id:String}
                    GROUP BY session_id, user_id
                    ORDER BY session_start DESC
                    """,
                    {
                        "tenant_ids": tenant_ids,
                        "start_date": start.date(),
                        "end_date": end.date(),
                        "session_id": session_id,
                    },
                )
            else:
                # Get recent sessions with journeys
                rows = await execute_query(
                    """
                    SELECT
                        session_id,
                        user_id,
                        min(step_timestamp) AS session_start,
                        max(step_timestamp) AS session_end,
                        max(session_total_steps) AS total_steps,
                        groupArray(step_name) AS steps,
                        any(traffic_source) AS traffic_source,
                        any(traffic_medium) AS traffic_medium,
                        any(device_category) AS device_category
                    FROM opengander.user_journey
                    WHERE TenantId IN {tenant_ids:Array(String)}
                      AND journey_date >= {start_date:Date}
                      AND journey_date <= {end_date:Date}
                    GROUP BY session_id, user_id
                    ORDER BY session_start DESC
                    LIMIT {limit:UInt32}
                    """,
                    {
                        "tenant_ids": tenant_ids,
                        "start_date": start.date(),
                        "end_date": end.date(),
                        "limit": limit,
                    },
                )

            audit.set_response_rows(len(rows))

            def format_timestamp(ts: Any) -> str:
                """Format a timestamp to ISO string."""
                if ts is None:
                    return ""
                if hasattr(ts, "isoformat"):
                    return ts.isoformat()
                return str(ts)

            return {
                "date_range": format_date_range(start, end),
                "sessions": [
                    {
                        "session_id": row.get("session_id", ""),
                        "user_id": row.get("user_id", ""),
                        "session_start": format_timestamp(row.get("session_start")),
                        "session_end": format_timestamp(row.get("session_end")),
                        "total_steps": row.get("total_steps", 0) or 0,
                        "steps": row.get("steps", []) or [],
                        "traffic_source": f"{row.get('traffic_source', '(direct)')} / {row.get('traffic_medium', '(none)')}",
                        "device_category": row.get("device_category", "unknown") or "unknown",
                    }
                    for row in rows
                ],
            }

        except Exception as e:
            logger.error("get_user_journey failed: %s", e)
            audit.set_error(str(e))
            return error_response(f"Failed to get user journey: {e}")
