"""
Tests for OAuth scope definitions and tool authorization in scopes.py.

Tests cover:
- Scope mapping completeness
- Tool scope lookups
- Scope checking functions
- Tool discovery by scope
"""

from __future__ import annotations


class TestToolScopes:
    """Tests for TOOL_SCOPES mapping."""

    def test_all_tools_have_scopes(self):
        """Every known tool should have a scope mapping."""
        from opengander_mcp.scopes import TOOL_SCOPES

        expected_tools = [
            "health_check",
            "list_tables",
            "describe_table",
            "get_overview",
            "get_page_views",
            "get_top_pages",
            "get_web_vitals",
            "get_traffic_sources",
            "get_campaigns",
            "get_errors",
            "get_user_journey",
        ]

        for tool in expected_tools:
            assert tool in TOOL_SCOPES, f"Tool {tool} missing from TOOL_SCOPES"

    def test_scopes_are_valid(self):
        """All mapped scopes should be in SUPPORTED_SCOPES."""
        from opengander_mcp.scopes import SUPPORTED_SCOPES, TOOL_SCOPES

        for tool, scope in TOOL_SCOPES.items():
            assert scope in SUPPORTED_SCOPES, (
                f"Tool {tool} has unsupported scope {scope}"
            )


class TestGetRequiredScope:
    """Tests for get_required_scope function."""

    def test_known_tool_returns_scope(self):
        """Known tools should return their required scope."""
        from opengander_mcp.scopes import get_required_scope

        assert get_required_scope("health_check") == "health:read"
        assert get_required_scope("list_tables") == "schema:read"
        assert get_required_scope("get_overview") == "mcp:read"

    def test_unknown_tool_returns_none(self):
        """Unknown tools should return None."""
        from opengander_mcp.scopes import get_required_scope

        assert get_required_scope("unknown_tool") is None
        assert get_required_scope("") is None
        assert get_required_scope("nonexistent") is None


class TestHasScope:
    """Tests for has_scope function."""

    def test_has_matching_scope(self):
        """Should return True when scope is present."""
        from opengander_mcp.scopes import has_scope

        granted = ["mcp:read", "schema:read", "health:read"]

        assert has_scope(granted, "mcp:read") is True
        assert has_scope(granted, "schema:read") is True
        assert has_scope(granted, "health:read") is True

    def test_missing_scope(self):
        """Should return False when scope is not present."""
        from opengander_mcp.scopes import has_scope

        granted = ["health:read"]

        assert has_scope(granted, "mcp:read") is False
        assert has_scope(granted, "schema:read") is False

    def test_empty_granted_scopes(self):
        """Should return False with empty granted scopes."""
        from opengander_mcp.scopes import has_scope

        assert has_scope([], "mcp:read") is False

    def test_partial_scope_match(self):
        """Should not match partial scopes."""
        from opengander_mcp.scopes import has_scope

        granted = ["mcp:read:all"]

        # Exact match required - no prefix/suffix matching
        assert has_scope(granted, "mcp:read") is False


class TestGetToolsForScopes:
    """Tests for get_tools_for_scopes function."""

    def test_get_tools_for_scopes(self):
        """Should return all tools accessible with given scopes."""
        from opengander_mcp.scopes import get_tools_for_scopes

        # All scopes
        tools = get_tools_for_scopes(["mcp:read", "schema:read", "health:read"])

        assert "health_check" in tools
        assert "list_tables" in tools
        assert "describe_table" in tools
        assert "get_overview" in tools
        assert "get_page_views" in tools

    def test_single_scope_subset(self):
        """Should only return tools for granted scope."""
        from opengander_mcp.scopes import get_tools_for_scopes

        # Only health scope
        tools = get_tools_for_scopes(["health:read"])

        assert "health_check" in tools
        assert "list_tables" not in tools
        assert "get_overview" not in tools

    def test_empty_scopes(self):
        """Should return empty list for no scopes."""
        from opengander_mcp.scopes import get_tools_for_scopes

        tools = get_tools_for_scopes([])
        assert tools == []

    def test_results_are_sorted(self):
        """Results should be sorted alphabetically."""
        from opengander_mcp.scopes import get_tools_for_scopes

        tools = get_tools_for_scopes(["mcp:read", "schema:read", "health:read"])
        assert tools == sorted(tools)


class TestGetToolsByScope:
    """Tests for get_tools_by_scope function."""

    def test_groups_tools_by_scope(self):
        """Should group tools by their required scope."""
        from opengander_mcp.scopes import get_tools_by_scope

        grouped = get_tools_by_scope()

        assert "health:read" in grouped
        assert "schema:read" in grouped
        assert "mcp:read" in grouped

        assert "health_check" in grouped["health:read"]
        assert "list_tables" in grouped["schema:read"]
        assert "describe_table" in grouped["schema:read"]
        assert "get_overview" in grouped["mcp:read"]

    def test_all_scopes_present(self):
        """All supported scopes should be present."""
        from opengander_mcp.scopes import SUPPORTED_SCOPES, get_tools_by_scope

        grouped = get_tools_by_scope()

        for scope in SUPPORTED_SCOPES:
            assert scope in grouped
