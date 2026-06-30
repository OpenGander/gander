"""
Tests for JWT authentication in jwt_auth.py and auth context in auth.py.

Tests cover:
- OAuthContext methods (can_use_tool, can_access_tenant)
- JWTTokenVerifier token validation (HS256 session tokens)
- JWTTokenVerifier RS256 OAuth token validation
- Role validation
- Token type validation (session vs magic_link vs onboarding)
- Empty tenant ID handling
- get_auth_context extraction
- Failed auth audit logging
- Audience and issuer validation for RS256
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestOAuthContext:
    """Tests for OAuthContext class."""

    def test_can_use_tool_with_valid_scope(self, user_context):
        """can_use_tool should return True for granted scopes."""
        assert user_context.can_use_tool("get_overview") is True
        assert user_context.can_use_tool("list_tables") is True
        assert user_context.can_use_tool("health_check") is True

    def test_can_use_tool_without_scope(self):
        """can_use_tool should return False for missing scopes."""
        from opengander_mcp.auth import OAuthContext

        context = OAuthContext(
            subject="test",
            user_id="user-123",
            email="test@example.com",
            home_tenant_id="tenant-123",
            role="user",
            allowed_tenant_ids=["tenant-123"],
            scopes=["health:read"],  # Only health scope
        )

        # Has health:read
        assert context.can_use_tool("health_check") is True

        # Missing mcp:read
        assert context.can_use_tool("get_overview") is False

    def test_can_use_tool_unknown_tool(self, user_context):
        """can_use_tool should return False for unknown tools."""
        assert user_context.can_use_tool("unknown_tool") is False

    def test_can_access_tenant_allowed(self, user_context):
        """can_access_tenant should return True for allowed tenants."""
        assert user_context.can_access_tenant("tenant-123") is True

    def test_can_access_tenant_not_allowed(self, user_context):
        """can_access_tenant should return False for non-allowed tenants."""
        assert user_context.can_access_tenant("other-tenant") is False

    def test_admin_can_access_multiple_tenants(self, admin_context):
        """Admin should access home tenant and child tenants."""
        assert admin_context.can_access_tenant("tenant-123") is True
        assert admin_context.can_access_tenant("tenant-456") is True

    def test_to_dict_serialization(self, user_context):
        """to_dict should serialize all fields."""
        data = user_context.to_dict()

        assert data["subject"] == "user-123"
        assert data["user_id"] == "user-123"
        assert data["email"] == "user@example.com"
        assert data["home_tenant_id"] == "tenant-123"
        assert data["role"] == "user"
        assert "tenant-123" in data["allowed_tenant_ids"]
        assert "mcp:read" in data["scopes"]


class TestJWTTokenVerifierHS256:
    """Tests for JWTTokenVerifier HS256 (session token) validation."""

    @pytest.mark.asyncio
    async def test_valid_token_returns_access_token(
        self, valid_token, mock_jwt_settings, mock_db
    ):
        """Valid HS256 token should return AccessToken with OAuthContext."""
        from opengander_mcp.jwt_auth import JWTTokenVerifier

        mock_db["execute_query"].return_value = []

        verifier = JWTTokenVerifier(settings=mock_jwt_settings)
        result = await verifier.verify_token(valid_token)

        assert result is not None
        assert result.client_id == "user-123"
        assert "mcp:read" in result.scopes
        assert "oauth_context" in result.claims

    @pytest.mark.asyncio
    async def test_invalid_token_returns_none(self, mock_jwt_settings, mock_db):
        """Invalid token should return None."""
        from opengander_mcp.jwt_auth import JWTTokenVerifier

        verifier = JWTTokenVerifier(settings=mock_jwt_settings)
        result = await verifier.verify_token("invalid-token")

        assert result is None

    @pytest.mark.asyncio
    async def test_expired_token_returns_none(
        self, expired_token, mock_jwt_settings, mock_db
    ):
        """Expired token should return None."""
        from opengander_mcp.jwt_auth import JWTTokenVerifier

        verifier = JWTTokenVerifier(settings=mock_jwt_settings)
        result = await verifier.verify_token(expired_token)

        assert result is None

    @pytest.mark.asyncio
    async def test_invalid_role_returns_none(
        self, token_factory, mock_jwt_settings, mock_db
    ):
        """Token with invalid role should return None."""
        from opengander_mcp.jwt_auth import JWTTokenVerifier

        bad_token = token_factory(role="hacker")  # Invalid role

        verifier = JWTTokenVerifier(settings=mock_jwt_settings)
        result = await verifier.verify_token(bad_token)

        assert result is None

    @pytest.mark.asyncio
    async def test_magic_link_token_rejected(
        self, magic_link_token, mock_jwt_settings, mock_db
    ):
        """Magic link tokens should be rejected."""
        from opengander_mcp.jwt_auth import JWTTokenVerifier

        verifier = JWTTokenVerifier(settings=mock_jwt_settings)
        result = await verifier.verify_token(magic_link_token)

        assert result is None

    @pytest.mark.asyncio
    async def test_onboarding_token_rejected(
        self, onboarding_token, mock_jwt_settings, mock_db
    ):
        """Onboarding tokens should be rejected."""
        from opengander_mcp.jwt_auth import JWTTokenVerifier

        verifier = JWTTokenVerifier(settings=mock_jwt_settings)
        result = await verifier.verify_token(onboarding_token)

        assert result is None

    @pytest.mark.asyncio
    async def test_missing_tenant_id_for_non_superadmin(
        self, token_factory, mock_jwt_settings, mock_db
    ):
        """Non-superadmin without tenantId should get empty tenant list."""
        from opengander_mcp.jwt_auth import JWTTokenVerifier

        token = token_factory(tenantId="", role="user")

        mock_db["execute_query"].return_value = []

        verifier = JWTTokenVerifier(settings=mock_jwt_settings)
        result = await verifier.verify_token(token)

        assert result is not None
        context = result.claims["oauth_context"]
        assert context["allowed_tenant_ids"] == []

    @pytest.mark.asyncio
    async def test_superadmin_without_tenant_id_gets_all_tenants(
        self, token_factory, mock_jwt_settings, mock_db
    ):
        """Superadmin without tenantId should get all tenants."""
        from opengander_mcp.jwt_auth import JWTTokenVerifier

        token = token_factory(tenantId="", role="superadmin")

        # Mock returning all tenants for superadmin
        mock_db["execute_query"].return_value = [
            {"TenantId": "tenant-1"},
            {"TenantId": "tenant-2"},
            {"TenantId": "tenant-3"},
        ]

        verifier = JWTTokenVerifier(settings=mock_jwt_settings)
        result = await verifier.verify_token(token)

        assert result is not None
        context = result.claims["oauth_context"]
        assert "tenant-1" in context["allowed_tenant_ids"]
        assert "tenant-2" in context["allowed_tenant_ids"]

    @pytest.mark.asyncio
    async def test_filters_empty_tenant_ids(
        self, token_factory, mock_jwt_settings, mock_db
    ):
        """Empty tenant IDs should be filtered from allowed list."""
        from opengander_mcp.jwt_auth import JWTTokenVerifier

        token = token_factory(role="admin")

        # Mock returning some empty tenant IDs (edge case)
        mock_db["execute_query"].side_effect = [
            [{"TenantId": "tenant-1"}, {"TenantId": ""}],  # memberships
            [{"TenantId": "tenant-2"}],  # child tenants
        ]

        verifier = JWTTokenVerifier(settings=mock_jwt_settings)
        result = await verifier.verify_token(token)

        assert result is not None
        context = result.claims["oauth_context"]
        # Empty string should be filtered out
        assert "" not in context["allowed_tenant_ids"]

    @pytest.mark.asyncio
    async def test_no_jwt_secret_returns_none(self, valid_token, mock_db):
        """Missing JWT_SECRET should reject HS256 tokens."""
        from opengander_mcp.jwt_auth import JWTSettings, JWTTokenVerifier

        empty_settings = JWTSettings(jwt_secret="")

        verifier = JWTTokenVerifier(settings=empty_settings)
        result = await verifier.verify_token(valid_token)

        assert result is None

    @pytest.mark.asyncio
    async def test_wrong_signature_returns_none(
        self, token_factory, mock_db
    ):
        """Token signed with wrong secret should return None."""
        # Create token with different secret
        import jwt

        from opengander_mcp.jwt_auth import JWTSettings, JWTTokenVerifier
        payload = {
            "userId": "user-123",
            "email": "test@example.com",
            "tenantId": "tenant-123",
            "role": "user",
            "type": "session",
            "iat": 1000000000,
            "exp": 9999999999,
        }
        bad_token = jwt.encode(payload, "wrong-secret", algorithm="HS256")

        correct_settings = JWTSettings(jwt_secret="correct-secret-key-at-least-32-chars")

        verifier = JWTTokenVerifier(settings=correct_settings)
        result = await verifier.verify_token(bad_token)

        assert result is None

    @pytest.mark.asyncio
    async def test_logs_token_validation_failure(self, mock_jwt_settings, mock_db):
        """Failed token validation should log audit event."""
        from opengander_mcp.jwt_auth import JWTTokenVerifier

        with patch("opengander_mcp.jwt_auth.log_failed_auth", new_callable=AsyncMock) as mock_log:
            verifier = JWTTokenVerifier(settings=mock_jwt_settings)
            await verifier.verify_token("invalid-token")

            mock_log.assert_called_once()
            call_args = mock_log.call_args
            assert call_args.kwargs["reason"] == "decode_error"

    @pytest.mark.asyncio
    async def test_logs_invalid_role(
        self, token_factory, mock_jwt_settings, mock_db
    ):
        """Invalid role should log audit event."""
        from opengander_mcp.jwt_auth import JWTTokenVerifier

        bad_token = token_factory(role="invalid_role")

        with patch("opengander_mcp.jwt_auth.log_failed_auth", new_callable=AsyncMock) as mock_log:
            verifier = JWTTokenVerifier(settings=mock_jwt_settings)
            await verifier.verify_token(bad_token)

            mock_log.assert_called_once()
            call_args = mock_log.call_args
            assert call_args.kwargs["reason"] == "invalid_role"

    @pytest.mark.asyncio
    async def test_logs_invalid_token_type(
        self, magic_link_token, mock_jwt_settings, mock_db
    ):
        """Invalid token type should log audit event."""
        from opengander_mcp.jwt_auth import JWTTokenVerifier

        with patch("opengander_mcp.jwt_auth.log_failed_auth", new_callable=AsyncMock) as mock_log:
            verifier = JWTTokenVerifier(settings=mock_jwt_settings)
            await verifier.verify_token(magic_link_token)

            mock_log.assert_called_once()
            call_args = mock_log.call_args
            assert call_args.kwargs["reason"] == "invalid_token_type"


class TestJWTTokenVerifierRS256:
    """Tests for JWTTokenVerifier RS256 (OAuth token) validation."""

    @pytest.mark.asyncio
    async def test_valid_rs256_token_returns_access_token(
        self, valid_rs256_token, mock_jwt_settings_rs256, mock_jwks_client, mock_db
    ):
        """Valid RS256 token should return AccessToken with OAuthContext."""
        from opengander_mcp.jwt_auth import JWTTokenVerifier

        mock_db["execute_query"].return_value = []

        verifier = JWTTokenVerifier(
            settings=mock_jwt_settings_rs256,
            jwks_client=mock_jwks_client,
        )
        result = await verifier.verify_token(valid_rs256_token)

        assert result is not None
        assert result.client_id == "user-123"
        assert "mcp:read" in result.scopes
        assert "oauth_context" in result.claims

    @pytest.mark.asyncio
    async def test_expired_rs256_token_returns_none(
        self, expired_rs256_token, mock_jwt_settings_rs256, mock_jwks_client, mock_db
    ):
        """Expired RS256 token should return None."""
        from opengander_mcp.jwt_auth import JWTTokenVerifier

        verifier = JWTTokenVerifier(
            settings=mock_jwt_settings_rs256,
            jwks_client=mock_jwks_client,
        )
        result = await verifier.verify_token(expired_rs256_token)

        assert result is None

    @pytest.mark.asyncio
    async def test_invalid_audience_returns_none(
        self, rs256_token_factory, mock_jwt_settings_rs256, mock_jwks_client, mock_db
    ):
        """RS256 token with wrong audience should return None."""
        from opengander_mcp.jwt_auth import JWTTokenVerifier

        # Create token with wrong audience
        bad_token = rs256_token_factory(aud="https://wrong.audience.com")

        verifier = JWTTokenVerifier(
            settings=mock_jwt_settings_rs256,
            jwks_client=mock_jwks_client,
        )
        result = await verifier.verify_token(bad_token)

        assert result is None

    @pytest.mark.asyncio
    async def test_invalid_issuer_returns_none(
        self, rs256_token_factory, mock_jwt_settings_rs256, mock_jwks_client, mock_db
    ):
        """RS256 token with wrong issuer should return None."""
        from opengander_mcp.jwt_auth import JWTTokenVerifier

        # Create token with wrong issuer
        bad_token = rs256_token_factory(iss="https://wrong.issuer.com")

        verifier = JWTTokenVerifier(
            settings=mock_jwt_settings_rs256,
            jwks_client=mock_jwks_client,
        )
        result = await verifier.verify_token(bad_token)

        assert result is None

    @pytest.mark.asyncio
    async def test_extracts_scopes_from_space_separated_claim(
        self, rs256_token_factory, mock_jwt_settings_rs256, mock_jwks_client, mock_db
    ):
        """Should extract scopes from space-separated scope claim."""
        from opengander_mcp.jwt_auth import JWTTokenVerifier

        mock_db["execute_query"].return_value = []

        token = rs256_token_factory(scope="mcp:read health:read")

        verifier = JWTTokenVerifier(
            settings=mock_jwt_settings_rs256,
            jwks_client=mock_jwks_client,
        )
        result = await verifier.verify_token(token)

        assert result is not None
        assert "mcp:read" in result.scopes
        assert "health:read" in result.scopes

    @pytest.mark.asyncio
    async def test_no_jwks_uri_returns_none(
        self, valid_rs256_token, jwt_secret, mock_db
    ):
        """Missing JWKS_URI should reject RS256 tokens."""
        from opengander_mcp.jwt_auth import JWTSettings, JWTTokenVerifier

        settings = JWTSettings(
            jwt_secret=jwt_secret,
            jwks_uri="",  # No JWKS URI
        )

        verifier = JWTTokenVerifier(settings=settings)
        result = await verifier.verify_token(valid_rs256_token)

        assert result is None

    @pytest.mark.asyncio
    async def test_jwks_error_returns_none(
        self, valid_rs256_token, mock_jwt_settings_rs256, mock_db
    ):
        """JWKS fetch error should return None."""
        from opengander_mcp.jwks import JWKSFetchError
        from opengander_mcp.jwt_auth import JWTTokenVerifier

        mock_client = AsyncMock()
        mock_client.get_signing_key.side_effect = JWKSFetchError("Network error")

        verifier = JWTTokenVerifier(
            settings=mock_jwt_settings_rs256,
            jwks_client=mock_client,
        )
        result = await verifier.verify_token(valid_rs256_token)

        assert result is None

    @pytest.mark.asyncio
    async def test_logs_invalid_audience(
        self, rs256_token_factory, mock_jwt_settings_rs256, mock_jwks_client, mock_db
    ):
        """Invalid audience should log audit event."""
        from opengander_mcp.jwt_auth import JWTTokenVerifier

        bad_token = rs256_token_factory(aud="https://wrong.audience.com")

        with patch("opengander_mcp.jwt_auth.log_failed_auth", new_callable=AsyncMock) as mock_log:
            verifier = JWTTokenVerifier(
                settings=mock_jwt_settings_rs256,
                jwks_client=mock_jwks_client,
            )
            await verifier.verify_token(bad_token)

            mock_log.assert_called_once()
            call_args = mock_log.call_args
            assert call_args.kwargs["reason"] == "invalid_audience"

    @pytest.mark.asyncio
    async def test_logs_invalid_issuer(
        self, rs256_token_factory, mock_jwt_settings_rs256, mock_jwks_client, mock_db
    ):
        """Invalid issuer should log audit event."""
        from opengander_mcp.jwt_auth import JWTTokenVerifier

        bad_token = rs256_token_factory(iss="https://wrong.issuer.com")

        with patch("opengander_mcp.jwt_auth.log_failed_auth", new_callable=AsyncMock) as mock_log:
            verifier = JWTTokenVerifier(
                settings=mock_jwt_settings_rs256,
                jwks_client=mock_jwks_client,
            )
            await verifier.verify_token(bad_token)

            mock_log.assert_called_once()
            call_args = mock_log.call_args
            assert call_args.kwargs["reason"] == "invalid_issuer"

    @pytest.mark.asyncio
    async def test_unsupported_algorithm_returns_none(
        self, mock_jwt_settings, mock_db
    ):
        """Unsupported algorithm should return None."""
        import jwt

        from opengander_mcp.jwt_auth import JWTTokenVerifier
        # Create token with unsupported algorithm (ES256)
        # Just use a placeholder since we only check the header
        payload = {"sub": "test", "iat": 1000000000, "exp": 9999999999}
        # HS384 is technically supported by PyJWT but not by our verifier
        token = jwt.encode(payload, "secret", algorithm="HS384")

        with patch("opengander_mcp.jwt_auth.log_failed_auth", new_callable=AsyncMock) as mock_log:
            verifier = JWTTokenVerifier(settings=mock_jwt_settings)
            result = await verifier.verify_token(token)

            assert result is None
            mock_log.assert_called_once()
            call_args = mock_log.call_args
            assert call_args.kwargs["reason"] == "unsupported_algorithm"

    @pytest.mark.asyncio
    async def test_revoked_rs256_token_returns_none(
        self, valid_rs256_token, mock_jwt_settings_rs256, mock_jwks_client, mock_db
    ):
        """Revoked RS256 token should return None."""
        from opengander_mcp.jwt_auth import JWTTokenVerifier

        mock_db["execute_query"].return_value = []

        with patch("opengander_mcp.jwt_auth.is_token_revoked", new_callable=AsyncMock) as mock_revoked:
            mock_revoked.return_value = True

            verifier = JWTTokenVerifier(
                settings=mock_jwt_settings_rs256,
                jwks_client=mock_jwks_client,
            )
            result = await verifier.verify_token(valid_rs256_token)

            assert result is None
            mock_revoked.assert_called_once_with(valid_rs256_token)

    @pytest.mark.asyncio
    async def test_revoked_token_logs_audit(
        self, valid_rs256_token, mock_jwt_settings_rs256, mock_jwks_client, mock_db
    ):
        """Revoked token should log audit event."""
        from opengander_mcp.jwt_auth import JWTTokenVerifier

        mock_db["execute_query"].return_value = []

        with patch("opengander_mcp.jwt_auth.is_token_revoked", new_callable=AsyncMock) as mock_revoked:
            mock_revoked.return_value = True

            with patch("opengander_mcp.jwt_auth.log_failed_auth", new_callable=AsyncMock) as mock_log:
                verifier = JWTTokenVerifier(
                    settings=mock_jwt_settings_rs256,
                    jwks_client=mock_jwks_client,
                )
                await verifier.verify_token(valid_rs256_token)

                mock_log.assert_called_once()
                call_args = mock_log.call_args
                assert call_args.kwargs["reason"] == "token_revoked"


class TestGetAuthContext:
    """Tests for get_auth_context function."""

    def test_extracts_context_from_fastmcp_context(self):
        """Should extract OAuthContext from FastMCP's get_access_token."""
        from opengander_mcp.auth import OAuthContext, get_auth_context

        # Mock the access token returned by FastMCP's get_access_token
        mock_access_token = MagicMock()
        mock_access_token.claims = {
            "oauth_context": {
                "subject": "user-123",
                "user_id": "user-123",
                "email": "test@example.com",
                "home_tenant_id": "tenant-123",
                "role": "user",
                "allowed_tenant_ids": ["tenant-123"],
                "scopes": ["mcp:read"],
            }
        }

        # Patch get_access_token to return our mock token
        with patch("opengander_mcp.auth.get_access_token", return_value=mock_access_token):
            context = get_auth_context(None)  # ctx is unused now

        assert isinstance(context, OAuthContext)
        assert context.user_id == "user-123"
        assert context.role == "user"

    def test_raises_on_missing_access_token(self):
        """Should raise ValueError when get_access_token returns None."""
        from opengander_mcp.auth import get_auth_context

        # Patch get_access_token to return None
        with patch("opengander_mcp.auth.get_access_token", return_value=None):
            with pytest.raises(ValueError, match="missing access_token"):
                get_auth_context(None)

    def test_raises_on_missing_oauth_context(self):
        """Should raise ValueError when oauth_context is missing from claims."""
        from opengander_mcp.auth import get_auth_context

        mock_access_token = MagicMock()
        mock_access_token.claims = {}

        # Patch get_access_token to return token without oauth_context
        with patch("opengander_mcp.auth.get_access_token", return_value=mock_access_token):
            with pytest.raises(ValueError, match="No oauth_context found"):
                get_auth_context(None)
