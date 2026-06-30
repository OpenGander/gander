/**
 * Tracking snippet generation
 * Shared utility for generating the browser SDK installation snippet
 */

export interface SnippetOptions {
  serviceName?: string;
  domains?: string[];
}

/**
 * Generate the browser SDK installation snippet
 * @param options - Either { serviceName } for explicit name, or { domains } for domain-based fallback
 */
export function generateTrackingSnippet(options: SnippetOptions = {}): string {
  const collectorUrl = process.env.COLLECTOR_DOMAIN || 'https://collect.opengander.io';
  const tokenServiceUrl = process.env.TOKEN_SERVICE_URL || 'https://token.opengander.io';
  const cdnUrl = process.env.CDN_URL || 'https://app.opengander.io/sdk';

  // Use explicit serviceName, or derive from domains, or use fallback
  const serviceName = options.serviceName
    || options.domains?.[0]?.replace(/\./g, '-')
    || 'my-site';

  return `<!-- OpenGander Analytics -->
<script>
(function() {
  var script = document.createElement('script');
  script.src = '${cdnUrl}/opengander-sdk.js';
  script.onload = function() {
    initOtelBrowser({
      serviceName: '${serviceName}',
      collectorUrl: '${collectorUrl}/v1/traces',
      tokenEndpoint: '${tokenServiceUrl}/api/telemetry-token',
      debug: false,

      // Session timeout in seconds (default: 1800 = 30 minutes)
      // Shorter for sensitive apps, longer for content sites
      sessionTimeout: 1800,

      patterns: {
        // Content types - categorize pages by URL path
        contentTypes: {
          // 'blog_post': { path: '/blog/*' },
          // 'product': { path: '/products/*' },
          // 'landing_page': { path: '/' }
        },
        // Conversions - track important user actions
        conversions: [
          // { name: 'signup', match: { href: '/signup/complete' } },
          // { name: 'contact', match: { href: 'mailto:*' } },
          // { name: 'purchase', match: { href: '/checkout/success' } }
        ]
      }
    });
  };
  document.head.appendChild(script);
})();
</script>`;
}

/**
 * Get platform-specific installation instructions
 */
export function getPlatformInstructions(platform: string): string {
  switch (platform) {
    case 'web':
      return `Add this snippet to your HTML, just before the closing </body> tag. The SDK will automatically track page views, user interactions, and Core Web Vitals.`;
    case 'nodejs':
      return `Install the Node.js SDK:

npm install @opengander/nodejs-sdk

Then initialize in your application:

import { initOpenGander } from '@opengander/nodejs-sdk';

initOpenGander({
  serviceName: 'YOUR_SERVICE_NAME',
  collectorUrl: 'https://collect.opengander.io/v1/traces'
});`;
    case 'python':
      return `Install the Python SDK:

pip install opengander-python-sdk

Then initialize in your application:

from opengander import init_opengander

init_opengander(
    service_name="YOUR_SERVICE_NAME",
    collector_url="https://collect.opengander.io/v1/traces"
)`;
    default:
      return `Add the tracking code to your application. Choose the appropriate SDK for your platform.`;
  }
}
