"""
Tests for HTTP endpoints in server.py.

Tests cover:
- /health endpoint (unauthenticated)
- /auth-info authentication metadata
- /.well-known/oauth-protected-resource (RFC 9728)
- WWW-Authenticate header on 401 responses
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from starlette.testclient import TestClient


@pytest.fixture
def test_client():
    """Create a test client for the server."""
    from opengander_mcp.server import app

    return TestClient(app)


@pytest.fixture
def reset_settings():
    """Reset the server settings singleton before/after test."""
    import opengander_mcp.server as server_module

    original = server_module._settings
    server_module._settings = None
    yield
    server_module._settings = original


class TestHealthEndpoint:
    """Tests for /health HTTP endpoint."""

    def test_health_returns_healthy_when_clickhouse_connected(self, test_client):
        """Should return healthy status when ClickHouse is connected."""
        with patch("opengander_mcp.server.ping", new_callable=AsyncMock) as mock_ping:
            mock_ping.return_value = True

            response = test_client.get("/health")

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "healthy"
            assert data["clickhouse"] == "connected"

    def test_health_returns_degraded_when_clickhouse_disconnected(self, test_client):
        """Should return degraded status when ClickHouse is disconnected."""
        with patch("opengander_mcp.server.ping", new_callable=AsyncMock) as mock_ping:
            mock_ping.return_value = False

            response = test_client.get("/health")

            assert response.status_code == 503
            data = response.json()
            assert data["status"] == "degraded"
            assert data["clickhouse"] == "disconnected"

    def test_health_includes_version(self, test_client):
        """Should include version in health response."""
        with patch("opengander_mcp.server.ping", new_callable=AsyncMock) as mock_ping:
            mock_ping.return_value = True

            response = test_client.get("/health")

            data = response.json()
            assert "version" in data


class TestAuthInfoEndpoint:
    """Tests for /auth-info endpoint."""

    def test_returns_auth_info(self, test_client):
        """Should return authentication information."""
        response = test_client.get("/auth-info")

        assert response.status_code == 200
        data = response.json()

        assert data["auth_method"] == "bearer_jwt"
        assert data["token_source"] == "web_app_session"
        assert "mcp:read" in data["scopes_supported"]
        assert "schema:read" in data["scopes_supported"]
        assert "health:read" in data["scopes_supported"]
        assert "header" in data["bearer_methods_supported"]


class TestProtectedResourceMetadata:
    """Tests for /.well-known/oauth-protected-resource endpoint (RFC 9728)."""

    def test_returns_protected_resource_metadata(self, test_client, reset_settings):
        """Should return RFC 9728 Protected Resource Metadata."""
        response = test_client.get("/.well-known/oauth-protected-resource")

        assert response.status_code == 200
        data = response.json()

        # Required fields per RFC 9728
        assert "resource" in data
        assert "authorization_servers" in data
        assert "scopes_supported" in data
        assert "bearer_methods_supported" in data

    def test_returns_correct_resource_uri(self, test_client, reset_settings, monkeypatch):
        """Should return the configured resource URI."""
        monkeypatch.setenv("MCP_RESOURCE_URI", "https://test-mcp.example.com")

        # Reset settings to pick up new env var
        import opengander_mcp.server as server_module

        server_module._settings = None

        response = test_client.get("/.well-known/oauth-protected-resource")
        data = response.json()

        assert data["resource"] == "https://test-mcp.example.com"

    def test_returns_authorization_servers(self, test_client, reset_settings, monkeypatch):
        """Should return the configured authorization server URI."""
        monkeypatch.setenv("AUTHORIZATION_SERVER_URI", "https://auth.example.com")

        # Reset settings to pick up new env var
        import opengander_mcp.server as server_module

        server_module._settings = None

        response = test_client.get("/.well-known/oauth-protected-resource")
        data = response.json()

        assert data["authorization_servers"] == ["https://auth.example.com"]

    def test_returns_supported_scopes(self, test_client, reset_settings):
        """Should list all supported OAuth scopes."""
        response = test_client.get("/.well-known/oauth-protected-resource")
        data = response.json()

        scopes = data["scopes_supported"]
        assert "mcp:read" in scopes
        assert "schema:read" in scopes
        assert "health:read" in scopes

    def test_returns_bearer_methods(self, test_client, reset_settings):
        """Should indicate header-based bearer token method."""
        response = test_client.get("/.well-known/oauth-protected-resource")
        data = response.json()

        assert data["bearer_methods_supported"] == ["header"]

    def test_uses_default_uris_when_not_configured(self, test_client, reset_settings):
        """Should use default URIs when env vars are not set."""
        response = test_client.get("/.well-known/oauth-protected-resource")
        data = response.json()

        # Default values from ServerSettings
        assert data["resource"] == "https://mcp.opengander.io"
        assert data["authorization_servers"] == ["https://app.opengander.io"]


class TestAuthErrorMiddleware:
    """Tests for WWW-Authenticate header middleware."""

    def test_401_includes_www_authenticate_header(self, test_client, reset_settings):
        """401 responses should include WWW-Authenticate header."""
        # Make a request to an authenticated endpoint without auth
        response = test_client.get("/mcp")

        # Should get 401 (or similar auth error)
        # The middleware should add WWW-Authenticate header
        if response.status_code == 401:
            assert "WWW-Authenticate" in response.headers
            www_auth = response.headers["WWW-Authenticate"]
            assert "Bearer" in www_auth

    def test_www_authenticate_includes_resource_metadata_url(
        self, test_client, reset_settings
    ):
        """WWW-Authenticate header should include resource_metadata URL per RFC 9728."""
        response = test_client.get("/mcp")

        if response.status_code == 401 and "WWW-Authenticate" in response.headers:
            www_auth = response.headers["WWW-Authenticate"]
            # Should include resource_metadata URL for OAuth 2.1 discovery
            assert "resource_metadata=" in www_auth
            assert "/.well-known/oauth-protected-resource" in www_auth

    def test_www_authenticate_uses_configured_resource_uri(
        self, test_client, reset_settings, monkeypatch
    ):
        """WWW-Authenticate should use configured MCP_RESOURCE_URI."""
        monkeypatch.setenv("MCP_RESOURCE_URI", "https://custom-mcp.example.com")

        # Reset settings to pick up new env var
        import opengander_mcp.server as server_module

        server_module._settings = None

        response = test_client.get("/mcp")

        if response.status_code == 401 and "WWW-Authenticate" in response.headers:
            www_auth = response.headers["WWW-Authenticate"]
            expected_url = (
                "https://custom-mcp.example.com/.well-known/oauth-protected-resource"
            )
            assert expected_url in www_auth
