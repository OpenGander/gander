"""
Page performance tools for OpenGander MCP.

Provides detailed page view analytics, top pages ranking,
and Core Web Vitals measurements.
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


async def get_page_views(
    ctx: Context,
    start_date: str | None = None,
    end_date: str | None = None,
    all_time: bool = False,
    interval: str | None = None,
    tenant_id: str | None = None,
) -> dict[str, Any]:
    """
    Get time series of page views with hourly or daily aggregation.

    Useful for understanding traffic patterns over time, identifying
    peak hours, and tracking growth trends.

    Args:
        start_date: Start date in ISO format (default: 7 days ago)
        end_date: End date in ISO format (default: now)
        interval: Time aggregation - 'hour' or 'day' (default: 'hour')
        tenant_id: Optional specific tenant to query

    Returns:
        Time series data including:
        - date_range: The queried time period
        - interval: The aggregation interval used
        - data: Array of {time, views, unique_users} objects
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

    tool_params = {
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "interval": interval,
        "tenant_id": tenant_id,
    }

    async with audit_tool_call(auth_ctx, "get_page_views", tool_params) as audit:
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
                    count() AS views,
                    uniq(SpanAttributes['user.id']) AS unique_users
                FROM opengander.otel_traces
                WHERE TenantId IN {{tenant_ids:Array(String)}}
                  AND Timestamp >= {{start:DateTime}}
                  AND Timestamp <= {{end:DateTime}}
                  AND SpanName = 'page_view'
                GROUP BY time
                ORDER BY time
                """,
                {
                    "tenant_ids": tenant_ids,
                    "start": start,
                    "end": end,
                },
            )

            audit.set_response_rows(len(rows))

            return {
                "date_range": format_date_range(start, end),
                "interval": interval,
                "data": [
                    {
                        "time": row["time"].isoformat() if hasattr(row["time"], "isoformat") else str(row["time"]),
                        "views": row.get("views", 0) or 0,
                        "unique_users": row.get("unique_users", 0) or 0,
                    }
                    for row in rows
                ],
            }

        except Exception as e:
            logger.error("get_page_views failed: %s", e)
            audit.set_error(str(e))
            return error_response(f"Failed to get page views: {e}")


async def get_top_pages(
    ctx: Context,
    start_date: str | None = None,
    end_date: str | None = None,
    all_time: bool = False,
    limit: int | None = None,
    tenant_id: str | None = None,
) -> dict[str, Any]:
    """
    Get the most visited pages with engagement metrics.

    Returns pages ranked by view count, including unique visitor counts
    and average load times for each page.

    Args:
        start_date: Start date in ISO format (default: 7 days ago)
        end_date: End date in ISO format (default: now)
        limit: Maximum number of pages to return (1-100, default: 20)
        tenant_id: Optional specific tenant to query

    Returns:
        Top pages data including:
        - date_range: The queried time period
        - pages: Array of {page, views, unique_visitors, avg_load_time_ms}
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
    limit = validate_limit(limit, default=20)

    tool_params = {
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "limit": limit,
        "tenant_id": tenant_id,
    }

    async with audit_tool_call(auth_ctx, "get_top_pages", tool_params) as audit:
        try:
            rows = await execute_query(
                """
                SELECT
                    SpanAttributes['http.target'] AS page,
                    count() AS views,
                    uniq(SpanAttributes['user.id']) AS unique_visitors,
                    avg(Duration / 1000000) AS avg_load_time_ms
                FROM opengander.otel_traces
                WHERE TenantId IN {tenant_ids:Array(String)}
                  AND Timestamp >= {start:DateTime}
                  AND Timestamp <= {end:DateTime}
                  AND SpanName = 'page_view'
                  AND SpanAttributes['http.target'] != ''
                GROUP BY page
                ORDER BY views DESC
                LIMIT {limit:UInt32}
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
                "pages": [
                    {
                        "page": row.get("page", "/"),
                        "views": row.get("views", 0) or 0,
                        "unique_visitors": row.get("unique_visitors", 0) or 0,
                        "avg_load_time_ms": round(row.get("avg_load_time_ms", 0) or 0, 2),
                    }
                    for row in rows
                ],
            }

        except Exception as e:
            logger.error("get_top_pages failed: %s", e)
            audit.set_error(str(e))
            return error_response(f"Failed to get top pages: {e}")


async def get_web_vitals(
    ctx: Context,
    start_date: str | None = None,
    end_date: str | None = None,
    all_time: bool = False,
    tenant_id: str | None = None,
) -> dict[str, Any]:
    """
    Get Core Web Vitals metrics with percentiles.

    Returns performance percentiles (p50, p75, p95) for key web vitals:
    - LCP (Largest Contentful Paint): Loading performance
    - FID (First Input Delay): Interactivity
    - CLS (Cumulative Layout Shift): Visual stability
    - TTFB (Time to First Byte): Server responsiveness
    - INP (Interaction to Next Paint): Overall responsiveness

    Args:
        start_date: Start date in ISO format (default: 7 days ago)
        end_date: End date in ISO format (default: now)
        tenant_id: Optional specific tenant to query

    Returns:
        Web vitals data including:
        - date_range: The queried time period
        - vitals: Array of {metric, p50, p75, p95, sample_count}
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
    }

    async with audit_tool_call(auth_ctx, "get_web_vitals", tool_params) as audit:
        try:
            # Web vitals are stored with SpanName like 'web.vital.lcp', 'web.vital.fid', etc.
            # Attributes use dot notation: 'web.vital.name', 'web.vital.value'
            rows = await execute_query(
                """
                SELECT
                    SpanAttributes['web.vital.name'] AS metric,
                    quantile(0.50)(toFloat64OrNull(SpanAttributes['web.vital.value'])) AS p50,
                    quantile(0.75)(toFloat64OrNull(SpanAttributes['web.vital.value'])) AS p75,
                    quantile(0.95)(toFloat64OrNull(SpanAttributes['web.vital.value'])) AS p95,
                    count() AS sample_count
                FROM opengander.otel_traces
                WHERE TenantId IN {tenant_ids:Array(String)}
                  AND Timestamp >= {start:DateTime}
                  AND Timestamp <= {end:DateTime}
                  AND SpanName LIKE 'web.vital.%'
                  AND SpanAttributes['web.vital.name'] != ''
                GROUP BY metric
                ORDER BY metric
                """,
                {
                    "tenant_ids": tenant_ids,
                    "start": start,
                    "end": end,
                },
            )

            audit.set_response_rows(len(rows))

            # Define expected vitals for consistent response
            expected_vitals = ["LCP", "FID", "CLS", "TTFB", "INP"]
            vitals_map = {
                row.get("metric", "").upper(): row
                for row in rows
            }

            vitals = []
            for metric in expected_vitals:
                if metric in vitals_map:
                    row = vitals_map[metric]
                    vitals.append({
                        "metric": metric,
                        "p50": round(row.get("p50") or 0, 2),
                        "p75": round(row.get("p75") or 0, 2),
                        "p95": round(row.get("p95") or 0, 2),
                        "sample_count": row.get("sample_count", 0) or 0,
                    })
                else:
                    # Include metric with null values if no data
                    vitals.append({
                        "metric": metric,
                        "p50": None,
                        "p75": None,
                        "p95": None,
                        "sample_count": 0,
                    })

            return {
                "date_range": format_date_range(start, end),
                "vitals": vitals,
            }

        except Exception as e:
            logger.error("get_web_vitals failed: %s", e)
            audit.set_error(str(e))
            return error_response(f"Failed to get web vitals: {e}")
