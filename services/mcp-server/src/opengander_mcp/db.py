"""
ClickHouse async client wrapper for the MCP server.

Provides a singleton connection pool and helper methods for executing queries
with proper parameter binding and result parsing.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any

import clickhouse_connect
from clickhouse_connect.driver.asyncclient import AsyncClient
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class ClickHouseSettings(BaseSettings):
    """ClickHouse connection settings from environment."""

    model_config = SettingsConfigDict(env_prefix="", case_sensitive=False)

    clickhouse_host: str = "localhost"
    clickhouse_port: int = 8123
    clickhouse_user: str = "otel"
    clickhouse_password: str = "otel"
    clickhouse_database: str = "opengander"


# Global client instance
_client: AsyncClient | None = None
_settings: ClickHouseSettings | None = None


def get_settings() -> ClickHouseSettings:
    """Get ClickHouse settings (cached)."""
    global _settings
    if _settings is None:
        _settings = ClickHouseSettings()
    return _settings


async def get_client() -> AsyncClient:
    """Get the ClickHouse async client (singleton)."""
    global _client
    if _client is None:
        settings = get_settings()
        _client = await clickhouse_connect.get_async_client(
            host=settings.clickhouse_host,
            port=settings.clickhouse_port,
            username=settings.clickhouse_user,
            password=settings.clickhouse_password,
            database=settings.clickhouse_database,
        )
        logger.info(
            "ClickHouse client connected: %s:%d (database: %s)",
            settings.clickhouse_host,
            settings.clickhouse_port,
            settings.clickhouse_database,
        )
    return _client


async def close_client() -> None:
    """Close the ClickHouse client connection."""
    global _client
    if _client is not None:
        await _client.close()
        _client = None
        logger.info("ClickHouse client closed")


@asynccontextmanager
async def get_connection():
    """Context manager for ClickHouse connection."""
    client = await get_client()
    try:
        yield client
    finally:
        # Connection pooling - don't close on each request
        pass


async def execute_query(
    query: str,
    parameters: dict[str, Any] | None = None,
    settings: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """
    Execute a SELECT query and return results as a list of dictionaries.

    Args:
        query: SQL query with {name:Type} parameter placeholders
        parameters: Dictionary of parameter values
        settings: Optional ClickHouse query settings

    Returns:
        List of row dictionaries
    """
    client = await get_client()

    try:
        result = await client.query(
            query,
            parameters=parameters or {},
            settings=settings or {},
        )

        # Convert to list of dicts
        columns = result.column_names
        rows = []
        for row in result.result_rows:
            rows.append(dict(zip(columns, row, strict=False)))
        return rows

    except Exception as e:
        logger.error("Query execution failed: %s", e)
        raise


async def execute_command(
    query: str,
    parameters: dict[str, Any] | None = None,
    settings: dict[str, Any] | None = None,
) -> None:
    """
    Execute a non-SELECT query (INSERT, ALTER, etc.).

    Args:
        query: SQL command with {name:Type} parameter placeholders
        parameters: Dictionary of parameter values
        settings: Optional ClickHouse query settings
    """
    client = await get_client()

    try:
        await client.command(
            query,
            parameters=parameters or {},
            settings=settings or {},
        )
    except Exception as e:
        logger.error("Command execution failed: %s", e)
        raise


async def insert_rows(
    table: str,
    data: list[dict[str, Any]],
    column_names: list[str] | None = None,
) -> None:
    """
    Insert rows into a table.

    Args:
        table: Full table name (e.g., 'opengander.mcp_audit_logs')
        data: List of row dictionaries
        column_names: Optional list of column names (inferred from first row if not provided)
    """
    if not data:
        return

    client = await get_client()

    # Infer column names from data if not provided
    if column_names is None:
        column_names = list(data[0].keys())

    # Convert dicts to tuples in column order
    rows = [[row.get(col) for col in column_names] for row in data]

    try:
        await client.insert(
            table=table,
            data=rows,
            column_names=column_names,
        )
    except Exception as e:
        logger.error("Insert failed for table %s: %s", table, e)
        raise


async def ping() -> bool:
    """Test the ClickHouse connection."""
    try:
        client = await get_client()
        await client.command("SELECT 1")
        return True
    except Exception as e:
        logger.error("ClickHouse ping failed: %s", e)
        return False
