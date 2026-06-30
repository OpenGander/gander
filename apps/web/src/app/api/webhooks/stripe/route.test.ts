import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import Stripe from 'stripe';

const WEBHOOK_SECRET = 'whsec_test_secret_for_unit_tests_only';

process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';

const mockEmit = vi.fn();
const mockUpdateTenantStripe = vi.fn();
const mockSubscriptionsRetrieve = vi.fn();

vi.mock('@/lib/stripe-pipeline', () => ({
  emitStripeEvent: (...args: unknown[]) => mockEmit(...args),
}));

vi.mock('@/lib/queries/tenants', () => ({
  updateTenantStripe: (...args: unknown[]) => mockUpdateTenantStripe(...args),
}));

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

const realStripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

vi.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks: realStripe.webhooks,
    subscriptions: {
      retrieve: (...args: unknown[]) => mockSubscriptionsRetrieve(...args),
    },
  },
}));

import { POST } from './route';

type MinimalStripeEvent = {
  id: string;
  object: 'event';
  api_version: string;
  created: number;
  data: { object: unknown };
  livemode: boolean;
  pending_webhooks: number;
  request: { id: string | null; idempotency_key: string | null };
  type: string;
};

function makeStripeEvent(overrides: Partial<MinimalStripeEvent>): MinimalStripeEvent {
  return {
    id: 'evt_test_1',
    object: 'event',
    api_version: '2024-06-20',
    created: 1_700_000_000,
    data: { object: {} },
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type: 'payment_intent.succeeded',
    ...overrides,
  };
}

function signPayload(payload: string, secret: string = WEBHOOK_SECRET, timestamp?: number): string {
  return realStripe.webhooks.generateTestHeaderString({
    payload,
    secret,
    timestamp: timestamp ?? Math.floor(Date.now() / 1000),
  });
}

function makeRequest(rawBody: string, signature: string | null): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (signature !== null) headers.set('stripe-signature', signature);
  return new NextRequest('http://localhost:3000/api/webhooks/stripe', {
    method: 'POST',
    headers,
    body: rawBody,
  });
}

describe('POST /api/webhooks/stripe', () => {
  beforeEach(() => {
    mockEmit.mockReset();
    mockUpdateTenantStripe.mockReset();
    mockSubscriptionsRetrieve.mockReset();
    mockEmit.mockResolvedValue(undefined);
    mockUpdateTenantStripe.mockResolvedValue(undefined);
  });

  it('verifies a valid signature and emits to the pipeline', async () => {
    const event = makeStripeEvent({ id: 'evt_ok_1', type: 'payment_intent.succeeded' });
    const body = JSON.stringify(event);
    const res = await POST(makeRequest(body, signPayload(body)));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockEmit.mock.calls[0][0].id).toBe('evt_ok_1');
  });

  it('rejects with 400 when signature is missing', async () => {
    const body = JSON.stringify(makeStripeEvent({}));
    const res = await POST(makeRequest(body, null));

    expect(res.status).toBe(400);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('rejects with 400 when signature fails verification', async () => {
    const body = JSON.stringify(makeStripeEvent({}));
    const badSig = signPayload(body, 'whsec_wrong_secret');
    const res = await POST(makeRequest(body, badSig));

    expect(res.status).toBe(400);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('rejects with 400 when the body is tampered after signing', async () => {
    const original = JSON.stringify(makeStripeEvent({}));
    const signature = signPayload(original);
    const tampered = original.replace('payment_intent.succeeded', 'charge.refunded');
    const res = await POST(makeRequest(tampered, signature));

    expect(res.status).toBe(400);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('preserves the raw body byte-for-byte through verification', async () => {
    // Whitespace variations in JSON produce a different HMAC — if anything
    // re-serializes the body before verification, this test fails.
    const event = makeStripeEvent({ id: 'evt_whitespace' });
    const body = JSON.stringify(event, null, 2); // indented, not compact
    const res = await POST(makeRequest(body, signPayload(body)));

    expect(res.status).toBe(200);
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when the pipeline emit fails', async () => {
    mockEmit.mockRejectedValueOnce(new Error('clickhouse unreachable'));
    const body = JSON.stringify(makeStripeEvent({}));
    const res = await POST(makeRequest(body, signPayload(body)));

    expect(res.status).toBe(500);
  });

  it('calls updateTenantStripe for checkout.session.completed with a tenantId', async () => {
    const event = makeStripeEvent({
      id: 'evt_checkout_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          customer: 'cus_abc',
          subscription: 'sub_abc',
          metadata: { tenantId: 'tenant_1' },
        },
      },
    });
    mockSubscriptionsRetrieve.mockResolvedValueOnce({
      status: 'trialing',
      trial_end: 1_800_000_000,
      metadata: { tenantId: 'tenant_1' },
    });

    const body = JSON.stringify(event);
    const res = await POST(makeRequest(body, signPayload(body)));

    expect(res.status).toBe(200);
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith('sub_abc');
    expect(mockUpdateTenantStripe).toHaveBeenCalledWith(
      'tenant_1',
      expect.objectContaining({
        stripeCustomerId: 'cus_abc',
        stripeSubscriptionId: 'sub_abc',
        subscriptionStatus: 'trialing',
      })
    );
  });

  it('skips tenant update for event types without inline handlers', async () => {
    const event = makeStripeEvent({ id: 'evt_misc', type: 'charge.refunded' });
    const body = JSON.stringify(event);
    const res = await POST(makeRequest(body, signPayload(body)));

    expect(res.status).toBe(200);
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
  });
});
