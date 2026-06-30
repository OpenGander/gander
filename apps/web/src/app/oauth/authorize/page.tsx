/**
 * OAuth 2.1 Consent Page
 *
 * Shows the user what permissions an application is requesting
 * and allows them to approve or deny access.
 *
 * This is a Server Component that receives OAuth params via URL search params.
 * The Deny button uses client-side navigation.
 */

import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import {
  getClient,
  validateRedirectUriForClient,
  validateScopesForClient,
} from '@/lib/oauth/clients';
import { ConsentForm } from './consent-form';

/**
 * Scope display names for user-friendly permission descriptions
 */
const SCOPE_DESCRIPTIONS: Record<string, string> = {
  'mcp:read': 'Read analytics data',
  'schema:read': 'View database schema',
  'health:read': 'Check service health status',
};

/**
 * Get a human-readable description for a scope
 */
function getScopeDescription(scope: string): string {
  return SCOPE_DESCRIPTIONS[scope] || scope;
}

interface PageProps {
  searchParams: Promise<{
    client_id?: string;
    redirect_uri?: string;
    response_type?: string;
    code_challenge?: string;
    code_challenge_method?: string;
    scope?: string;
    state?: string;
    resource?: string;
  }>;
}

/**
 * Error display component
 */
function ErrorDisplay({ error, description }: { error: string; description: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <div className="bg-card rounded-lg shadow-lg p-8 max-w-md w-full text-center">
        <div className="w-12 h-12 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-6 h-6 text-destructive"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-foreground mb-2">Authorization Error</h1>
        <p className="text-sm font-mono text-muted-foreground bg-muted px-3 py-1 rounded mb-3 inline-block">
          {error}
        </p>
        <p className="text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

export default async function OAuthAuthorizePage({ searchParams }: PageProps) {
  const params = await searchParams;

  const {
    client_id,
    redirect_uri,
    response_type,
    code_challenge,
    code_challenge_method,
    scope,
    state,
    resource,
  } = params;

  // Step 1: Check if user is authenticated
  const session = await getSession();

  if (!session) {
    // Build the return URL preserving all OAuth params
    const returnParams = new URLSearchParams();
    if (client_id) returnParams.set('client_id', client_id);
    if (redirect_uri) returnParams.set('redirect_uri', redirect_uri);
    if (response_type) returnParams.set('response_type', response_type);
    if (code_challenge) returnParams.set('code_challenge', code_challenge);
    if (code_challenge_method) returnParams.set('code_challenge_method', code_challenge_method);
    if (scope) returnParams.set('scope', scope);
    if (state) returnParams.set('state', state);
    if (resource) returnParams.set('resource', resource);

    const returnUrl = `/oauth/authorize?${returnParams.toString()}`;
    redirect(`/signin?returnUrl=${encodeURIComponent(returnUrl)}`);
  }

  // Step 2: Validate required parameters
  if (!client_id) {
    return <ErrorDisplay error="invalid_request" description="Missing client_id parameter" />;
  }

  if (!redirect_uri) {
    return <ErrorDisplay error="invalid_request" description="Missing redirect_uri parameter" />;
  }

  if (!response_type) {
    return <ErrorDisplay error="invalid_request" description="Missing response_type parameter" />;
  }

  if (!code_challenge) {
    return (
      <ErrorDisplay error="invalid_request" description="Missing code_challenge (PKCE required)" />
    );
  }

  if (!code_challenge_method) {
    return <ErrorDisplay error="invalid_request" description="Missing code_challenge_method" />;
  }

  if (!scope) {
    return <ErrorDisplay error="invalid_request" description="Missing scope parameter" />;
  }

  if (!state) {
    return <ErrorDisplay error="invalid_request" description="Missing state parameter" />;
  }

  // Step 3: Validate client_id
  const client = await getClient(client_id);
  if (!client) {
    return <ErrorDisplay error="invalid_client" description="Unknown client application" />;
  }

  // Step 4: Validate redirect_uri
  if (!validateRedirectUriForClient(client, redirect_uri)) {
    return (
      <ErrorDisplay
        error="invalid_request"
        description="The redirect URI is not registered for this client"
      />
    );
  }

  // Step 5: Validate response_type
  if (response_type !== 'code') {
    return (
      <ErrorDisplay
        error="unsupported_response_type"
        description="Only authorization code flow is supported"
      />
    );
  }

  // Step 6: Validate code_challenge_method
  if (code_challenge_method !== 'S256') {
    return (
      <ErrorDisplay
        error="invalid_request"
        description="Only S256 code challenge method is supported"
      />
    );
  }

  // Step 7: Validate scopes
  const requestedScopes = scope.split(' ').filter(Boolean);
  if (!validateScopesForClient(client, requestedScopes)) {
    return (
      <ErrorDisplay
        error="invalid_scope"
        description="One or more requested scopes are not allowed for this client"
      />
    );
  }

  // Step 8: All valid - render consent UI
  const scopeDescriptions = requestedScopes.map((s) => getScopeDescription(s));

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <div className="bg-card rounded-lg shadow-lg p-8 max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-primary"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold font-serif text-foreground mb-2">OpenGander</h1>
        </div>

        {/* App requesting access */}
        <div className="text-center mb-6">
          <p className="text-lg text-foreground">
            <span className="font-semibold text-foreground">{client.name}</span> wants to access
            your OpenGander account
          </p>
        </div>

        {/* Requested permissions */}
        <div className="mb-6">
          <p className="text-sm text-muted-foreground mb-3">This will allow {client.name} to:</p>
          <ul className="space-y-2">
            {scopeDescriptions.map((description, index) => (
              <li key={index} className="flex items-center text-foreground">
                <svg
                  className="w-5 h-5 text-green-500 mr-2 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                {description}
              </li>
            ))}
          </ul>
        </div>

        {/* Consent form with Allow/Deny buttons */}
        <ConsentForm
          clientId={client_id}
          redirectUri={redirect_uri}
          responseType={response_type}
          codeChallenge={code_challenge}
          codeChallengeMethod={code_challenge_method}
          scope={scope}
          state={state}
          resource={resource}
        />

        {/* Footer */}
        <p className="text-xs text-muted-foreground text-center mt-6">
          By allowing access, you agree to the app's terms and privacy policy.
        </p>
      </div>
    </div>
  );
}
