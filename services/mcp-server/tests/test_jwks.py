"""
Tests for JWKS client in jwks.py.

Tests cover:
- JWKS fetching and caching
- Key lookup by kid
- Error handling for network failures
- Error handling for invalid JWKS responses
- Cache TTL behavior
"""

from __future__ import annotations

import json

import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey
from jwt.algorithms import RSAAlgorithm

from opengander_mcp.jwks import (
    JWKSClient,
    JWKSFetchError,
    KeyNotFoundError,
)

# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def rsa_keypair():
    """Generate an RSA key pair for testing."""
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )
    public_key = private_key.public_key()
    return private_key, public_key


@pytest.fixture
def jwk_from_keypair(rsa_keypair):
    """Create a JWK from the test RSA key pair."""
    _, public_key = rsa_keypair

    # Convert to JWK format
    jwk_dict = json.loads(RSAAlgorithm.to_jwk(public_key))
    jwk_dict["kid"] = "test-key-id"
    jwk_dict["use"] = "sig"
    jwk_dict["alg"] = "RS256"

    return jwk_dict


@pytest.fixture
def jwks_response(jwk_from_keypair):
    """Create a valid JWKS response."""
    return {"keys": [jwk_from_keypair]}


@pytest.fixture
def jwks_response_multiple_keys(jwk_from_keypair):
    """Create a JWKS response with multiple keys."""
    key1 = {**jwk_from_keypair, "kid": "key-1"}
    key2 = {**jwk_from_keypair, "kid": "key-2"}
    return {"keys": [key1, key2]}


@pytest.fixture
def jwks_client():
    """Create a JWKS client for testing."""
    return JWKSClient(
        jwks_uri="https://example.com/.well-known/jwks.json",
        cache_ttl=3600,
    )


# =============================================================================
# Basic Functionality Tests
# =============================================================================


class TestJWKSClientBasic:
    """Basic JWKS client functionality tests."""

    def test_init_with_defaults(self):
        """Client should initialize with default values."""
        client = JWKSClient("https://example.com/jwks")
        assert client.jwks_uri == "https://example.com/jwks"
        assert client.cache_ttl == 3600
        assert client.http_timeout == 10.0

    def test_init_with_custom_values(self):
        """Client should accept custom TTL and timeout."""
        client = JWKSClient(
            "https://example.com/jwks",
            cache_ttl=1800,
            http_timeout=5.0,
        )
        assert client.cache_ttl == 1800
        assert client.http_timeout == 5.0


# =============================================================================
# JWKS Fetching Tests
# =============================================================================


class TestJWKSFetching:
    """Tests for JWKS fetching behavior."""

    @pytest.mark.asyncio
    async def test_fetches_jwks_on_first_call(self, jwks_client, jwks_response, httpx_mock):
        """First call should fetch JWKS from endpoint."""
        httpx_mock.add_response(
            url="https://example.com/.well-known/jwks.json",
            json=jwks_response,
        )

        key = await jwks_client.get_signing_key()

        assert isinstance(key, RSAPublicKey)
        assert len(httpx_mock.get_requests()) == 1

    @pytest.mark.asyncio
    async def test_uses_cache_on_subsequent_calls(self, jwks_client, jwks_response, httpx_mock):
        """Subsequent calls should use cached JWKS."""
        httpx_mock.add_response(
            url="https://example.com/.well-known/jwks.json",
            json=jwks_response,
        )

        # First call fetches
        await jwks_client.get_signing_key()

        # Second call should use cache
        await jwks_client.get_signing_key()

        # Only one HTTP request should have been made
        assert len(httpx_mock.get_requests()) == 1

    @pytest.mark.asyncio
    async def test_refresh_clears_cache(self, jwks_client, jwks_response, httpx_mock):
        """Refresh should clear cache and fetch fresh JWKS."""
        httpx_mock.add_response(
            url="https://example.com/.well-known/jwks.json",
            json=jwks_response,
        )

        # First fetch
        await jwks_client.get_signing_key()
        assert len(httpx_mock.get_requests()) == 1

        # Add another response for refresh
        httpx_mock.add_response(
            url="https://example.com/.well-known/jwks.json",
            json=jwks_response,
        )

        # Refresh
        await jwks_client.refresh()
        assert len(httpx_mock.get_requests()) == 2

    @pytest.mark.asyncio
    async def test_clear_cache(self, jwks_client, jwks_response, httpx_mock):
        """clear_cache should invalidate cached JWKS."""
        httpx_mock.add_response(
            url="https://example.com/.well-known/jwks.json",
            json=jwks_response,
        )

        # First fetch
        await jwks_client.get_signing_key()
        assert len(httpx_mock.get_requests()) == 1

        # Clear cache
        jwks_client.clear_cache()

        # Add another response
        httpx_mock.add_response(
            url="https://example.com/.well-known/jwks.json",
            json=jwks_response,
        )

        # Should fetch again
        await jwks_client.get_signing_key()
        assert len(httpx_mock.get_requests()) == 2


# =============================================================================
# Key Lookup Tests
# =============================================================================


