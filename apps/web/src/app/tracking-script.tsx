'use client';

import Script from 'next/script';

export function TrackingScript() {
  return (
    <Script
      src="https://app.opengander.io/sdk/opengander-sdk.js"
      strategy="afterInteractive"
      onLoad={() => {
        // @ts-expect-error - initOtelBrowser is loaded by the SDK
        window.initOtelBrowser({
          serviceName: 'app.opengander.io',
          collectorUrl: 'https://collect.opengander.io/v1/traces',
          tokenEndpoint: 'https://token.opengander.io/api/telemetry-token',
          debug: false,
          patterns: {
            contentTypes: {
              auth: { path: '/signin' },
              onboarding: { path: '/onboarding/*' },
              dashboard: { path: '/*' },
              settings: { path: '/settings/*' },
            },
            conversions: [
              { name: 'onboarding_start', match: { href: '/onboarding/checkout' } },
              { name: 'onboarding_domains', match: { href: '/onboarding/domains' } },
              { name: 'onboarding_complete', match: { href: '/onboarding/snippet' } },
              { name: 'invite_accepted', match: { href: '/invite/accept' } },
            ],
          },
        });
      }}
    />
  );
}
