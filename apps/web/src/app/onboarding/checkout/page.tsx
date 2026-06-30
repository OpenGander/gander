'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, Loader2 } from 'lucide-react';

const features = [
  'Unlimited page views',
  'Real-time analytics',
  'Web Vitals tracking',
  'User journey analysis',
  'Privacy-first design',
  'No cookie banners needed',
];

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

export default function CheckoutPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);

  // Auto-generate slug from company name until user manually edits it
  useEffect(() => {
    if (!slugTouched && companyName) {
      setSlug(generateSlug(companyName));
    }
  }, [companyName, slugTouched]);

  async function handleStartTrial() {
    if (!companyName.trim()) {
      setError('Company name is required');
      return;
    }
    if (!slug.trim()) {
      setError('URL slug is required');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/onboarding/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName: companyName.trim(), slug: slug.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to start trial');
      }

      // Redirect to domains page
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
          <CardTitle className="text-2xl">Join Early Access</CardTitle>
          <CardDescription>Help us build something great</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Company Info Form */}
          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="companyName" className="text-sm font-medium text-foreground">
                Company Name
              </label>
              <Input
                id="companyName"
                type="text"
                placeholder="Acme Corp"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="slug" className="text-sm font-medium text-foreground">
                URL Slug
              </label>
              <div className="flex items-center">
                <span className="text-sm text-muted-foreground mr-1">opengander.io/</span>
                <Input
                  id="slug"
                  type="text"
                  placeholder="acme-corp"
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(generateSlug(e.target.value));
                  }}
                  disabled={isLoading}
                  className="flex-1"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                This will be your unique workspace identifier
              </p>
            </div>
          </div>

          {/* Features */}
          <ul className="space-y-3">
            {features.map((feature) => (
              <li key={feature} className="flex items-center text-sm text-muted-foreground">
                <Check className="mr-3 h-4 w-4 text-green-500" />
                {feature}
              </li>
            ))}
          </ul>

          {/* Error message */}
          {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}

          {/* CTA Button */}
          <Button onClick={handleStartTrial} disabled={isLoading} className="w-full" size="lg">
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Setting up...
              </>
            ) : (
              'Get Started'
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
