"""
MCP Tools for OpenGander Analytics.

This module contains all the MCP tools for querying analytics data.
Tools are organized by domain:

- schema.py: Schema discovery (list_tables, describe_table)
- analytics.py: Dashboard overview metrics
- pages.py: Page performance (views, top pages, web vitals)
- traffic.py: Traffic sources and campaigns
- errors.py: Error tracking and user journeys

All analytics tools enforce multi-tenant data isolation based on
the authenticated API key's tenant scope.
"""

from .analytics import get_overview
from .errors import get_errors, get_user_journey
from .pages import get_page_views, get_top_pages, get_web_vitals
from .schema import describe_table, list_tables
from .traffic import get_campaigns, get_traffic_sources

__all__ = [
    # Schema tools (no tenant filter)
    "list_tables",
    "describe_table",
    # Analytics tools
    "get_overview",
    # Page performance tools
    "get_page_views",
    "get_top_pages",
    "get_web_vitals",
    # Traffic tools
    "get_traffic_sources",
    "get_campaigns",
    # Error and journey tools
    "get_errors",
    "get_user_journey",
]
