'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const RETURN_URL_COOKIE_NAME = 'opengander_return_url';

const DEV_PERSONAS = [
  { label: 'Superadmin', desc: 'Global access, all tenants', email: 'chrisdbaldwin@gmail.com' },
  { label: 'Admin', desc: 'Acme Agency admin', email: 'admin@acme-agency.com' },
  { label: 'Moderator', desc: 'Can manage users', email: 'moderator@acme-agency.com' },
  { label: 'User', desc: 'View-only, Client One', email: 'viewer@clientone.com' },
  { label: 'Multi-tenant', desc: 'Agency + 2 clients', email: 'multi@acme-agency.com' },
] as const;

function MountainLogo() {
  return (
    <div className="w-14 h-14 mx-auto mb-4 bg-primary rounded-2xl flex items-center justify-center shadow-md">
      <svg width="28" height="28" viewBox="0 0 36 36" fill="none">
        <path
          d="M4 28 L12 12 L16 18 L22 8 L32 28 Z"
          fill="rgba(255,255,255,0.25)"
          stroke="white"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path
          d="M22 8 L25 14 L28 11 L32 28"
          fill="none"
          stroke="white"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d="M8 28 C10 24, 14 22, 18 24 C22 26, 26 24, 30 28"
          fill="none"
          stroke="#c4a97a"
          strokeWidth="1.2"
          strokeLinecap="round"
          opacity="0.8"
        />
      </svg>
    </div>
  );
}

function BrandHeader() {
  return (
    <div className="text-center mb-8 relative z-10">
      <MountainLogo />
      <h1 className="font-serif text-3xl text-foreground tracking-tight">Welcome to OpenGander</h1>
      <p className="text-muted-foreground mt-2">
        Your trail to clear, honest analytics starts here
      </p>
    </div>
  );
}

function MountainLandscape() {
  return (
    <div className="fixed bottom-0 left-0 right-0 h-48 pointer-events-none overflow-hidden z-0">
      <svg viewBox="0 0 1440 200" fill="none" preserveAspectRatio="none" className="w-full h-full">
        <path
          d="M0 140 L120 80 L240 110 L360 60 L480 90 L600 50 L720 85 L840 45 L960 75 L1080 55 L1200 70 L1320 40 L1440 80 L1440 200 L0 200Z"
          className="fill-primary/[0.08]"
        />
        <path
          d="M0 160 L100 120 L200 140 L350 95 L500 130 L650 85 L800 115 L950 80 L1100 110 L1250 90 L1350 105 L1440 95 L1440 200 L0 200Z"
          className="fill-primary/[0.06]"
        />
        <path
          d="M0 175 L150 145 L300 160 L450 135 L600 155 L750 130 L900 150 L1050 140 L1200 155 L1350 145 L1440 150 L1440 200 L0 200Z"
          className="fill-primary/[0.04]"
        />
      </svg>
    </div>
  );
}

function RadialGradientOverlay() {
  return (
    <div
      className="absolute inset-0 pointer-events-none opacity-60"
      style={{
        background:
          'radial-gradient(ellipse at 20% 80%, hsl(120 30% 95%) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, hsl(40 44% 89%) 0%, transparent 40%)',
      }}
    />
  );
}

