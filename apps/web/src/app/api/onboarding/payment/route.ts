import { NextRequest, NextResponse } from 'next/server';
import { verifyOnboardingToken, generateOnboardingToken } from '@/lib/auth';
import logger from '@/lib/logger';

const ONBOARDING_COOKIE_NAME = 'opengander_onboarding';

export async function POST(req: NextRequest) {
  try {
    const onboardingToken = req.cookies.get(ONBOARDING_COOKIE_NAME)?.value;

    if (!onboardingToken) {
      return NextResponse.json({ error: 'No onboarding session found' }, { status: 401 });
    }

    const payload = await verifyOnboardingToken(onboardingToken);

    if (!payload || payload.step !== 'payment') {
      return NextResponse.json({ error: 'Invalid or expired onboarding session' }, { status: 401 });
    }

    const { interval, skipPayment } = await req.json();

    // Dev mode: skip payment entirely
    if (skipPayment && process.env.NODE_ENV === 'development') {
      const newOnboardingToken = await generateOnboardingToken(
        payload.email,
        'domains',
        payload.tenantId
      );

      const response = NextResponse.json({
        success: true,
        nextStep: '/onboarding/domains',
      });

      response.cookies.set({
        name: ONBOARDING_COOKIE_NAME,
        value: newOnboardingToken,
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 3600,
        path: '/',
      });

      return response;
    }

    // Stripe Checkout Session
    const { stripe } = await import('@/lib/stripe');

    const priceId =
      interval === 'annual'
        ? process.env.STRIPE_PRICE_ID_ANNUAL
        : process.env.STRIPE_PRICE_ID_MONTHLY;

    if (!priceId) {
      return NextResponse.json({ error: 'Stripe price not configured' }, { status: 500 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: payload.email,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: 14,
        metadata: {
          tenantId: payload.tenantId || '',
        },
      },
      metadata: {
        tenantId: payload.tenantId || '',
        email: payload.email,
      },
      success_url: `${appUrl}/api/onboarding/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/onboarding/payment`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    logger.error({ err: error }, 'Payment session creation failed');
    return NextResponse.json({ error: 'Failed to create payment session' }, { status: 500 });
  }
}
