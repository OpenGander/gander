"""
Token revocation checking for the MCP server.

Checks the oauth_revoked_tokens table to determine if a token has been revoked.
This is called during token verification to reject revoked tokens.
"""

from __future__ import annotations

import hashlib
import logging

from .db import execute_query

logger = logging.getLogger(__name__)


def hash_token(token: str) -> str:
    """Hash a token using SHA256 to match the revocation table format."""
    return hashlib.sha256(token.encode()).hexdigest()


async def is_token_revoked(token: str) -> bool:
    """
    Check if a token has been revoked.

    Queries the oauth_revoked_tokens table for the token hash.
    Returns True if the token has been revoked.

    Args:
        token: The raw JWT access token

    Returns:
        True if the token is in the revocation table
    """
    token_hash = hash_token(token)

    try:
        result = await execute_query(
            """
            SELECT 1
            FROM opengander.oauth_revoked_tokens
            WHERE TokenHash = {token_hash:String}
            LIMIT 1
            """,
            {"token_hash": token_hash},
        )
        is_revoked = len(result) > 0

        if is_revoked:
            logger.info("Token rejected - has been revoked: hash=%s...", token_hash[:16])

        return is_revoked

    except Exception as e:
        # On database errors, we fail open (allow the token)
        # This prevents availability issues if the revocation table is inaccessible
        # The token's signature and expiry are still validated
        logger.warning(
            "Failed to check token revocation (failing open): %s",
            e,
        )
        return False
