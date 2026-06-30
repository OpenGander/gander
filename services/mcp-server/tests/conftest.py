"""
Shared pytest fixtures for MCP server tests.

Provides:
- JWT secrets for HS256 and RS256 token signing
- Token factory for creating test JWTs (web app and OAuth formats)
- RSA keypair for RS256 testing
- Mock fixtures for database, caching, and JWKS
- Pre-built auth context fixtures
"""

from __future__ import annotations

import json
import time
from typing import Any
from unittest.mock import AsyncMock, patch

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm

# =============================================================================
# HS256 JWT Secret Fixtures
# =============================================================================


@pytest.fixture(scope="session")
def jwt_secret() -> str:
    """
    JWT secret for HS256 token signing/verification.

    This matches the format expected by the web app and MCP server.
    """
    return "test-jwt-secret-key-at-least-32-characters-long-for-security"


# =============================================================================
# RS256 Key Fixtures
# =============================================================================


@pytest.fixture(scope="session")
def rsa_keypair():
    """
    Generate an RSA key pair for RS256 token signing/verification.

    Returns:
        Tuple of (private_key, public_key)
    """
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )
    public_key = private_key.public_key()
    return private_key, public_key


@pytest.fixture(scope="session")
def rsa_private_key(rsa_keypair):
    """The RSA private key for signing tokens."""
    return rsa_keypair[0]


@pytest.fixture(scope="session")
def rsa_public_key(rsa_keypair):
    """The RSA public key for verifying tokens."""
    return rsa_keypair[1]


@pytest.fixture(scope="session")
def jwk_from_keypair(rsa_public_key):
    """
    Create a JWK from the test RSA key pair.

    Returns a dictionary in JWK format suitable for JWKS response.
    """
    jwk_dict = json.loads(RSAAlgorithm.to_jwk(rsa_public_key))
    jwk_dict["kid"] = "test-key-id"
    jwk_dict["use"] = "sig"
    jwk_dict["alg"] = "RS256"
    return jwk_dict


@pytest.fixture(scope="session")
def jwks_response(jwk_from_keypair):
    """Create a valid JWKS response for testing."""
    return {"keys": [jwk_from_keypair]}


# =============================================================================
# Token Factory (HS256 Session Tokens)
# =============================================================================


@pytest.fixture
def token_factory(jwt_secret: str):
    """
    Factory fixture for creating test JWTs in web app session format.

    Usage:
        token = token_factory(userId="user123", role="admin")
        token = token_factory(expired=True)
    """
    def _create_token(
        userId: str = "user-123",
        email: str = "test@example.com",
        tenantId: str = "tenant-123",
        tenantName: str = "Test Tenant",
        role: str = "user",
        token_type: str = "session",
        expired: bool = False,
        issued_at: int | None = None,
        expires_at: int | None = None,
        impersonating: dict[str, Any] | None = None,
    ) -> str:
        now = int(time.time())

        if issued_at is None:
            issued_at = now - 60  # Issued 1 minute ago

        if expires_at is None:
            if expired:
                expires_at = now - 3600  # Expired 1 hour ago
            else:
                expires_at = now + 3600  # Expires in 1 hour

        payload = {
            "userId": userId,
            "email": email,
            "tenantId": tenantId,
            "tenantName": tenantName,
            "role": role,
            "type": token_type,
            "iat": issued_at,
            "exp": expires_at,
        }

        if impersonating:
            payload["impersonating"] = impersonating

        return jwt.encode(
            payload,
            jwt_secret,
            algorithm="HS256",
        )

    return _create_token


# =============================================================================
# RS256 OAuth Token Factory
# =============================================================================


