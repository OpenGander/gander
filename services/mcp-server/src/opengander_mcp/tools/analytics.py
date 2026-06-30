"""
Analytics overview tool for OpenGander MCP.

Provides high-level dashboard metrics for understanding overall
traffic and performance patterns.
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
)

logger = logging.getLogger(__name__)


async def get_overview(
    ctx: Context,
    start_date: str | None = None,
    end_date: str | None = None,
    all_time: bool = False,
    tenant_id: str | None = None,
) -> dict[str, Any]:
    """
    Get dashboard overview metrics including visitors, pageviews, load time, and sessions.

    This provides the high-level KPIs typically shown on an analytics dashboard.
    Data is aggregated across the specified date range.

    Args:
        start_date: Start date in ISO format (default: 7 days ago)
        end_date: End date in ISO format (default: now)
        tenant_id: Optional specific tenant to query (must be in your allowed scope)

    Returns:
        Overview metrics including:
        - date_range: The queried time period
        - metrics: unique_visitors, total_pageviews, avg_load_time_ms, sessions
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

    # Parse dates
    start, end = parse_date_range(start_date, end_date, all_time=all_time)

    tool_params = {
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "tenant_id": tenant_id,
        "tenant_ids": tenant_ids,
    }

    async with audit_tool_call(auth_ctx, "get_overview", tool_params) as audit:
        try:
            rows = await execute_query(
                """
                SELECT
                    uniq(SpanAttributes['user.id']) AS unique_visitors,
                    count() AS total_pageviews,
                    avg(Duration / 1000000) AS avg_load_time_ms,
                    uniq(SpanAttributes['session.id']) AS sessions
                FROM opengander.otel_traces
                WHERE TenantId IN {tenant_ids:Array(String)}
                  AND Timestamp >= {start:DateTime}
                  AND Timestamp <= {end:DateTime}
                  AND SpanName = 'page_view'
                """,
                {
                    "tenant_ids": tenant_ids,
                    "start": start,
                    "end": end,
                },
            )

            audit.set_response_rows(1)

            # Handle empty results
            if not rows:
                return {
                    "date_range": format_date_range(start, end),
                    "metrics": {
                        "unique_visitors": 0,
                        "total_pageviews": 0,
                        "avg_load_time_ms": 0.0,
                        "sessions": 0,
                    },
                }

            row = rows[0]
            return {
                "date_range": format_date_range(start, end),
                "metrics": {
                    "unique_visitors": row.get("unique_visitors", 0) or 0,
                    "total_pageviews": row.get("total_pageviews", 0) or 0,
                    "avg_load_time_ms": round(row.get("avg_load_time_ms", 0) or 0, 2),
                    "sessions": row.get("sessions", 0) or 0,
                },
            }

        except Exception as e:
            logger.error("get_overview failed: %s", e)
            audit.set_error(str(e))
            return error_response(f"Failed to get overview: {e}")
