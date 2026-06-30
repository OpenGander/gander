import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionPayload } from './auth';
import type { Role } from './types/user-management';

// Mock ClickHouse client
const mockQuery = vi.fn();
vi.mock('./clickhouse', () => ({
  getClickHouseClient: () => ({ query: mockQuery }),
}));

import {
  requireRole,
  canAssignRole,
  validateAction,
  getTenantScope,
  canAccessTenant,
} from './rbac';

function makeSession(overrides: Partial<SessionPayload> = {}): SessionPayload {
  return {
    userId: 'user-1',
    email: 'test@example.com',
    tenantId: 'tenant-1',
    tenantName: 'Test Tenant',
    role: 'user',
    type: 'session',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

function mockQueryResult(rows: Record<string, unknown>[]) {
  return { json: vi.fn().mockResolvedValue(rows) };
}

describe('requireRole', () => {
  it('returns true when actor role meets minimum', () => {
    expect(requireRole('admin', 'user')).toBe(true);
    expect(requireRole('admin', 'moderator')).toBe(true);
    expect(requireRole('admin', 'admin')).toBe(true);
  });

  it('returns false when actor role is below minimum', () => {
    expect(requireRole('user', 'moderator')).toBe(false);
    expect(requireRole('user', 'admin')).toBe(false);
    expect(requireRole('moderator', 'admin')).toBe(false);
  });

  it('superadmin meets any minimum', () => {
    expect(requireRole('superadmin', 'superadmin')).toBe(true);
    expect(requireRole('superadmin', 'user')).toBe(true);
  });

  it('user only meets user minimum', () => {
    expect(requireRole('user', 'user')).toBe(true);
    expect(requireRole('user', 'moderator')).toBe(false);
  });
});

describe('canAssignRole', () => {
  it('superadmin can assign any role', () => {
    const roles: Role[] = ['user', 'moderator', 'admin', 'superadmin'];
    for (const target of roles) {
      expect(canAssignRole('superadmin', target)).toBe(true);
    }
  });

  it('admin can assign roles below their level', () => {
    expect(canAssignRole('admin', 'user')).toBe(true);
    expect(canAssignRole('admin', 'moderator')).toBe(true);
  });

  it('admin cannot assign their own level or above', () => {
    expect(canAssignRole('admin', 'admin')).toBe(false);
    expect(canAssignRole('admin', 'superadmin')).toBe(false);
  });

  it('moderator can assign user only', () => {
    expect(canAssignRole('moderator', 'user')).toBe(true);
    expect(canAssignRole('moderator', 'moderator')).toBe(false);
    expect(canAssignRole('moderator', 'admin')).toBe(false);
  });

  it('user cannot assign any role', () => {
    expect(canAssignRole('user', 'user')).toBe(false);
  });
});

describe('validateAction', () => {
  it('allows invite for moderator+', () => {
    expect(validateAction(makeSession({ role: 'moderator' }), 'invite')).toBeNull();
    expect(validateAction(makeSession({ role: 'admin' }), 'invite')).toBeNull();
    expect(validateAction(makeSession({ role: 'superadmin' }), 'invite')).toBeNull();
  });

  it('denies invite for user', () => {
    expect(validateAction(makeSession({ role: 'user' }), 'invite')).toBe(
      'Requires moderator role or higher'
    );
  });

  it('allows remove_user for moderator+', () => {
    expect(validateAction(makeSession({ role: 'moderator' }), 'remove_user')).toBeNull();
  });

  it('denies remove_user for user', () => {
    expect(validateAction(makeSession({ role: 'user' }), 'remove_user')).toBe(
      'Requires moderator role or higher'
    );
  });

  it('allows change_role for admin+', () => {
    expect(validateAction(makeSession({ role: 'admin' }), 'change_role')).toBeNull();
    expect(validateAction(makeSession({ role: 'superadmin' }), 'change_role')).toBeNull();
  });

  it('denies change_role for moderator', () => {
    expect(validateAction(makeSession({ role: 'moderator' }), 'change_role')).toBe(
      'Requires admin role or higher'
    );
  });

  it('allows manage_tenant for admin+', () => {
    expect(validateAction(makeSession({ role: 'admin' }), 'manage_tenant')).toBeNull();
  });

  it('allows view_audit for admin+', () => {
    expect(validateAction(makeSession({ role: 'admin' }), 'view_audit')).toBeNull();
  });

  it('denies view_audit for moderator', () => {
    expect(validateAction(makeSession({ role: 'moderator' }), 'view_audit')).toBe(
      'Requires admin role or higher'
    );
  });

  it('allows impersonate for superadmin only', () => {
    expect(validateAction(makeSession({ role: 'superadmin' }), 'impersonate')).toBeNull();
  });

  it('denies impersonate for admin', () => {
    expect(validateAction(makeSession({ role: 'admin' }), 'impersonate')).toBe(
      'Requires superadmin role'
    );
  });

  it('denies impersonate when already impersonating', () => {
    const session = makeSession({
      role: 'superadmin',
      impersonating: {
        originalUserId: 'sa-1',
        originalEmail: 'sa@example.com',
        originalTenantId: 'tenant-0',
        originalRole: 'superadmin',
        startedAt: new Date().toISOString(),
      },
    });
    expect(validateAction(session, 'impersonate')).toBe(
      'Cannot start impersonation while already impersonating'
    );
  });
});

describe('getTenantScope', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('returns all tenants for superadmin', async () => {
    mockQuery.mockResolvedValueOnce(
      mockQueryResult([{ TenantId: 't1' }, { TenantId: 't2' }, { TenantId: 't3' }])
    );

    const scope = await getTenantScope(makeSession({ role: 'superadmin' }));
    expect(scope).toEqual(['t1', 't2', 't3']);
    expect(mockQuery).toHaveBeenCalledOnce();
  });

  it('returns memberships + home tenant for regular user', async () => {
    mockQuery.mockResolvedValueOnce(
      mockQueryResult([{ TenantId: 'tenant-1' }, { TenantId: 'tenant-2' }])
    );

    const scope = await getTenantScope(makeSession({ role: 'user', tenantId: 'tenant-1' }));
    expect(scope).toContain('tenant-1');
    expect(scope).toContain('tenant-2');
    expect(mockQuery).toHaveBeenCalledOnce();
  });

  it('returns memberships + child tenants for admin', async () => {
    // First call: user_tenants memberships
    mockQuery.mockResolvedValueOnce(mockQueryResult([{ TenantId: 'tenant-1' }]));
    // Second call: child tenants
    mockQuery.mockResolvedValueOnce(
      mockQueryResult([{ TenantId: 'child-1' }, { TenantId: 'child-2' }])
    );

    const scope = await getTenantScope(makeSession({ role: 'admin', tenantId: 'tenant-1' }));
    expect(scope).toContain('tenant-1');
    expect(scope).toContain('child-1');
    expect(scope).toContain('child-2');
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('always includes home tenant', async () => {
    // Return empty memberships
    mockQuery.mockResolvedValueOnce(mockQueryResult([]));

    const scope = await getTenantScope(makeSession({ role: 'user', tenantId: 'home-tenant' }));
    expect(scope).toContain('home-tenant');
  });
});

describe('canAccessTenant', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('returns true when tenant is in scope', async () => {
    mockQuery.mockResolvedValueOnce(
      mockQueryResult([{ TenantId: 'tenant-1' }, { TenantId: 'tenant-2' }])
    );

    const result = await canAccessTenant(
      makeSession({ role: 'user', tenantId: 'tenant-1' }),
      'tenant-2'
    );
    expect(result).toBe(true);
  });

  it('returns false when tenant is not in scope', async () => {
    mockQuery.mockResolvedValueOnce(mockQueryResult([]));

    const result = await canAccessTenant(
      makeSession({ role: 'user', tenantId: 'tenant-1' }),
      'other-tenant'
    );
    expect(result).toBe(false);
  });

  it('superadmin can access any tenant', async () => {
    mockQuery.mockResolvedValueOnce(mockQueryResult([{ TenantId: 'any-tenant' }]));

    const result = await canAccessTenant(makeSession({ role: 'superadmin' }), 'any-tenant');
    expect(result).toBe(true);
  });
});
