/**
 * Postgres implementations for the remaining Phase C tables: the waitlist /
 * magic-link store and the Stripe webhook event log. Dispatch gated by
 * pgConfigEnabled().
 */
import type Stripe from 'stripe';
import { getDb } from '@/lib/db';
import { waitlist, stripeEvents } from '@/lib/db/schema';

/**
 * Store (or refresh) a waitlist / magic-link entry. The email is unique, so a
 * repeat send for the same address updates the existing row in place rather
 * than piling up ReplacingMergeTree versions.
 */
export async function upsertWaitlistEntry(p: {
  waitlistId: string;
  email: string;
  company?: string | null;
  magicLink?: string;
  token?: string;
  source?: string;
}): Promise<void> {
  await getDb()
    .insert(waitlist)
    .values({
      waitlistId: p.waitlistId,
      email: p.email,
      company: p.company ?? null,
      magicLink: p.magicLink ?? '',
      token: p.token ?? '',
      source: p.source ?? 'signup',
    })
    .onConflictDoUpdate({
      target: waitlist.email,
      set: {
        magicLink: p.magicLink ?? '',
        token: p.token ?? '',
        source: p.source ?? 'signup',
        company: p.company ?? null,
      },
    });
}

/**
 * Append a Stripe webhook event. The event id is the primary key, so a
 * redelivered event is dropped (ON CONFLICT DO NOTHING) — real idempotency,
 * which the ClickHouse ReplacingMergeTree only approximated.
 */
export async function insertStripeEvent(
  event: Stripe.Event,
  now: Date = new Date()
): Promise<void> {
  await getDb()
    .insert(stripeEvents)
    .values({
      eventId: event.id,
      receivedAt: now,
      eventType: event.type,
      livemode: Boolean(event.livemode),
      apiVersion: event.api_version ?? '',
      stripeEvent: JSON.stringify(event),
    })
    .onConflictDoNothing();
}
