"""
JWKS (JSON Web Key Set) client for RS256 token validation.

Fetches and caches public keys from a JWKS endpoint for validating
RS256-signed JWTs issued by the OpenGander authorization server.

Key Features:
- Async HTTP requests using httpx
- In-memory caching with configurable TTL (default 1 hour)
- Key lookup by kid (key ID) or fallback to first key
- Thread-safe caching with TTLCache
"""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx
from cachetools import TTLCache
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey
from jwt.algorithms import RSAAlgorithm

logger = logging.getLogger(__name__)


class JWKSClientError(Exception):
    """Base exception for JWKS client errors."""

    pass


class JWKSFetchError(JWKSClientError):
    """Raised when JWKS endpoint cannot be reached or returns invalid data."""

    pass


class KeyNotFoundError(JWKSClientError):
    """Raised when the requested key ID is not found in JWKS."""

    pass


class JWKSClient:
    """
    Client for fetching and caching JWKS (JSON Web Key Sets).

    Provides async methods to retrieve RSA public keys for JWT validation.
    Keys are cached in memory with a configurable TTL to minimize network
    requests to the JWKS endpoint.

    Example:
        client = JWKSClient("https://app.opengander.io/api/.well-known/jwks.json")
        key = await client.get_signing_key(kid="key-id-from-jwt-header")
    """

    def __init__(
        self,
        jwks_uri: str,
        cache_ttl: int = 3600,
        http_timeout: float = 10.0,
    ):
        """
        Initialize the JWKS client.

        Args:
            jwks_uri: URL to fetch JWKS from (e.g., https://app.opengander.io/api/.well-known/jwks.json)
            cache_ttl: Cache time-to-live in seconds (default 1 hour)
            http_timeout: HTTP request timeout in seconds (default 10s)
        """
        self.jwks_uri = jwks_uri
        self.cache_ttl = cache_ttl
        self.http_timeout = http_timeout

        # Cache stores the full JWKS response
        # Key is the URI, value is the parsed JWKS dict
        self._cache: TTLCache[str, dict[str, Any]] = TTLCache(maxsize=10, ttl=cache_ttl)

        # Track last fetch time for logging
        self._last_fetch_time: float | None = None

    async def get_signing_key(self, kid: str | None = None) -> RSAPublicKey:
        """
        Get the RSA public key for verifying JWTs.

        Fetches the JWKS from the endpoint (or uses cached version) and
        returns the appropriate public key based on the key ID.

        Args:
            kid: Key ID from JWT header (can be None for single-key JWKS)

        Returns:
            RSA public key for verification

        Raises:
            JWKSFetchError: If JWKS cannot be fetched or parsed
            KeyNotFoundError: If the requested key ID is not found
        """
        jwks = await self._get_jwks()
        return self._find_key(jwks, kid)

    async def _get_jwks(self) -> dict[str, Any]:
        """
        Get JWKS from cache or fetch from endpoint.

        Returns:
            Parsed JWKS dictionary

        Raises:
            JWKSFetchError: If fetch fails
        """
        # Check cache first
        if self.jwks_uri in self._cache:
            logger.debug("JWKS cache hit for %s", self.jwks_uri)
            return self._cache[self.jwks_uri]

        # Cache miss - fetch from endpoint
        logger.info("Fetching JWKS from %s", self.jwks_uri)
        return await self._fetch_jwks()

    async def _fetch_jwks(self) -> dict[str, Any]:
        """
        Fetch JWKS from the endpoint.

        Returns:
            Parsed JWKS dictionary

        Raises:
            JWKSFetchError: If fetch fails
        """
        try:
            async with httpx.AsyncClient(timeout=self.http_timeout) as client:
                response = await client.get(self.jwks_uri)
                response.raise_for_status()

                jwks = response.json()
                self._validate_jwks(jwks)

                # Cache the response
                self._cache[self.jwks_uri] = jwks
                self._last_fetch_time = time.time()

                logger.info(
                    "JWKS fetched successfully: %d keys",
                    len(jwks.get("keys", [])),
                )
                return jwks

        except httpx.TimeoutException as e:
            logger.error("JWKS fetch timeout: %s", self.jwks_uri)
            raise JWKSFetchError(f"Timeout fetching JWKS from {self.jwks_uri}") from e

        except httpx.HTTPStatusError as e:
            logger.error("JWKS fetch HTTP error: %d", e.response.status_code)
            raise JWKSFetchError(
                f"HTTP {e.response.status_code} fetching JWKS from {self.jwks_uri}"
            ) from e

        except httpx.RequestError as e:
            logger.error("JWKS fetch request error: %s", e)
            raise JWKSFetchError(f"Request error fetching JWKS: {e}") from e

        except ValueError as e:
            logger.error("JWKS fetch JSON parse error: %s", e)
            raise JWKSFetchError(f"Invalid JSON in JWKS response: {e}") from e

    def _validate_jwks(self, jwks: dict[str, Any]) -> None:
        """
        Validate the structure of a JWKS response.

        Args:
            jwks: The parsed JWKS dictionary

        Raises:
            JWKSFetchError: If JWKS structure is invalid
        """
        if not isinstance(jwks, dict):
            raise JWKSFetchError("JWKS response is not a JSON object")

        keys = jwks.get("keys")
        if not isinstance(keys, list):
            raise JWKSFetchError("JWKS response missing 'keys' array")

        if len(keys) == 0:
            raise JWKSFetchError("JWKS response has no keys")

        # Validate each key has required fields for RSA
        for i, key in enumerate(keys):
            if not isinstance(key, dict):
                raise JWKSFetchError(f"JWKS key {i} is not a JSON object")

            kty = key.get("kty")
            if kty != "RSA":
                logger.warning("JWKS key %d has unsupported type: %s", i, kty)
                continue

            # RSA keys must have n and e
            if "n" not in key or "e" not in key:
                raise JWKSFetchError(f"JWKS RSA key {i} missing 'n' or 'e' parameter")

    def _find_key(self, jwks: dict[str, Any], kid: str | None) -> RSAPublicKey:
        """
        Find and return the RSA public key from JWKS.

        Args:
            jwks: The parsed JWKS dictionary
            kid: Key ID to find (can be None)

        Returns:
            RSA public key

        Raises:
            KeyNotFoundError: If key cannot be found
        """
        keys = jwks.get("keys", [])

        # Filter to RSA keys only
        rsa_keys = [k for k in keys if k.get("kty") == "RSA"]

        if not rsa_keys:
            raise KeyNotFoundError("No RSA keys found in JWKS")

        # Find key by kid if provided
        if kid:
            for key in rsa_keys:
                if key.get("kid") == kid:
                    return self._jwk_to_public_key(key)

            raise KeyNotFoundError(f"Key with kid '{kid}' not found in JWKS")

        # No kid provided - use first RSA key
        logger.debug("No kid provided, using first RSA key")
        return self._jwk_to_public_key(rsa_keys[0])

    def _jwk_to_public_key(self, jwk: dict[str, Any]) -> RSAPublicKey:
        """
        Convert a JWK dictionary to an RSA public key.

        Args:
            jwk: The JWK dictionary

        Returns:
            RSA public key

        Raises:
            KeyNotFoundError: If conversion fails
        """
        try:
            # PyJWT's RSAAlgorithm.from_jwk handles the conversion
            import json

            public_key = RSAAlgorithm.from_jwk(json.dumps(jwk))

            if not isinstance(public_key, RSAPublicKey):
                raise KeyNotFoundError("JWK did not produce an RSA public key")

            return public_key

        except Exception as e:
            logger.error("Failed to convert JWK to RSA key: %s", e)
            raise KeyNotFoundError(f"Invalid JWK: {e}") from e

    def clear_cache(self) -> None:
        """Clear the JWKS cache. Useful for testing or forced refresh."""
        self._cache.clear()
        logger.info("JWKS cache cleared")

    async def refresh(self) -> dict[str, Any]:
        """
        Force refresh the JWKS cache.

        Returns:
            The freshly fetched JWKS

        Raises:
            JWKSFetchError: If fetch fails
        """
        self.clear_cache()
        return await self._fetch_jwks()