class TestKeyLookup:
    """Tests for key lookup by kid."""

    @pytest.mark.asyncio
    async def test_find_key_by_kid(self, jwks_client, jwks_response_multiple_keys, httpx_mock):
        """Should find key by kid when multiple keys exist."""
        httpx_mock.add_response(
            url="https://example.com/.well-known/jwks.json",
            json=jwks_response_multiple_keys,
        )

        key = await jwks_client.get_signing_key(kid="key-1")

        assert isinstance(key, RSAPublicKey)

    @pytest.mark.asyncio
    async def test_uses_first_key_when_no_kid(self, jwks_client, jwks_response_multiple_keys, httpx_mock):
        """Should use first key when no kid provided."""
        httpx_mock.add_response(
            url="https://example.com/.well-known/jwks.json",
            json=jwks_response_multiple_keys,
        )

        key = await jwks_client.get_signing_key(kid=None)

        assert isinstance(key, RSAPublicKey)

    @pytest.mark.asyncio
    async def test_raises_key_not_found_for_unknown_kid(self, jwks_client, jwks_response, httpx_mock):
        """Should raise KeyNotFoundError for unknown kid."""
        httpx_mock.add_response(
            url="https://example.com/.well-known/jwks.json",
            json=jwks_response,
        )

        with pytest.raises(KeyNotFoundError, match="Key with kid 'unknown-key'"):
            await jwks_client.get_signing_key(kid="unknown-key")


# =============================================================================
# Error Handling Tests
# =============================================================================


class TestErrorHandling:
    """Tests for error handling."""

    @pytest.mark.asyncio
    async def test_raises_on_network_timeout(self, jwks_client, httpx_mock):
        """Should raise JWKSFetchError on timeout."""
        import httpx

        httpx_mock.add_exception(
            httpx.TimeoutException("Connection timed out"),
            url="https://example.com/.well-known/jwks.json",
        )

        with pytest.raises(JWKSFetchError, match="Timeout"):
            await jwks_client.get_signing_key()

    @pytest.mark.asyncio
    async def test_raises_on_http_error(self, jwks_client, httpx_mock):
        """Should raise JWKSFetchError on HTTP error."""
        httpx_mock.add_response(
            url="https://example.com/.well-known/jwks.json",
            status_code=500,
        )

        with pytest.raises(JWKSFetchError, match="HTTP 500"):
            await jwks_client.get_signing_key()

    @pytest.mark.asyncio
    async def test_raises_on_invalid_json(self, jwks_client, httpx_mock):
        """Should raise JWKSFetchError on invalid JSON."""
        httpx_mock.add_response(
            url="https://example.com/.well-known/jwks.json",
            content=b"not json",
        )

        with pytest.raises(JWKSFetchError, match="Invalid JSON"):
            await jwks_client.get_signing_key()

    @pytest.mark.asyncio
    async def test_raises_on_missing_keys_array(self, jwks_client, httpx_mock):
        """Should raise JWKSFetchError when keys array is missing."""
        httpx_mock.add_response(
            url="https://example.com/.well-known/jwks.json",
            json={"not_keys": []},
        )

        with pytest.raises(JWKSFetchError, match="missing 'keys' array"):
            await jwks_client.get_signing_key()

    @pytest.mark.asyncio
    async def test_raises_on_empty_keys_array(self, jwks_client, httpx_mock):
        """Should raise JWKSFetchError when keys array is empty."""
        httpx_mock.add_response(
            url="https://example.com/.well-known/jwks.json",
            json={"keys": []},
        )

        with pytest.raises(JWKSFetchError, match="has no keys"):
            await jwks_client.get_signing_key()

    @pytest.mark.asyncio
    async def test_raises_on_missing_rsa_params(self, jwks_client, httpx_mock):
        """Should raise JWKSFetchError when RSA key missing n or e."""
        httpx_mock.add_response(
            url="https://example.com/.well-known/jwks.json",
            json={"keys": [{"kty": "RSA", "kid": "test", "n": "abc"}]},  # Missing 'e'
        )

        with pytest.raises(JWKSFetchError, match="missing 'n' or 'e'"):
            await jwks_client.get_signing_key()

    @pytest.mark.asyncio
    async def test_raises_when_no_rsa_keys(self, jwks_client, httpx_mock):
        """Should raise KeyNotFoundError when no RSA keys in JWKS."""
        httpx_mock.add_response(
            url="https://example.com/.well-known/jwks.json",
            json={
                "keys": [
                    {"kty": "EC", "kid": "ec-key", "crv": "P-256", "x": "x", "y": "y"}
                ]
            },
        )

        with pytest.raises(KeyNotFoundError, match="No RSA keys found"):
            await jwks_client.get_signing_key()


# =============================================================================
# JWKS Validation Tests
# =============================================================================


class TestJWKSValidation:
    """Tests for JWKS response validation."""

    @pytest.mark.asyncio
    async def test_validates_jwks_is_object(self, jwks_client, httpx_mock):
        """Should reject JWKS that is not a JSON object."""
        httpx_mock.add_response(
            url="https://example.com/.well-known/jwks.json",
            json=["not", "an", "object"],
        )

        with pytest.raises(JWKSFetchError, match="not a JSON object"):
            await jwks_client.get_signing_key()

    @pytest.mark.asyncio
    async def test_validates_keys_is_array(self, jwks_client, httpx_mock):
        """Should reject JWKS where keys is not an array."""
        httpx_mock.add_response(
            url="https://example.com/.well-known/jwks.json",
            json={"keys": "not an array"},
        )

        with pytest.raises(JWKSFetchError, match="missing 'keys' array"):
            await jwks_client.get_signing_key()
