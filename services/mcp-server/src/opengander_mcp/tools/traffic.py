"""
Traffic source tools for OpenGander MCP.

Provides analytics on traffic sources, marketing channels,
and campaign performance.
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
    validate_limit,
)

logger = logging.getLogger(__name__)


async def get_traffic_sources(
    ctx: Context,
    start_date: str | None = None,
    end_date: str | None = None,
    all_time: bool = False,
    limit: int | None = None,
    tenant_id: str | None = None,
) -> dict[str, Any]:
    """
    Get traffic source breakdown by source and medium.

    Returns traffic grouped by source (e.g., google, facebook) and
    medium (e.g., organic, cpc, referral), showing session and user counts.

    Args:
        start_date: Start date in ISO format (default: 7 days ago)
        end_date: End date in ISO format (default: now)
        limit: Maximum number of sources to return (1-100, default: 10)
        tenant_id: Optional specific tenant to query

    Returns:
        Traffic sources data including:
        - date_range: The queried time period
        - sources: Array of {source, medium, sessions, users}
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
    limit = validate_limit(limit, default=10)

    tool_params = {
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "limit": limit,
        "tenant_id": tenant_id,
    }

    async with audit_tool_call(auth_ctx, "get_traffic_sources", tool_params) as audit:
        try:
            # Query marketing_events table for traffic source data
            rows = await execute_query(
                """
                SELECT
                    if(traffic_source = '', '(direct)', traffic_source) AS source,
                    if(traffic_medium = '', '(none)', traffic_medium) AS medium,
                    uniq(session_id) AS sessions,
                    uniq(user_id) AS users
                FROM opengander.marketing_events
                WHERE TenantId IN {tenant_ids:Array(String)}
                  AND event_timestamp >= {start:DateTime}
                  AND event_timestamp <= {end:DateTime}
                  AND event_name = 'page_view'
                GROUP BY source, medium
                ORDER BY sessions DESC
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
                "sources": [
                    {
                        "source": row.get("source", "(direct)"),
                        "medium": row.get("medium", "(none)"),
                        "sessions": row.get("sessions", 0) or 0,
                        "users": row.get("users", 0) or 0,
                    }
                    for row in rows
                ],
            }

        except Exception as e:
            logger.error("get_traffic_sources failed: %s", e)
            audit.set_error(str(e))
            return error_response(f"Failed to get traffic sources: {e}")


async def get_campaigns(
    ctx: Context,
    start_date: str | None = None,
    end_date: str | None = None,
    all_time: bool = False,
    limit: int | None = None,
    tenant_id: str | None = None,
) -> dict[str, Any]:
    """
    Get marketing campaign performance metrics.

    Returns campaign data grouped by campaign name, source, and medium,
    including session counts, user counts, and conversion metrics.

    Args:
        start_date: Start date in ISO format (default: 7 days ago)
        end_date: End date in ISO format (default: now)
        limit: Maximum number of campaigns to return (1-100, default: 20)
        tenant_id: Optional specific tenant to query

    Returns:
        Campaign data including:
        - date_range: The queried time period
        - campaigns: Array of {campaign, source, medium, sessions, users, conversions, conversion_rate}
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

    async with audit_tool_call(auth_ctx, "get_campaigns", tool_params) as audit:
        try:
            # Query marketing_events table for campaign data
            # Join with conversion events to calculate conversion rate
            rows = await execute_query(
                """
                WITH
                    -- Get all sessions by campaign
                    campaign_sessions AS (
                        SELECT
                            traffic_campaign,
                            traffic_source,
                            traffic_medium,
                            uniq(session_id) AS sessions,
                            uniq(user_id) AS users
                        FROM opengander.marketing_events
                        WHERE TenantId IN {tenant_ids:Array(String)}
                          AND event_timestamp >= {start:DateTime}
                          AND event_timestamp <= {end:DateTime}
                          AND traffic_campaign != ''
                        GROUP BY traffic_campaign, traffic_source, traffic_medium
                    ),
                    -- Get conversion counts by campaign
                    campaign_conversions AS (
                        SELECT
                            traffic_campaign,
                            traffic_source,
                            traffic_medium,
                            uniq(session_id) AS conversions
                        FROM opengander.marketing_events
                        WHERE TenantId IN {tenant_ids:Array(String)}
                          AND event_timestamp >= {start:DateTime}
                          AND event_timestamp <= {end:DateTime}
                          AND traffic_campaign != ''
                          AND event_name IN ('conversion', 'purchase', 'signup', 'lead')
                        GROUP BY traffic_campaign, traffic_source, traffic_medium
                    )
                SELECT
                    cs.traffic_campaign AS campaign,
                    cs.traffic_source AS source,
                    cs.traffic_medium AS medium,
                    cs.sessions,
                    cs.users,
                    coalesce(cc.conversions, 0) AS conversions,
                    if(cs.sessions > 0, coalesce(cc.conversions, 0) / cs.sessions, 0) AS conversion_rate
                FROM campaign_sessions cs
                LEFT JOIN campaign_conversions cc
                    ON cs.traffic_campaign = cc.traffic_campaign
                    AND cs.traffic_source = cc.traffic_source
                    AND cs.traffic_medium = cc.traffic_medium
                ORDER BY cs.sessions DESC
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
                "campaigns": [
                    {
                        "campaign": row.get("campaign", ""),
                        "source": row.get("source", ""),
                        "medium": row.get("medium", ""),
                        "sessions": row.get("sessions", 0) or 0,
                        "users": row.get("users", 0) or 0,
                        "conversions": row.get("conversions", 0) or 0,
                        "conversion_rate": round(row.get("conversion_rate", 0) or 0, 4),
                    }
                    for row in rows
                ],
            }

        except Exception as e:
            logger.error("get_campaigns failed: %s", e)
            audit.set_error(str(e))
            return error_response(f"Failed to get campaigns: {e}")
