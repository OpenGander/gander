import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { updateTenantStripe } from '@/lib/queries/tenants';
import { emitStripeEvent } from '@/lib/stripe-pipeline';
import logger from '@/lib/logger';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const signature = req.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !secret) {
    logger.error(
      { hasSignature: !!signature, hasSecret: !!secret },
      'Stripe webhook: missing signature or webhook secret'
    );
    return NextResponse.json({ error: 'Missing signature or webhook secret' }, { status: 400 });
  }

  const rawBody = await req.text();
  const { stripe } = await import('@/lib/stripe');

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    const errorType = err instanceof Error ? err.constructor.name : typeof err;
    logger.error({ errorType }, 'Stripe webhook: signature verification failed');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    await emitStripeEvent(event);
  } catch (err) {
    logger.error(
      { err, eventId: event.id, eventType: event.type },
      'Stripe webhook: pipeline emit failed'
    );
    return NextResponse.json({ error: 'Pipeline emit failed' }, { status: 500 });
  }

  logger.info({ type: event.type, id: event.id }, 'Stripe webhook received');

  try {
    await applyLegacyTenantUpdates(event);
  } catch (err) {
    logger.error(
      { err, eventId: event.id, eventType: event.type },
      'Stripe webhook: legacy tenant update failed'
    );
    return NextResponse.json({ error: 'Legacy tenant update failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// TODO: strip when stripe_events consumer ships. Until then, keep these
// inline writes so tenant billing state (SubscriptionStatus, TrialEndsAt)
// stays current. Duplicates work the consumer will do.
async function applyLegacyTenantUpdates(event: Stripe.Event) {
  const { stripe } = await import('@/lib/stripe');

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const tenantId = session.metadata?.tenantId;
      if (tenantId && session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
        const trialEndsAt = subscription.trial_end ? new Date(subscription.trial_end * 1000) : null;

        await updateTenantStripe(tenantId, {
          stripeCustomerId: session.customer as string,
          stripeSubscriptionId: session.subscription as string,
          subscriptionStatus: subscription.status,
          trialEndsAt,
        });
      }
      break;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      const tenantId = subscription.metadata?.tenantId;
      if (tenantId) {
        const trialEndsAt = subscription.trial_end ? new Date(subscription.trial_end * 1000) : null;

        await updateTenantStripe(tenantId, {
          subscriptionStatus: subscription.status,
          trialEndsAt,
        });
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const tenantId = subscription.metadata?.tenantId;
      if (tenantId) {
        await updateTenantStripe(tenantId, {
          subscriptionStatus: 'canceled',
        });
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const subscriptionId = invoice.parent?.subscription_details?.subscription as
        | string
        | undefined;
      if (subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const tenantId = subscription.metadata?.tenantId;
        if (tenantId) {
          await updateTenantStripe(tenantId, {
            subscriptionStatus: 'past_due',
          });
        }
      }
      break;
    }
  }
}
