"""
Schema discovery tools for OpenGander MCP.

These tools provide metadata about the ClickHouse schema and do NOT
require tenant filtering since they only expose table/column structure,
not actual data.
"""

from __future__ import annotations

import logging
from typing import Any

from fastmcp import Context

from ..audit import audit_tool_call
from ..auth import get_auth_context
from ..db import execute_query
from ._common import error_response

logger = logging.getLogger(__name__)


async def list_tables(ctx: Context) -> dict[str, Any]:
    """
    List all tables and materialized views in the opengander database.

    Returns table names, engines, row counts, and sizes. This is useful
    for understanding what data is available to query.

    Returns:
        List of tables with metadata including:
        - table_name: Name of the table
        - engine: ClickHouse engine type
        - total_rows: Approximate row count
        - size: Human-readable storage size
    """
    auth_ctx = get_auth_context(ctx)

    async with audit_tool_call(auth_ctx, "list_tables", {}) as audit:
        try:
            rows = await execute_query(
                """
                SELECT
                    name AS table_name,
                    engine,
                    total_rows,
                    formatReadableSize(total_bytes) AS size
                FROM system.tables
                WHERE database = 'opengander'
                ORDER BY name
                """
            )

            audit.set_response_rows(len(rows))

            return {
                "tables": [
                    {
                        "table_name": row["table_name"],
                        "engine": row["engine"],
                        "total_rows": row["total_rows"],
                        "size": row["size"],
                    }
                    for row in rows
                ],
            }

        except Exception as e:
            logger.error("list_tables failed: %s", e)
            audit.set_error(str(e))
            return error_response(f"Failed to list tables: {e}")


async def describe_table(ctx: Context, table_name: str) -> dict[str, Any]:
    """
    Get column information for a specific table.

    Returns detailed schema information including column names, data types,
    default values, and comments. Use this to understand what data is
    available in a specific table before querying.

    Args:
        table_name: Name of the table to describe (must be in opengander database)

    Returns:
        Table schema with:
        - table_name: The requested table name
        - columns: List of column definitions with name, type, default_kind, comment
    """
    auth_ctx = get_auth_context(ctx)

    # Validate table_name to prevent injection (only alphanumeric and underscore)
    if not table_name or not all(c.isalnum() or c == "_" for c in table_name):
        return error_response("Invalid table name. Use alphanumeric characters and underscores only.")

    async with audit_tool_call(auth_ctx, "describe_table", {"table_name": table_name}) as audit:
        try:
            # First check if the table exists
            exists_check = await execute_query(
                """
                SELECT 1
                FROM system.tables
                WHERE database = 'opengander' AND name = {table_name:String}
                LIMIT 1
                """,
                {"table_name": table_name},
            )

            if not exists_check:
                return error_response(f"Table '{table_name}' not found in opengander database")

            # Get column information
            rows = await execute_query(
                """
                SELECT
                    name AS column_name,
                    type AS data_type,
                    default_kind,
                    comment
                FROM system.columns
                WHERE database = 'opengander' AND table = {table_name:String}
                ORDER BY position
                """,
                {"table_name": table_name},
            )

            audit.set_response_rows(len(rows))

            return {
                "table_name": table_name,
                "columns": [
                    {
                        "column_name": row["column_name"],
                        "data_type": row["data_type"],
                        "default_kind": row["default_kind"],
                        "comment": row["comment"] or "",
                    }
                    for row in rows
                ],
            }

        except Exception as e:
            logger.error("describe_table failed for %s: %s", table_name, e)
            audit.set_error(str(e))
            return error_response(f"Failed to describe table: {e}")
