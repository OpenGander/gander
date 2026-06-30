"""
JWT authentication supporting both HS256 session tokens and RS256 OAuth tokens.

Two authentication methods are supported:

1. HS256 Session Tokens (existing):
   - Signed with JWT_SECRET shared secret
   - Issued by the OpenGander web app
   - Token type must be "session"
   - Contains userId, tenantId, role claims

2. RS256 OAuth Tokens (new):
   - Signed with RSA private key, validated via JWKS endpoint
   - Issued by the OAuth authorization server
   - Must have iss (issuer) and aud (audience) claims
   - Scopes extracted from "scope" claim (space-separated)

Algorithm selection is automatic based on the token's "alg" header.
"""

from __future__ import annotations

import logging
from typing import Any

import jwt
from fastmcp.server.auth import AccessToken, TokenVerifier
from pydantic_settings import BaseSettings, SettingsConfigDict

from .audit import log_failed_auth
from .auth import OAuthContext
from .jwks import JWKSClient, JWKSClientError
from .revocation import is_token_revoked
from .scopes import SUPPORTED_SCOPES
from .tenant import Role, get_tenant_scope

logger = logging.getLogger(__name__)


class JWTSettings(BaseSettings):
    """JWT configuration from environment variables."""

    model_config = SettingsConfigDict(env_prefix="", case_sensitive=False)

    # HS256 session token settings (existing)
    jwt_secret: str = ""
    jwt_algorithm: str = "HS256"

    # RS256 OAuth token settings (new)
    jwks_uri: str = ""
    mcp_resource_uri: str = "https://mcp.opengander.io"
    issuer: str = "https://app.opengander.io"


# Singleton settings instance
_jwt_settings: JWTSettings | None = None


def get_jwt_settings() -> JWTSettings:
    """Get the JWT settings singleton."""
    global _jwt_settings
    if _jwt_settings is None:
        _jwt_settings = JWTSettings()
    return _jwt_settings


def reset_jwt_settings() -> None:
    """Reset the settings singleton (for testing)."""
    global _jwt_settings
    _jwt_settings = None


