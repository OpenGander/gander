"""
Common utilities for MCP tools.

Provides shared functionality for date parsing, tenant validation,
and response formatting used across all analytics tools.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any


# Floor used for "all available data" — comfortably before any OpenGander data
# exists, so the range covers everything ClickHouse still retains.
ALL_TIME_FLOOR = datetime(2000, 1, 1, tzinfo=UTC)


def parse_date_range(
    start_date: str | None = None,
    end_date: str | None = None,
    default_days: int = 7,
    all_time: bool = False,
) -> tuple[datetime, datetime]:
    """
    Parse optional date strings into datetime objects with defaults.

    Args:
        start_date: Start date in ISO format (YYYY-MM-DD or full ISO)
        end_date: End date in ISO format (YYYY-MM-DD or full ISO)
        default_days: Days to look back if start_date not provided
        all_time: If True and start_date is not given, start from ALL_TIME_FLOOR
            so the range covers all retained data. An explicit start_date always
            takes precedence over all_time.

    Returns:
        Tuple of (start, end) datetime objects in UTC
    """
    now = datetime.now(UTC)

    # Parse end date
    if end_date:
        try:
            end = datetime.fromisoformat(end_date.replace("Z", "+00:00"))
            if end.tzinfo is None:
                end = end.replace(tzinfo=UTC)
        except ValueError:
            # Try date-only format
            end = datetime.strptime(end_date, "%Y-%m-%d").replace(
                hour=23, minute=59, second=59, microsecond=999999, tzinfo=UTC
            )
    else:
        end = now

    # Parse start date
    if start_date:
        try:
            start = datetime.fromisoformat(start_date.replace("Z", "+00:00"))
            if start.tzinfo is None:
                start = start.replace(tzinfo=UTC)
        except ValueError:
            # Try date-only format
            start = datetime.strptime(start_date, "%Y-%m-%d").replace(
                hour=0, minute=0, second=0, microsecond=0, tzinfo=UTC
            )
    elif all_time:
        start = ALL_TIME_FLOOR
    else:
        start = end - timedelta(days=default_days)
        # Normalize to start of day
        start = start.replace(hour=0, minute=0, second=0, microsecond=0)

    return start, end


def format_date_range(start: datetime, end: datetime) -> dict[str, str]:
    """
    Format datetime objects for JSON response.

    Args:
        start: Start datetime
        end: End datetime

    Returns:
        Dictionary with ISO formatted date strings
    """
    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
    }


def validate_limit(limit: int | None, default: int = 20, max_limit: int = 100) -> int:
    """
    Validate and normalize a limit parameter.

    Args:
        limit: User-provided limit (may be None)
        default: Default limit if not provided
        max_limit: Maximum allowed limit

    Returns:
        Validated limit value
    """
    if limit is None:
        return default
    return max(1, min(limit, max_limit))


def validate_interval(interval: str | None, default: str = "hour") -> str:
    """
    Validate interval parameter for time series queries.

    Args:
        interval: User-provided interval ('hour' or 'day')
        default: Default interval if not provided

    Returns:
        Validated interval value
    """
    if interval is None:
        return default
    interval_lower = interval.lower()
    if interval_lower not in ("hour", "day"):
        return default
    return interval_lower


def error_response(message: str) -> dict[str, Any]:
    """
    Create a standardized error response.

    Args:
        message: Error message

    Returns:
        Error response dictionary
    """
    return {"error": message}


def access_denied_response(tenant_id: str) -> dict[str, Any]:
    """
    Create an access denied error response.

    Args:
        tenant_id: The tenant ID that access was denied for

    Returns:
        Error response dictionary
    """
    return {
        "error": "Access denied",
        "message": f"You don't have access to tenant: {tenant_id}",
    }
