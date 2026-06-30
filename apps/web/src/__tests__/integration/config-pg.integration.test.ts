/**
 * Integration tests for the Postgres config/misc data access (Phase C):
 * tenant_domains, service_mappings, waitlist, stripe_events.
 *
 * Prerequisites:
 *   docker compose -f infra/compose/docker-compose.yml up -d postgres
 *   POSTGRES_HOST=localhost npm run db:migrate
 *
 * Run:
 *   POSTGRES_HOST=localhost npm run test:integration
 */
import type Stripe from 'stripe';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as domainsPg from '@/lib/queries/domains-pg';
import * as servicesPg from '@/lib/queries/services-pg';
import * as miscPg from '@/lib/queries/misc-pg';
import { getPool, closePool, testPostgresConnection } from '@/lib/db';

const TENANT = 'tnt_cfg_itest';

async function cleanup() {
  const p = getPool();
  await p.query(`DELETE FROM tenant_domains WHERE tenant_id = $1`, [TENANT]);
  await p.query(`DELETE FROM service_mappings WHERE tenant_id = $1`, [TENANT]);
  await p.query(`DELETE FROM waitlist WHERE email LIKE '%@cfg-itest.example'`);
  await p.query(`DELETE FROM stripe_events WHERE event_id LIKE 'evt_cfg_itest%'`);
}

beforeAll(async () => {
  expect(await testPostgresConnection()).toBe(true);
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  await closePool();
});

describe('config-pg: tenant domains', () => {
  it('adds, reads, and removes a domain', async () => {
    const created = await domainsPg.addTenantDomain(TENANT, 'WWW.Example.io', 'Example');
    expect(created.Domain).toBe('www.example.io');
    expect(created.Verified).toBe(false);

    expect((await domainsPg.getDomainById(created.DomainId))?.DomainId).toBe(created.DomainId);
    expect((await domainsPg.getTenantDomains(TENANT)).length).toBe(1);
    expect((await domainsPg.getDomainByHostname('www.example.io'))?.TenantId).toBe(TENANT);
    expect(await domainsPg.isDomainRegistered('www.example.io')).toBe(true);
    expect(await domainsPg.isDomainRegistered('nope.example')).toBe(false);

    await domainsPg.removeTenantDomain(created.DomainId);
    expect(await domainsPg.getDomainById(created.DomainId)).toBeNull();
  });
});

describe('config-pg: service mappings', () => {
  it('creates a stub, then upsert preserves status/platform', async () => {
    await servicesPg.createServiceStub(TENANT, 'svc-a', 'Service A', 'nodejs', 'usr1');
    let maps = await servicesPg.getServiceMappings(TENANT);
    expect(maps).toHaveLength(1);
    expect(maps[0]).toMatchObject({ Status: 'stub', Platform: 'nodejs', CreatedBy: 'usr1' });

    // Renaming via upsert must NOT wipe status/platform/created_by.
    await servicesPg.upsertServiceMapping(TENANT, 'svc-a', 'Renamed A');
    maps = await servicesPg.getServiceMappings(TENANT);
    expect(maps[0]).toMatchObject({
      DisplayName: 'Renamed A',
      Status: 'stub',
      Platform: 'nodejs',
      CreatedBy: 'usr1',
    });

    expect(await servicesPg.deleteServiceMapping(TENANT, 'svc-a')).toBe(true);
    expect(await servicesPg.getServiceMappings(TENANT)).toHaveLength(0);
  });
});

describe('config-pg: waitlist (unique email upsert)', () => {
  it('refreshes the same email in place rather than duplicating', async () => {
    await miscPg.upsertWaitlistEntry({
      waitlistId: 'wl_1',
      email: 'a@cfg-itest.example',
      magicLink: 'link1',
      token: 'tok1',
    });
    await miscPg.upsertWaitlistEntry({
      waitlistId: 'wl_2',
      email: 'a@cfg-itest.example',
      magicLink: 'link2',
      token: 'tok2',
    });
    const { rows } = await getPool().query<{ n: number; magic_link: string }>(
      `SELECT count(*)::int n, max(magic_link) magic_link FROM waitlist WHERE email = 'a@cfg-itest.example'`
    );
    expect(rows[0].n).toBe(1);
    expect(rows[0].magic_link).toBe('link2');
  });
});

describe('config-pg: stripe events (idempotent by event_id)', () => {
  it('drops a redelivered event', async () => {
    const event = {
      id: 'evt_cfg_itest1',
      type: 'customer.subscription.updated',
      livemode: false,
      api_version: '2024-01-01',
    } as unknown as Stripe.Event;

    await miscPg.insertStripeEvent(event);
    await miscPg.insertStripeEvent(event); // redelivery

    const { rows } = await getPool().query<{ n: number }>(
      `SELECT count(*)::int n FROM stripe_events WHERE event_id = 'evt_cfg_itest1'`
    );
    expect(rows[0].n).toBe(1);
  });
});