class JWTTokenVerifier(TokenVerifier):
    """
    Validates JWTs for MCP access - supports both HS256 and RS256.

    HS256: Uses JWT_SECRET for session tokens from the web app
    RS256: Uses JWKS endpoint for OAuth access tokens

    Algorithm is selected automatically based on token header.
    """

    def __init__(
        self,
        settings: JWTSettings | None = None,
        jwks_client: JWKSClient | None = None,
    ):
        super().__init__()
        self.settings = settings or get_jwt_settings()
        self._jwks_client = jwks_client

    @property
    def jwks_client(self) -> JWKSClient | None:
        """Lazy-initialize JWKS client when needed."""
        if self._jwks_client is None and self.settings.jwks_uri:
            self._jwks_client = JWKSClient(self.settings.jwks_uri)
        return self._jwks_client

    async def verify_token(self, token: str) -> AccessToken | None:
        """
        Verify a JWT and return an AccessToken.

        Automatically selects verification method based on token algorithm:
        - RS256: Validates via JWKS endpoint with audience/issuer checks
        - HS256: Validates with JWT_SECRET for session tokens

        Args:
            token: The JWT from the Authorization header (Bearer token)

        Returns:
            AccessToken if valid, None if authentication fails
        """
        try:
            # Decode header to determine algorithm
            header = jwt.get_unverified_header(token)
            alg = header.get("alg", "HS256")

            if alg == "RS256":
                return await self._verify_rs256_token(token, header)
            elif alg == "HS256":
                return await self._verify_hs256_token(token)
            else:
                logger.warning("Unsupported JWT algorithm: %s", alg)
                await log_failed_auth(
                    reason="unsupported_algorithm",
                    error_details=f"Unsupported algorithm: {alg}",
                )
                return None

        except jwt.DecodeError as e:
            logger.warning("Failed to decode JWT header: %s", e)
            await log_failed_auth(
                reason="decode_error",
                error_details=str(e),
            )
            return None

        except Exception as e:
            logger.error("Unexpected JWT authentication error: %s", e)
            await log_failed_auth(
                reason="unexpected_error",
                error_details=str(e),
            )
            return None

    async def _verify_rs256_token(
        self,
        token: str,
        header: dict[str, Any],
    ) -> AccessToken | None:
        """
        Verify an RS256-signed OAuth token.

        Validates:
        - Signature via JWKS-fetched public key
        - Issuer (iss) matches expected issuer
        - Audience (aud) matches MCP_RESOURCE_URI
        - Token is not expired

        Args:
            token: The JWT to verify
            header: The decoded JWT header

        Returns:
            AccessToken if valid, None if authentication fails
        """
        if not self.settings.jwks_uri:
            logger.error("JWKS_URI not configured - RS256 authentication disabled")
            await log_failed_auth(
                reason="configuration_error",
                error_details="JWKS_URI not configured",
            )
            return None

        if self.jwks_client is None:
            logger.error("JWKS client not initialized")
            await log_failed_auth(
                reason="configuration_error",
                error_details="JWKS client not initialized",
            )
            return None

        try:
            # Get the key ID from header
            kid = header.get("kid")

            # Fetch public key from JWKS
            public_key = await self.jwks_client.get_signing_key(kid)

            # Accept both base resource URI and common path variants
            # Some clients may use the endpoint URL instead of the resource URI
            base_uri = self.settings.mcp_resource_uri.rstrip("/")
            allowed_audiences = [
                base_uri,
                f"{base_uri}/",
                f"{base_uri}/mcp",
                f"{base_uri}/mcp/",
            ]

            # Decode and verify the token
            payload = jwt.decode(
                token,
                public_key,
                algorithms=["RS256"],
                audience=allowed_audiences,
                issuer=self.settings.issuer,
                options={
                    "verify_exp": True,
                    "verify_iat": True,
                    "verify_aud": True,
                    "verify_iss": True,
                    "require": ["exp", "iat", "iss", "aud", "sub"],
                },
            )

            # Check if token has been revoked
            if await is_token_revoked(token):
                logger.warning("RS256 JWT has been revoked")
                await log_failed_auth(
                    reason="token_revoked",
                    error_details="Token has been revoked",
                )
                return None

            # Extract user info from claims
            subject = payload.get("sub", "")
            email = payload.get("email", "")

            # For OAuth tokens, we may have user_id and tenant_id in custom claims
            user_id = payload.get("user_id", subject)
            tenant_id = payload.get("tenant_id", payload.get("home_tenant_id", ""))
            role: Role = payload.get("role", "user")

            # Extract scopes from space-separated scope claim
            scope_claim = payload.get("scope", "")
            if isinstance(scope_claim, str):
                token_scopes = scope_claim.split() if scope_claim else []
            else:
                token_scopes = scope_claim if isinstance(scope_claim, list) else []

            # Filter to only supported scopes
            scopes = [s for s in token_scopes if s in SUPPORTED_SCOPES]
            if not scopes:
                # Default to minimal scope - users must explicitly request permissions
                scopes = ["health:read"]
                logger.warning(
                    "Token missing scope claim, defaulting to health:read: sub=%s",
                    subject,
                )

            # Get tenant scope based on role
            if tenant_id:
                allowed_tenant_ids = await get_tenant_scope(
                    user_id=user_id,
                    home_tenant_id=tenant_id,
                    role=role,
                )
            else:
                # No tenant_id - allow only if superadmin
                if role == "superadmin":
                    allowed_tenant_ids = await get_tenant_scope(
                        user_id=user_id,
                        home_tenant_id="",
                        role=role,
                    )
                else:
                    logger.warning(
                        "OAuth token missing tenant_id for non-superadmin: %s",
                        subject,
                    )
                    allowed_tenant_ids = []

            # Filter out empty tenant IDs
            allowed_tenant_ids = [tid for tid in allowed_tenant_ids if tid]

            logger.info(
                "RS256 OAuth authenticated: sub=%s, scopes=%d, tenants=%d",
                subject,
                len(scopes),
                len(allowed_tenant_ids),
            )

            # Create OAuthContext
            oauth_context = OAuthContext(
                subject=subject,
                user_id=user_id,
                email=email,
                home_tenant_id=tenant_id,
                role=role,
                allowed_tenant_ids=allowed_tenant_ids,
                scopes=scopes,
            )

            return AccessToken(
                token=token,
                client_id=subject,
                scopes=scopes,
                claims={"oauth_context": oauth_context.to_dict()},
            )

        except JWKSClientError as e:
            logger.warning("JWKS error: %s", e)
            await log_failed_auth(
                reason="jwks_error",
                error_details=str(e),
            )
            return None

        except jwt.ExpiredSignatureError:
            logger.warning("RS256 JWT expired")
            await log_failed_auth(
                reason="token_expired",
                error_details="OAuth token has expired",
            )
            return None

        except jwt.InvalidAudienceError:
            logger.warning("RS256 JWT invalid audience")
            await log_failed_auth(
                reason="invalid_audience",
                error_details=f"Expected audience: {self.settings.mcp_resource_uri} (or /mcp variant)",
            )
            return None

        except jwt.InvalidIssuerError:
            logger.warning("RS256 JWT invalid issuer")
            await log_failed_auth(
                reason="invalid_issuer",
                error_details=f"Expected issuer: {self.settings.issuer}",
            )
            return None

        except jwt.InvalidSignatureError:
            logger.warning("RS256 JWT has invalid signature")
            await log_failed_auth(
                reason="invalid_signature",
                error_details="Token signature verification failed",
            )
            return None

        except jwt.MissingRequiredClaimError as e:
            logger.warning("RS256 JWT missing required claim: %s", e)
            await log_failed_auth(
                reason="missing_claim",
                error_details=str(e),
            )
            return None

        except jwt.DecodeError as e:
            logger.warning("Failed to decode RS256 JWT: %s", e)
            await log_failed_auth(
                reason="decode_error",
                error_details=str(e),
            )
            return None

    async def _verify_hs256_token(self, token: str) -> AccessToken | None:
        """
        Verify an HS256-signed session token.

        This is the original web app session token flow.

        Args:
            token: The JWT to verify

        Returns:
            AccessToken if valid, None if authentication fails
        """
        if not self.settings.jwt_secret:
            logger.error("JWT_SECRET not configured - authentication disabled")
            await log_failed_auth(
                reason="configuration_error",
                error_details="JWT_SECRET not configured",
            )
            return None

        try:
            # Decode and verify the token
            payload = jwt.decode(
                token,
                self.settings.jwt_secret,
                algorithms=[self.settings.jwt_algorithm],
                options={
                    "verify_exp": True,
                    "verify_iat": True,
                    "require": ["exp", "iat", "type", "userId", "tenantId", "role"],
                },
            )

            # Validate token type - only accept session tokens
            token_type = payload.get("type")
            if token_type != "session":
                logger.warning(
                    "Rejected non-session token type: %s", token_type
                )
                await log_failed_auth(
                    reason="invalid_token_type",
                    error_details=f"Expected 'session', got '{token_type}'",
                )
                return None

            # Extract claims from web app format
            user_id = payload.get("userId", "")
            email = payload.get("email", "")
            tenant_id = payload.get("tenantId", "")
            role: Role = payload.get("role", "user")

            # Validate role
            if role not in ("superadmin", "admin", "moderator", "user"):
                logger.error("Invalid role in JWT: %s", role)
                await log_failed_auth(
                    reason="invalid_role",
                    user_id=user_id,
                    error_details=f"Invalid role: {role}",
                )
                return None

            # Get tenant scope based on role
            if tenant_id:
                allowed_tenant_ids = await get_tenant_scope(
                    user_id=user_id,
                    home_tenant_id=tenant_id,
                    role=role,
                )
            else:
                # No tenant_id - allow only if superadmin
                if role == "superadmin":
                    allowed_tenant_ids = await get_tenant_scope(
                        user_id=user_id,
                        home_tenant_id="",
                        role=role,
                    )
                else:
                    logger.warning(
                        "JWT missing tenantId for non-superadmin user: %s",
                        user_id,
                    )
                    allowed_tenant_ids = []

            # Filter out any empty tenant IDs
            allowed_tenant_ids = [tid for tid in allowed_tenant_ids if tid]

            # All session tokens get full MCP scopes
            scopes = list(SUPPORTED_SCOPES)

            logger.info(
                "HS256 JWT authenticated: user_id=%s, role=%s, tenants=%d",
                user_id,
                role,
                len(allowed_tenant_ids),
            )

            # Create OAuthContext (reuse existing dataclass for compatibility)
            oauth_context = OAuthContext(
                subject=user_id,  # Use userId as subject for session tokens
                user_id=user_id,
                email=email,
                home_tenant_id=tenant_id,
                role=role,
                allowed_tenant_ids=allowed_tenant_ids,
                scopes=scopes,
            )

            # Return AccessToken with context in claims
            return AccessToken(
                token=token,
                client_id=user_id,
                scopes=scopes,
                claims={"oauth_context": oauth_context.to_dict()},
            )

        except jwt.ExpiredSignatureError:
            logger.warning("HS256 JWT expired")
            await log_failed_auth(
                reason="token_expired",
                error_details="Session token has expired",
            )
            return None

        except jwt.InvalidSignatureError:
            logger.warning("HS256 JWT has invalid signature")
            await log_failed_auth(
                reason="invalid_signature",
                error_details="Token signature verification failed",
            )
            return None

        except jwt.DecodeError as e:
            logger.warning("Failed to decode HS256 JWT: %s", e)
            await log_failed_auth(
                reason="decode_error",
                error_details=str(e),
            )
            return None

        except jwt.MissingRequiredClaimError as e:
            logger.warning("HS256 JWT missing required claim: %s", e)
            await log_failed_auth(
                reason="missing_claim",
                error_details=str(e),
            )
            return None