@pytest.fixture
def rs256_token_factory(rsa_private_key):
    """
    Factory fixture for creating RS256-signed OAuth tokens.

    Usage:
        token = rs256_token_factory(sub="user123", scope="mcp:read schema:read")
        token = rs256_token_factory(expired=True)
    """
    def _create_token(
        sub: str = "user-123",
        email: str = "test@example.com",
        user_id: str | None = None,
        tenant_id: str = "tenant-123",
        role: str = "user",
        scope: str = "mcp:read schema:read health:read",
        aud: str = "https://mcp.opengander.io",
        iss: str = "https://app.opengander.io",
        kid: str = "test-key-id",
        expired: bool = False,
        issued_at: int | None = None,
        expires_at: int | None = None,
    ) -> str:
        now = int(time.time())

        if issued_at is None:
            issued_at = now - 60  # Issued 1 minute ago

        if expires_at is None:
            if expired:
                expires_at = now - 3600  # Expired 1 hour ago
            else:
                expires_at = now + 3600  # Expires in 1 hour

        payload = {
            "sub": sub,
            "email": email,
            "user_id": user_id or sub,
            "tenant_id": tenant_id,
            "role": role,
            "scope": scope,
            "aud": aud,
            "iss": iss,
            "iat": issued_at,
            "exp": expires_at,
        }

        return jwt.encode(
            payload,
            rsa_private_key,
            algorithm="RS256",
            headers={"kid": kid},
        )

    return _create_token


# =============================================================================
# Pre-built Token Fixtures
# =============================================================================


@pytest.fixture
def valid_token(token_factory) -> str:
    """A valid, non-expired HS256 token with standard claims."""
    return token_factory()


@pytest.fixture
def expired_token(token_factory) -> str:
    """An expired HS256 token."""
    return token_factory(expired=True)


@pytest.fixture
def admin_token(token_factory) -> str:
    """A valid HS256 token with admin role."""
    return token_factory(role="admin")


@pytest.fixture
def superadmin_token(token_factory) -> str:
    """A valid HS256 token with superadmin role."""
    return token_factory(role="superadmin")


@pytest.fixture
def magic_link_token(token_factory) -> str:
    """A magic link token (should be rejected)."""
    return token_factory(token_type="magic_link")


@pytest.fixture
def onboarding_token(token_factory) -> str:
    """An onboarding token (should be rejected)."""
    return token_factory(token_type="onboarding")


@pytest.fixture
def valid_rs256_token(rs256_token_factory) -> str:
    """A valid, non-expired RS256 OAuth token."""
    return rs256_token_factory()


@pytest.fixture
def expired_rs256_token(rs256_token_factory) -> str:
    """An expired RS256 OAuth token."""
    return rs256_token_factory(expired=True)


# =============================================================================
# Auth Context Fixtures
# =============================================================================


@pytest.fixture
def user_context():
    """An OAuthContext for a regular user."""
    from opengander_mcp.auth import OAuthContext

    return OAuthContext(
        subject="user-123",
        user_id="user-123",
        email="user@example.com",
        home_tenant_id="tenant-123",
        role="user",
        allowed_tenant_ids=["tenant-123"],
        scopes=["mcp:read", "schema:read", "health:read"],
    )


@pytest.fixture
def admin_context():
    """An OAuthContext for an admin user."""
    from opengander_mcp.auth import OAuthContext

    return OAuthContext(
        subject="admin-123",
        user_id="admin-123",
        email="admin@example.com",
        home_tenant_id="tenant-123",
        role="admin",
        allowed_tenant_ids=["tenant-123", "tenant-456"],
        scopes=["mcp:read", "schema:read", "health:read"],
    )


@pytest.fixture
def superadmin_context():
    """An OAuthContext for a superadmin user."""
    from opengander_mcp.auth import OAuthContext

    return OAuthContext(
        subject="superadmin-123",
        user_id="superadmin-123",
        email="superadmin@example.com",
        home_tenant_id="",
        role="superadmin",
        allowed_tenant_ids=["tenant-123", "tenant-456", "tenant-789"],
        scopes=["mcp:read", "schema:read", "health:read"],
    )


