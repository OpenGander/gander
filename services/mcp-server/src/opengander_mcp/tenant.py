"""
Tenant scoping logic for multi-tenant data isolation.

Replicates the getTenantScope pattern from the TypeScript web app (apps/web/src/lib/rbac.ts)
to ensure consistent access control across all OpenGander services.

Role hierarchy:
- superadmin (level 4): Access to ALL tenants
- admin (level 3): All memberships + child tenants of home tenant
- moderator (level 2): All memberships only
- user (level 1): All memberships only
"""

from __future__ import annotations

import logging
from typing import Literal

from .db import execute_query

logger = logging.getLogger(__name__)

# Role type matching TypeScript definition
Role = Literal["superadmin", "admin", "moderator", "user"]

async def get_tenant_scope(
    user_id: str,
    home_tenant_id: str,
    role: Role,
) -> list[str]:
    """
    Get all tenant IDs that a user has access to based on memberships and role.

    This replicates the getTenantScope function from TypeScript:
    - superadmin: all tenants
    - admin: all memberships + child tenants of home tenant
    - moderator/user: all memberships only

    Args:
        user_id: The user's ID
        home_tenant_id: The user's home tenant ID
        role: The user's role

    Returns:
        List of accessible tenant IDs
    """
    # Superadmin can access all tenants
    if role == "superadmin":
        rows = await execute_query(
            "SELECT TenantId FROM opengander.tenants FINAL"
        )
        return [row["TenantId"] for row in rows]

    # Get all tenants user is a member of
    membership_rows = await execute_query(
        """
        SELECT TenantId FROM opengander.user_tenants FINAL
        WHERE UserId = {user_id:String}
        """,
        {"user_id": user_id},
    )
    member_tenant_ids = {row["TenantId"] for row in membership_rows}

    # Admin also gets access to child tenants of their home tenant
    if role == "admin":
        child_rows = await execute_query(
            """
            SELECT TenantId FROM opengander.tenants FINAL
            WHERE ParentTenantId = {tenant_id:String}
            """,
            {"tenant_id": home_tenant_id},
        )
        for row in child_rows:
            member_tenant_ids.add(row["TenantId"])

    # Ensure home tenant is always included (backward compatibility)
    # Guard against empty string being added to the set
    if home_tenant_id:
        member_tenant_ids.add(home_tenant_id)

    return list(member_tenant_ids)


