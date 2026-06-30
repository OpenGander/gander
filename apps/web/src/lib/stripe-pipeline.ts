import type Stripe from 'stripe';
import { getClickHouseClient } from './clickhouse';
import { formatDateTime } from './oauth/clickhouse-datetime';
import { pgConfigEnabled } from './db/config-flag';
import * as miscPg from './queries/misc-pg';
import logger from './logger';

export interface StripePipelineRow {
  event_id: string;
  received_at: string;
  event_type: string;
  livemode: number;
  api_version: string;
  stripe_event: string;
}

export function buildStripePipelineRow(
  event: Stripe.Event,
  now: Date = new Date()
): StripePipelineRow {
  return {
    event_id: event.id,
    received_at: formatDateTime(now),
    event_type: event.type,
    livemode: event.livemode ? 1 : 0,
    api_version: event.api_version ?? '',
    stripe_event: JSON.stringify(event),
  };
}

export async function emitStripeEvent(event: Stripe.Event): Promise<void> {
  const row = buildStripePipelineRow(event);
  if (pgConfigEnabled()) {
    await miscPg.insertStripeEvent(event);
  } else {
    const client = getClickHouseClient();
    await client.insert({
      table: 'opengander.stripe_events',
      values: [row],
      format: 'JSONEachRow',
    });
  }
  logger.debug(
    { eventId: row.event_id, eventType: row.event_type, livemode: row.livemode },
    'Stripe event emitted to pipeline'
  );
}
