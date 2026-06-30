'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Check, CreditCard, Loader2 } from 'lucide-react';

type BillingInterval = 'monthly' | 'annual';

export default function PaymentPage() {
  const router = useRouter();
  const [interval, setInterval] = useState<BillingInterval>('monthly');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDev = process.env.NODE_ENV === 'development';

  async function handleCheckout() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/onboarding/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interval }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create checkout session');
      }

      // Redirect to Stripe Checkout
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setIsLoading(false);
    }
  }

  async function handleSkipPayment() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/onboarding/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interval, skipPayment: true }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to skip payment');
      }

      router.push(data.nextStep);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setIsLoading(false);
    }
  }

  return (
    <div className="flex justify-center">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Choose Your Plan</CardTitle>
          <CardDescription>Start your 14-day free trial. Cancel anytime.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Billing toggle */}
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => setInterval('monthly')}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                interval === 'monthly'
                  ? 'bg-primary text-white'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setInterval('annual')}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                interval === 'annual'
                  ? 'bg-primary text-white'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              Annual
              <span className="ml-1.5 text-xs opacity-75">Save 20%</span>
            </button>
          </div>

          {/* Plan details */}
          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium text-foreground">Pro Plan</span>
              <div className="text-right">
                <span className="text-2xl font-bold text-foreground">
                  {interval === 'monthly' ? '$29' : '$23'}
                </span>
                <span className="text-sm text-muted-foreground">/mo</span>
                {interval === 'annual' && (
                  <p className="text-xs text-muted-foreground">$276/year (billed annually)</p>
                )}
              </div>
            </div>
          </div>

          {/* Features */}
          <ul className="space-y-2">
            {[
              'Unlimited page views',
              'Real-time analytics',
              'Web Vitals & Core Web Vitals',
              'User journey analysis',
              'Marketing attribution',
              'Priority support',
            ].map((feature) => (
              <li key={feature} className="flex items-center text-sm text-muted-foreground">
                <Check className="mr-2 h-4 w-4 text-green-500 shrink-0" />
                {feature}
              </li>
            ))}
          </ul>

          {/* Error */}
          {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}

          {/* Checkout button */}
          <Button onClick={handleCheckout} disabled={isLoading} className="w-full" size="lg">
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Redirecting to checkout...
              </>
            ) : (
              <>
                <CreditCard className="mr-2 h-4 w-4" />
                Start Free Trial
              </>
            )}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            You won&apos;t be charged until your 14-day trial ends.
          </p>

          {/* Dev mode skip */}
          {isDev && (
            <div className="border-t pt-4">
              <Button
                variant="outline"
                onClick={handleSkipPayment}
                disabled={isLoading}
                className="w-full text-yellow-700 border-yellow-300 bg-yellow-50 hover:bg-yellow-100"
              >
                Skip Payment (Dev)
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
