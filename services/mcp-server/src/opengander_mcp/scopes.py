"""
OAuth scope definitions and tool authorization.

Maps MCP tools to required OAuth scopes:
- health:read - Health check tool
- schema:read - Schema discovery tools (list_tables, describe_table)
- mcp:read - All analytics data tools

Provides utilities for scope checking and tool discovery.
"""

from __future__ import annotations

# Mapping of tool names to required OAuth scopes
TOOL_SCOPES: dict[str, str] = {
    # Health tools
    "health_check": "health:read",
    # Schema discovery tools
    "list_tables": "schema:read",
    "describe_table": "schema:read",
    # Analytics data tools
    "get_overview": "mcp:read",
    "get_page_views": "mcp:read",
    "get_top_pages": "mcp:read",
    "get_web_vitals": "mcp:read",
    "get_traffic_sources": "mcp:read",
    "get_campaigns": "mcp:read",
    "get_errors": "mcp:read",
    "get_user_journey": "mcp:read",
}

# All supported scopes
SUPPORTED_SCOPES: list[str] = ["mcp:read", "schema:read", "health:read"]


def get_required_scope(tool_name: str) -> str | None:
    """
    Get the required OAuth scope for a tool.

    Args:
        tool_name: Name of the MCP tool

    Returns:
        The required scope, or None if the tool is not found
    """
    return TOOL_SCOPES.get(tool_name)


def has_scope(granted_scopes: list[str], required_scope: str) -> bool:
    """
    Check if a required scope is present in granted scopes.

    Args:
        granted_scopes: List of scopes from the OAuth token
        required_scope: The scope required for the operation

    Returns:
        True if the scope is granted
    """
    return required_scope in granted_scopes


def get_tools_for_scopes(scopes: list[str]) -> list[str]:
    """
    Get all tools accessible with the given scopes.

    Args:
        scopes: List of OAuth scopes

    Returns:
        List of tool names accessible with these scopes
    """
    accessible_tools = []
    for tool_name, required_scope in TOOL_SCOPES.items():
        if required_scope in scopes:
            accessible_tools.append(tool_name)
    return sorted(accessible_tools)


def get_tools_by_scope() -> dict[str, list[str]]:
    """
    Group tools by their required scope.

    Returns:
        Dict mapping scopes to lists of tool names
    """
    scope_to_tools: dict[str, list[str]] = {}
    for tool_name, scope in TOOL_SCOPES.items():
        if scope not in scope_to_tools:
            scope_to_tools[scope] = []
        scope_to_tools[scope].append(tool_name)
    return scope_to_tools