function DevNewSignup() {
  const [loading, setLoading] = useState(false);
  const [signupLink, setSignupLink] = useState('');
  const [error, setError] = useState('');

  async function handleTestSignup() {
    setLoading(true);
    setError('');
    setSignupLink('');

    const testEmail = `test-${Date.now()}@dev.opengander.io`;

    try {
      const response = await fetch('/api/auth/send-magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send magic link');
      }

      if (data._dev_link) {
        setSignupLink(data._dev_link);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <p className="text-xs font-semibold text-yellow-700 uppercase mb-2">Test New Signup</p>
      <Button
        variant="outline"
        className="w-full text-yellow-700 border-yellow-300 bg-yellow-50 hover:bg-yellow-100"
        disabled={loading}
        onClick={handleTestSignup}
      >
        {loading ? 'Generating...' : 'Generate Test Signup Link'}
      </Button>
      {signupLink && (
        <div className="mt-2 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
          <p className="text-xs text-yellow-800 mb-1">Click to start onboarding:</p>
          <a
            href={signupLink}
            className="text-xs text-primary hover:text-primary/80 underline break-all"
          >
            {signupLink}
          </a>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function SignInContent() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [devLink, setDevLink] = useState('');
  const [devLoading, setDevLoading] = useState(false);

  const handleDevLogin = async (personaEmail: string) => {
    setDevLoading(true);
    setError('');
    try {
      const response = await fetch('/api/auth/dev-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: personaEmail }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Dev login failed');
      }
      window.location.href = data.redirectUrl || '/';
    } catch (err: any) {
      setError(err.message);
      setDevLoading(false);
    }
  };

  // Store returnUrl in cookie on mount
  useEffect(() => {
    const returnUrl = searchParams.get('returnUrl');
    if (returnUrl && returnUrl.startsWith('/') && !returnUrl.startsWith('//')) {
      // Set cookie with 15 minute expiry (matches magic link expiry)
      const secure = window.location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = `${RETURN_URL_COOKIE_NAME}=${encodeURIComponent(returnUrl)}; path=/; max-age=900; SameSite=Lax${secure}`;
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/send-magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send magic link');
      }

      setSent(true);
      if (data._dev_link) {
        setDevLink(data._dev_link);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background relative p-4">
        <RadialGradientOverlay />
        <BrandHeader />
        <Card className="w-full max-w-md relative overflow-hidden z-10">
          <div className="absolute top-0 left-6 right-6 h-[3px] rounded-b-sm bg-gradient-to-r from-transparent via-primary to-transparent opacity-70" />
          <CardHeader>
            <CardTitle>Check your email</CardTitle>
            <CardDescription>We sent a magic link to {email}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Click the link in your email to sign in. The link will expire in 15 minutes.
            </p>
            {devLink && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <p className="text-xs font-semibold text-yellow-800 mb-2">DEV MODE:</p>
                <a
                  href={devLink}
                  className="text-xs text-primary hover:text-primary/80 underline break-all"
                >
                  {devLink}
                </a>
              </div>
            )}
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setSent(false);
                setEmail('');
                setDevLink('');
              }}
            >
              Send another link
            </Button>
          </CardContent>
        </Card>
        <MountainLandscape />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background relative p-4">
      <RadialGradientOverlay />
      <BrandHeader />
      <Card className="w-full max-w-md relative overflow-hidden z-10">
        <div className="absolute top-0 left-6 right-6 h-[3px] rounded-b-sm bg-gradient-to-r from-transparent via-primary to-transparent opacity-70" />
        <CardHeader>
          <CardTitle>Sign In</CardTitle>
          <CardDescription>Enter your email to receive a magic link</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Input
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Sending...' : 'Send Magic Link'}
            </Button>
          </form>

          {process.env.NODE_ENV === 'development' && (
            <div className="mt-6 border-t pt-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-3">
                Development Quick Login
              </p>
              <div className="space-y-2">
                {DEV_PERSONAS.map((p) => (
                  <Button
                    key={p.email}
                    variant="outline"
                    className="w-full justify-start text-left h-auto py-2"
                    disabled={devLoading}
                    onClick={() => handleDevLogin(p.email)}
                  >
                    <div>
                      <span className="font-medium">{p.label}</span>
                      <span className="text-muted-foreground mx-1.5">&middot;</span>
                      <span className="text-muted-foreground text-sm">{p.desc}</span>
                      <div className="text-xs text-muted-foreground">{p.email}</div>
                    </div>
                  </Button>
                ))}
              </div>

              {/* Test New Signup */}
              <div className="mt-4 pt-4 border-t border-dashed">
                <DevNewSignup />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <MountainLandscape />
    </div>
  );
}

function SignInFallback() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background relative p-4">
      <RadialGradientOverlay />
      <BrandHeader />
      <Card className="w-full max-w-md relative overflow-hidden z-10">
        <div className="absolute top-0 left-6 right-6 h-[3px] rounded-b-sm bg-gradient-to-r from-transparent via-primary to-transparent opacity-70" />
        <CardHeader>
          <CardTitle>Sign In</CardTitle>
          <CardDescription>Enter your email to receive a magic link</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="h-10 bg-muted rounded animate-pulse" />
            <div className="h-10 bg-muted rounded animate-pulse" />
          </div>
        </CardContent>
      </Card>
      <MountainLandscape />
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<SignInFallback />}>
      <SignInContent />
    </Suspense>
  );
}
