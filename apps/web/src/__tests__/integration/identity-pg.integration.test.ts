/**
 * Integration tests for the Postgres identity-core data access (Phase A).
 *
 * Prerequisites:
 *   docker compose -f infra/compose/docker-compose.yml up -d postgres
 *   POSTGRES_HOST=localhost npm run db:migrate
 *
 * Run:
 *   POSTGRES_HOST=localhost npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as pg from '@/lib/queries/identity-pg';
import { getPool, closePool, testPostgresConnection } from '@/lib/db';

const T = 'tnt_itest';
const T_CHILD = 'tnt_itest_child';

async function cleanup() {
  const pool = getPool();
  await pool.query('DELETE FROM invites WHERE tenant_id = ANY($1)', [[T, T_CHILD]]);
  await pool.query('DELETE FROM user_tenants WHERE tenant_id = ANY($1)', [[T, T_CHILD]]);
  await pool.query(`DELETE FROM users WHERE user_id LIKE 'usr_itest%'`);
  await pool.query('DELETE FROM tenant_allowed_domains WHERE tenant_id = ANY($1)', [[T, T_CHILD]]);
  await pool.query('DELETE FROM tenants WHERE tenant_id = ANY($1)', [[T_CHILD, T]]);
}

beforeAll(async () => {
  expect(await testPostgresConnection()).toBe(true);
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await closePool();
});

describe('identity-pg: tenants & domains', () => {
  it('creates a tenant and normalizes its domains', async () => {
    await pg.createTenant(T, 'Integration Co', 'itest-co', ['ITest.io', 'www.itest-www.com']);
    const t = await pg.getTenantBySlug('itest-co');
    expect(t?.TenantId).toBe(T);
    expect(t?.AllowedDomains.sort()).toEqual(['itest-www.com', 'itest.io']);
  });

  it('enforces unique slug', async () => {
    await expect(pg.createTenant('tnt_other', 'Dupe', 'itest-co', [])).rejects.toThrow();
    await getPool().query(`DELETE FROM tenants WHERE tenant_id = 'tnt_other'`);
  });

  it('resolves tenant by domain and reports availability', async () => {
    expect((await pg.getTenantByDomain('itest.io'))?.TenantId).toBe(T);
    expect(await pg.isDomainAvailable('itest.io')).toBe(false);
    expect(await pg.isDomainAvailable('totally-free.example')).toBe(true);
  });
});

describe('identity-pg: users & memberships', () => {
  it('upserts in place on the same userId, and rejects a colliding email on a new userId', async () => {
    await pg.upsertUser('usr_itest_a', 'Person@ITest.io', T, 'admin');
    // Same userId re-upserts in place (idempotent), updating the role.
    await pg.upsertUser('usr_itest_a', 'person@itest.io', T, 'moderator');
    // A DIFFERENT userId with the same email must NOT silently rebind the
    // existing account — UNIQUE(email) surfaces the collision.
    await expect(pg.upsertUser('usr_itest_b', 'person@itest.io', T, 'user')).rejects.toThrow();

    const u = await pg.getUserByEmail('person@itest.io');
    expect(u?.UserId).toBe('usr_itest_a');
    expect(u?.Role).toBe('moderator');
    const { rows } = await getPool().query<{ n: number }>(
      `SELECT count(*)::int n FROM users WHERE email = 'person@itest.io'`
    );
    expect(rows[0].n).toBe(1);
  });

  it('adds membership and reads it back', async () => {
    const u = await pg.getUserByEmail('person@itest.io');
    await pg.addUserToTenant(u!.UserId, T, 'moderator', 'usr_itest_a');
    expect(await pg.getUserRoleInTenant(u!.UserId, T)).toBe('moderator');
    expect(await pg.getUserTenantIds(u!.UserId)).toContain(T);
    const members = await pg.getTenantMembers(T);
    expect(members.some((m) => m.UserId === u!.UserId && m.Email === 'person@itest.io')).toBe(true);
  });

  it('exposes the agency → client hierarchy', async () => {
    await pg.createTenant(T_CHILD, 'Client Co', 'itest-child', []);
    await getPool().query('UPDATE tenants SET parent_tenant_id = $1 WHERE tenant_id = $2', [
      T,
      T_CHILD,
    ]);
    expect(await pg.getChildTenantIds(T)).toContain(T_CHILD);
    expect(await pg.isChildTenant(T_CHILD, T)).toBe(true);
  });
});

describe('identity-pg: transactional invite acceptance', () => {
  it('creates the user and marks the invite accepted atomically, and is idempotent', async () => {
    await pg.createInvite({
      inviteId: 'inv_itest',
      email: 'invitee@itest.io',
      tenantId: T,
      token: 'tok_itest',
      role: 'user',
      invitedBy: 'usr_itest_a',
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const first = await pg.acceptInvite('tok_itest', 'usr_itest_invitee');
    expect(first).toEqual({ ok: true, userId: 'usr_itest_invitee' });

    // Second attempt must not create a second user nor re-accept.
    const second = await pg.acceptInvite('tok_itest', 'usr_itest_invitee2');
    expect(second).toEqual({ ok: false, reason: 'already_accepted' });

    expect((await pg.getUserByEmail('invitee@itest.io'))?.UserId).toBe('usr_itest_invitee');
    const inv = await pg.getInviteByToken('tok_itest');
    expect(inv?.AcceptedAt).not.toBeNull();
  });

  it('rejects an expired invite without creating a user', async () => {
    await pg.createInvite({
      inviteId: 'inv_itest_exp',
      email: 'expired@itest.io',
      tenantId: T,
      token: 'tok_itest_exp',
      role: 'user',
      invitedBy: 'usr_itest_a',
      expiresAt: new Date(Date.now() - 1000),
    });
    const res = await pg.acceptInvite('tok_itest_exp', 'usr_itest_should_not_exist');
    expect(res).toEqual({ ok: false, reason: 'expired' });
    expect(await pg.getUserByEmail('expired@itest.io')).toBeNull();
  });
});
