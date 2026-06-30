/**
 * Integration tests for the Postgres OAuth + API key data access (Phase B).
 *
 * Prerequisites:
 *   docker compose -f infra/compose/docker-compose.yml up -d postgres
 *   POSTGRES_HOST=localhost npm run db:migrate
 *
 * Run:
 *   POSTGRES_HOST=localhost npm run test:integration
 */
import { createHash } from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as oauthPg from '@/lib/oauth/oauth-pg';
import * as apiKeysPg from '@/lib/queries/api-keys-pg';
import { getPool, closePool, testPostgresConnection } from '@/lib/db';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const FAM = 'fam_itest';

async function cleanup() {
  const p = getPool();
  await p.query(`DELETE FROM oauth_authorization_codes WHERE code LIKE 'code_itest%'`);
  await p.query(`DELETE FROM oauth_refresh_tokens WHERE family_id = $1`, [FAM]);
  await p.query(`DELETE FROM oauth_revoked_tokens WHERE revoked_by = 'itest'`);
  await p.query(`DELETE FROM oauth_clients WHERE client_id LIKE 'cli_itest%'`);
  await p.query(`DELETE FROM api_keys WHERE key_id LIKE 'key_itest%'`);
}

beforeAll(async () => {
  expect(await testPostgresConnection()).toBe(true);
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  await closePool();
});

describe('oauth-pg: single-use authorization codes', () => {
  it('consumes once, then reports replay', async () => {
    await oauthPg.insertAuthorizationCode({
      code: 'code_itest1',
      clientId: 'cli_itest',
      redirectUri: 'http://localhost:1/cb',
      codeChallenge: 'chal',
      codeChallengeMethod: 'S256',
      userId: 'u1',
      tenantId: 't1',
      scope: 'mcp:read',
      resource: '',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const first = await oauthPg.consumeAuthorizationCode(
      'code_itest1',
      'cli_itest',
      'http://localhost:1/cb'
    );
    expect(first && 'userId' in first && first.userId).toBe('u1');

    const second = await oauthPg.consumeAuthorizationCode(
      'code_itest1',
      'cli_itest',
      'http://localhost:1/cb'
    );
    expect(second).toMatchObject({ replay: true, userId: 'u1', clientId: 'cli_itest' });
  });

  it('rejects a wrong redirect_uri', async () => {
    await oauthPg.insertAuthorizationCode({
      code: 'code_itest2',
      clientId: 'cli_itest',
      redirectUri: 'http://localhost:1/cb',
      codeChallenge: 'chal',
      codeChallengeMethod: 'S256',
      userId: 'u1',
      tenantId: 't1',
      scope: 'mcp:read',
      resource: '',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(
      await oauthPg.consumeAuthorizationCode('code_itest2', 'cli_itest', 'http://evil/cb')
    ).toBeNull();
  });
});

describe('oauth-pg: refresh token rotation + theft detection', () => {
  it('rotates once, allows grace-period reuse, then revokes the family on theft', async () => {
    await oauthPg.insertRefreshToken({
      tokenHash: sha256('rt_raw'),
      familyId: FAM,
      userId: 'u1',
      tenantId: 't1',
      clientId: 'cli_itest',
      scope: 'mcp:read',
      resource: '',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    // A sibling token in the same family that theft detection must revoke.
    await oauthPg.insertRefreshToken({
      tokenHash: sha256('rt_sibling'),
      familyId: FAM,
      userId: 'u1',
      tenantId: 't1',
      clientId: 'cli_itest',
      scope: 'mcp:read',
      resource: '',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    // First use rotates the token.
    const rotated = await oauthPg.consumeRefreshToken('rt_raw', 'cli_itest');
    expect(rotated).toMatchObject({ userId: 'u1', familyId: FAM });
    expect(rotated?.isGracePeriodReuse).toBeFalsy();

    // Immediate reuse is treated as a concurrency race (grace period).
    const grace = await oauthPg.consumeRefreshToken('rt_raw', 'cli_itest');
    expect(grace?.isGracePeriodReuse).toBe(true);

    // Backdate the rotation beyond the grace window → next reuse is theft.
    await getPool().query(
      `UPDATE oauth_refresh_tokens SET rotated_at = now() - interval '1 hour' WHERE token_hash = $1`,
      [sha256('rt_raw')]
    );
    const theft = await oauthPg.consumeRefreshToken('rt_raw', 'cli_itest');
    expect(theft).toBeNull();

    // The entire family is now revoked — the sibling can no longer be used.
    const sibling = await oauthPg.consumeRefreshToken('rt_sibling', 'cli_itest');
    expect(sibling).toBeNull();
    const rec = await oauthPg.getRefreshTokenByHash(sha256('rt_sibling'));
    expect(rec?.Revoked).toBe(1);
  });
});

describe('oauth-pg: token revocation list', () => {
  it('records and detects revoked access tokens', async () => {
    const h = sha256('access_token_xyz');
    expect(await oauthPg.isTokenRevoked(h)).toBe(false);
    await oauthPg.insertRevokedToken({
      tokenHash: h,
      revokedBy: 'itest',
      reason: 'logout',
      expiresAt: new Date(Date.now() + 3600_000),
    });
    expect(await oauthPg.isTokenRevoked(h)).toBe(true);
    // idempotent re-revoke
    await oauthPg.insertRevokedToken({
      tokenHash: h,
      revokedBy: 'itest',
      reason: 'logout',
      expiresAt: new Date(Date.now() + 3600_000),
    });
  });
});

describe('oauth-pg: dynamic clients', () => {
  it('inserts, reads, and deactivates a client', async () => {
    await oauthPg.insertClient({
      clientId: 'cli_itest_dyn',
      clientName: 'Itest Client',
      clientUri: '',
      redirectUris: ['https://app.example/cb'],
      grantTypes: ['authorization_code'],
      responseTypes: ['code'],
      scope: 'mcp:read schema:read',
      tokenEndpointAuthMethod: 'none',
      softwareId: '',
      softwareVersion: '',
      clientIdIssuedAt: new Date(),
    });
    const c = await oauthPg.getClientFromDatabase('cli_itest_dyn');
    expect(c?.scopes).toEqual(['mcp:read', 'schema:read']);

    expect(await oauthPg.deactivateClient('cli_itest_dyn')).toBe(true);
    expect(await oauthPg.getClientFromDatabase('cli_itest_dyn')).toBeNull();
  });
});

describe('api-keys-pg: create / list / revoke', () => {
  it('creates a key, lists it active, then excludes it after revoke', async () => {
    await apiKeysPg.createApiKey({
      keyId: 'key_itest1',
      keyHash: sha256('og_live_itest'),
      keyPrefix: 'og_live_it',
      name: 'Itest Key',
      userId: 'u_itest',
      tenantId: 't1',
      role: 'user',
      allowedTenants: ['t1'],
      allowedTools: [],
      expiresAt: null,
    });

    let active = await apiKeysPg.listActiveApiKeys('u_itest');
    expect(active.map((k) => k.KeyId)).toContain('key_itest1');

    await apiKeysPg.revokeApiKey('key_itest1');
    active = await apiKeysPg.listActiveApiKeys('u_itest');
    expect(active.map((k) => k.KeyId)).not.toContain('key_itest1');

    const fetched = await apiKeysPg.getApiKeyById('key_itest1');
    expect(fetched?.RevokedAt).not.toBeNull();
  });
});