# =============================================================================
# JWT Settings Fixtures
# =============================================================================


@pytest.fixture
def jwt_settings(jwt_secret: str):
    """Get JWT settings for HS256 testing."""
    from opengander_mcp.jwt_auth import JWTSettings

    return JWTSettings(
        jwt_secret=jwt_secret,
        jwt_algorithm="HS256",
    )


@pytest.fixture
def jwt_settings_rs256(jwt_secret: str):
    """Get JWT settings for RS256 testing."""
    from opengander_mcp.jwt_auth import JWTSettings

    return JWTSettings(
        jwt_secret=jwt_secret,
        jwt_algorithm="HS256",
        jwks_uri="https://app.opengander.io/api/.well-known/jwks.json",
        mcp_resource_uri="https://mcp.opengander.io",
        issuer="https://app.opengander.io",
    )


@pytest.fixture(autouse=True)
def reset_jwt_settings():
    """
    Auto-use fixture to reset JWT settings between tests.

    Ensures test isolation by resetting singleton instances.
    """
    yield

    # Reset JWT settings singleton
    from opengander_mcp import jwt_auth
    jwt_auth._jwt_settings = None


# =============================================================================
# Database Mocking
# =============================================================================


@pytest.fixture
def mock_db():
    """
    Mock the database module to avoid real ClickHouse connections.

    Returns an AsyncMock that can be configured per test.
    Patches at multiple locations to ensure comprehensive mocking.
    """
    mock_query = AsyncMock(return_value=[])
    mock_insert = AsyncMock()
    mock_ping = AsyncMock(return_value=True)

    with patch("opengander_mcp.db.execute_query", mock_query):
        with patch("opengander_mcp.db.insert_rows", mock_insert):
            with patch("opengander_mcp.db.ping", mock_ping):
                # Also patch at the import locations in other modules
                with patch("opengander_mcp.tenant.execute_query", mock_query):
                    with patch("opengander_mcp.audit.insert_rows", mock_insert):
                        yield {
                            "execute_query": mock_query,
                            "insert_rows": mock_insert,
                            "ping": mock_ping,
                        }


# =============================================================================
# Mock JWT Settings for Tests
# =============================================================================


@pytest.fixture
def mock_jwt_settings(jwt_secret: str):
    """
    Mock JWT settings to use the test secret for HS256.

    This fixture patches the get_jwt_settings function to return
    settings with the test secret.
    """
    from opengander_mcp.jwt_auth import JWTSettings

    test_settings = JWTSettings(
        jwt_secret=jwt_secret,
        jwt_algorithm="HS256",
    )

    with patch("opengander_mcp.jwt_auth.get_jwt_settings", return_value=test_settings):
        yield test_settings


@pytest.fixture
def mock_jwt_settings_rs256(jwt_secret: str):
    """
    Mock JWT settings for RS256 testing.

    This fixture patches the get_jwt_settings function to return
    settings with RS256 configuration.
    """
    from opengander_mcp.jwt_auth import JWTSettings

    test_settings = JWTSettings(
        jwt_secret=jwt_secret,
        jwt_algorithm="HS256",
        jwks_uri="https://app.opengander.io/api/.well-known/jwks.json",
        mcp_resource_uri="https://mcp.opengander.io",
        issuer="https://app.opengander.io",
    )

    with patch("opengander_mcp.jwt_auth.get_jwt_settings", return_value=test_settings):
        yield test_settings


# =============================================================================
# JWKS Client Mocking
# =============================================================================


@pytest.fixture
def mock_jwks_client(rsa_public_key):
    """
    Mock JWKS client that returns the test RSA public key.

    Useful for testing JWT verification without making HTTP calls.
    """
    from opengander_mcp.jwks import JWKSClient

    mock_client = AsyncMock(spec=JWKSClient)
    mock_client.get_signing_key = AsyncMock(return_value=rsa_public_key)

    return mock_client
