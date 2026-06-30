"""
Tests for the token revocation module.
"""

import hashlib
from unittest.mock import patch

import pytest

from opengander_mcp.revocation import hash_token, is_token_revoked


class TestHashToken:
    """Tests for hash_token function."""

    def test_hash_returns_sha256_hex(self):
        """Verify hash_token returns SHA256 hex digest."""
        token = "test-token-123"
        expected = hashlib.sha256(token.encode()).hexdigest()
        assert hash_token(token) == expected

    def test_hash_is_deterministic(self):
        """Verify same token always produces same hash."""
        token = "my-access-token"
        assert hash_token(token) == hash_token(token)

    def test_different_tokens_different_hashes(self):
        """Verify different tokens produce different hashes."""
        assert hash_token("token-a") != hash_token("token-b")


class TestIsTokenRevoked:
    """Tests for is_token_revoked function."""

    @pytest.mark.asyncio
    async def test_returns_true_when_token_in_revocation_table(self):
        """Verify revoked tokens are detected."""
        token = "revoked-token"
        token_hash = hash_token(token)

        with patch("opengander_mcp.revocation.execute_query") as mock_query:
            # Simulate finding the token in the revocation table
            mock_query.return_value = [{"1": 1}]

            result = await is_token_revoked(token)

            assert result is True
            mock_query.assert_called_once()
            # Verify the query includes the token hash
            call_args = mock_query.call_args
            assert token_hash in str(call_args)

    @pytest.mark.asyncio
    async def test_returns_false_when_token_not_revoked(self):
        """Verify non-revoked tokens are allowed."""
        token = "valid-token"

        with patch("opengander_mcp.revocation.execute_query") as mock_query:
            # Simulate empty result (token not found)
            mock_query.return_value = []

            result = await is_token_revoked(token)

            assert result is False

    @pytest.mark.asyncio
    async def test_fails_open_on_database_error(self):
        """Verify database errors don't block authentication."""
        token = "any-token"

        with patch("opengander_mcp.revocation.execute_query") as mock_query:
            # Simulate database connection failure
            mock_query.side_effect = Exception("Connection refused")

            result = await is_token_revoked(token)

            # Should fail open (allow) to prevent availability issues
            assert result is False

    @pytest.mark.asyncio
    async def test_logs_revoked_token(self, caplog):
        """Verify revoked tokens are logged."""
        import logging

        caplog.set_level(logging.INFO)
        token = "revoked-token"

        with patch("opengander_mcp.revocation.execute_query") as mock_query:
            mock_query.return_value = [{"1": 1}]

            await is_token_revoked(token)

            assert "has been revoked" in caplog.text

    @pytest.mark.asyncio
    async def test_logs_database_error(self, caplog):
        """Verify database errors are logged."""
        token = "any-token"

        with patch("opengander_mcp.revocation.execute_query") as mock_query:
            mock_query.side_effect = Exception("Database unavailable")

            await is_token_revoked(token)

            assert "Failed to check token revocation" in caplog.text
