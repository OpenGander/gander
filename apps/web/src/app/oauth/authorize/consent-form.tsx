'use client';

/**
 * OAuth Consent Form Component
 *
 * Client component that handles the Allow and Deny buttons for OAuth consent.
 * - Allow: Submits form to POST /api/oauth/authorize
 * - Deny: Redirects to client with access_denied error
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface ConsentFormProps {
  clientId: string;
  redirectUri: string;
  responseType: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
  state: string;
  resource?: string;
}

export function ConsentForm({
  clientId,
  redirectUri,
  responseType,
  codeChallenge,
  codeChallengeMethod,
  scope,
  state,
  resource,
}: ConsentFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleDeny = () => {
    // Build the deny redirect URL
    const url = new URL(redirectUri);
    url.searchParams.set('error', 'access_denied');
    url.searchParams.set('error_description', 'User denied access');
    url.searchParams.set('state', state);

    // Redirect to client with error
    window.location.href = url.toString();
  };

  return (
    <form action="/api/oauth/authorize" method="POST" onSubmit={() => setIsSubmitting(true)}>
      {/* Hidden fields for OAuth parameters */}
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="redirect_uri" value={redirectUri} />
      <input type="hidden" name="response_type" value={responseType} />
      <input type="hidden" name="code_challenge" value={codeChallenge} />
      <input type="hidden" name="code_challenge_method" value={codeChallengeMethod} />
      <input type="hidden" name="scope" value={scope} />
      <input type="hidden" name="state" value={state} />
      {resource && <input type="hidden" name="resource" value={resource} />}

      {/* Action buttons */}
      <div className="flex gap-3">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={handleDeny}
          disabled={isSubmitting}
        >
          Deny
        </Button>
        <Button type="submit" className="flex-1" disabled={isSubmitting}>
          {isSubmitting ? 'Authorizing...' : 'Allow'}
        </Button>
      </div>
    </form>
  );
}
