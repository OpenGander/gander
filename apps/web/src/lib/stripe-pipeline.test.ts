import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

const mockInsert = vi.fn();

vi.mock('./clickhouse', () => ({
  getClickHouseClient: () => ({ insert: mockInsert }),
}));

vi.mock('./logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

import { buildStripePipelineRow, emitStripeEvent } from './stripe-pipeline';

function makeEvent(overrides: Partial<Stripe.Event> = {}): Stripe.Event {
  return {
    id: 'evt_test_123',
    object: 'event',
    api_version: '2024-06-20',
    created: 1_700_000_000,
    data: { object: {} },
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type: 'payment_intent.succeeded',
    ...overrides,
  } as Stripe.Event;
}

describe('buildStripePipelineRow', () => {
  it('maps Stripe event fields into the row envelope', () => {
    const event = makeEvent({ id: 'evt_abc', type: 'invoice.paid', livemode: true });
    const now = new Date('2026-01-15T10:30:45.123Z');
    const row = buildStripePipelineRow(event, now);

    expect(row.event_id).toBe('evt_abc');
    expect(row.event_type).toBe('invoice.paid');
    expect(row.livemode).toBe(1);
    expect(row.api_version).toBe('2024-06-20');
    expect(row.received_at).toBe('2026-01-15 10:30:45.123');
    expect(JSON.parse(row.stripe_event).id).toBe('evt_abc');
  });

  it('emits livemode=0 for test events', () => {
    const row = buildStripePipelineRow(makeEvent({ livemode: false }));
    expect(row.livemode).toBe(0);
  });

  it('coerces missing api_version to empty string', () => {
    const event = makeEvent();
    (event as { api_version: string | null }).api_version = null;
    const row = buildStripePipelineRow(event);
    expect(row.api_version).toBe('');
  });

  it('preserves the full Stripe event payload as JSON', () => {
    const event = makeEvent();
    (event as { data: unknown }).data = {
      object: { id: 'cs_test_123', customer: 'cus_abc' },
    };
    const row = buildStripePipelineRow(event);
    const parsed = JSON.parse(row.stripe_event);
    expect(parsed.data.object.id).toBe('cs_test_123');
    expect(parsed.data.object.customer).toBe('cus_abc');
  });
});

describe('emitStripeEvent', () => {
  beforeEach(() => {
    mockInsert.mockReset();
    mockInsert.mockResolvedValue(undefined);
  });

  it('inserts a single row into opengander.stripe_events as JSONEachRow', async () => {
    await emitStripeEvent(makeEvent({ id: 'evt_xyz', type: 'charge.refunded' }));

    expect(mockInsert).toHaveBeenCalledTimes(1);
    const call = mockInsert.mock.calls[0][0];
    expect(call.table).toBe('opengander.stripe_events');
    expect(call.format).toBe('JSONEachRow');
    expect(call.values).toHaveLength(1);
    expect(call.values[0].event_id).toBe('evt_xyz');
    expect(call.values[0].event_type).toBe('charge.refunded');
  });

  it('propagates insert errors so the handler can return 500', async () => {
    mockInsert.mockRejectedValueOnce(new Error('clickhouse down'));
    await expect(emitStripeEvent(makeEvent())).rejects.toThrow('clickhouse down');
  });
});
