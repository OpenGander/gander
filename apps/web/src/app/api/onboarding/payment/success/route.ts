import { NextRequest, NextResponse } from 'next/server';
import { verifyOnboardingToken, generateOnboardingToken } from '@/lib/auth';
import { updateTenantStripe } from '@/lib/queries/tenants';
import logger from '@/lib/logger';

const ONBOARDING_COOKIE_NAME = 'opengander_onboarding';

export async function GET(req: NextRequest) {
  try {
    const sessionId = req.nextUrl.searchParams.get('session_id');

    if (!sessionId) {
      return NextResponse.redirect(new URL('/onboarding/payment', req.url));
    }

    const onboardingToken = req.cookies.get(ONBOARDING_COOKIE_NAME)?.value;

    if (!onboardingToken) {
      return NextResponse.redirect(new URL('/signin', req.url));
    }

    const payload = await verifyOnboardingToken(onboardingToken);

    if (!payload || payload.step !== 'payment' || !payload.tenantId) {
      return NextResponse.redirect(new URL('/signin', req.url));
    }

    // Verify the Stripe Checkout Session
    const { stripe } = await import('@/lib/stripe');
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.status !== 'complete') {
      return NextResponse.redirect(new URL('/onboarding/payment', req.url));
    }

    // Store Stripe IDs on tenant
    const customerId = session.customer as string;
    const subscriptionId = session.subscription as string;

    // Get subscription to find trial end
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const trialEndsAt = subscription.trial_end ? new Date(subscription.trial_end * 1000) : null;

    await updateTenantStripe(payload.tenantId, {
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      subscriptionStatus: subscription.status,
      trialEndsAt,
    });

    logger.info(
      { tenantId: payload.tenantId, customerId, subscriptionId },
      'Stripe checkout completed'
    );

    // Advance to domains step
    const newOnboardingToken = await generateOnboardingToken(
      payload.email,
      'domains',
      payload.tenantId
    );

    const redirectUrl = new URL('/onboarding/domains', req.url);
    const response = NextResponse.redirect(redirectUrl);

    response.cookies.set({
      name: ONBOARDING_COOKIE_NAME,
      value: newOnboardingToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 3600,
      path: '/',
    });

    return response;
  } catch (error) {
    logger.error({ err: error }, 'Payment success verification failed');
    return NextResponse.redirect(new URL('/onboarding/payment', req.url));
  }
}
