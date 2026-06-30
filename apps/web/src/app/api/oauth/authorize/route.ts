/**
 * OAuth 2.1 Authorization Endpoint
 *
 * GET /api/oauth/authorize - Validate params and redirect to login/consent
 * POST /api/oauth/authorize - Process consent and issue authorization code
 *
 * Implements OAuth 2.1 Authorization Code Flow with PKCE:
 * 1. AI client sends user here with OAuth params
 * 2. User logs in if needed (redirect to /login)
 * 3. User sees consent page (/oauth/authorize UI)
 * 4. User approves -> POST here creates code
 * 5. Redirect back to client with code
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import {
  getClient,
  validateRedirectUriForClient,
  validateScopesForClient,
} from '@/lib/oauth/clients';
import { createAuthorizationCode } from '@/lib/oauth/codes';
import logger from '@/lib/logger';

/**
 * OAuth error response per RFC 6749 Section 4.1.2.1
 */
interface OAuthError {
  error: string;
  error_description?: string;
}

/**
 * Build OAuth error redirect URL
 */
function buildErrorRedirect(
  redirectUri: string,
  error: string,
  errorDescription: string,
  state?: string
): URL {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  url.searchParams.set('error_description', errorDescription);
  if (state) {
    url.searchParams.set('state', state);
  }
  return url;
}

/**
 * Return an error page (for invalid client_id or redirect_uri)
 * MUST NOT redirect to prevent open redirect attacks
 */
function errorPage(error: string, description: string): NextResponse {
  // Return HTML error page instead of redirect
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorization Error - OpenGander</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: #f9fafb;
    }
    .error-card {
      background: white;
      padding: 2rem;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      max-width: 400px;
      text-align: center;
    }
    h1 { color: #dc2626; margin: 0 0 1rem; font-size: 1.5rem; }
    p { color: #4b5563; margin: 0; }
    code { background: #f3f4f6; padding: 0.25rem 0.5rem; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="error-card">
    <h1>Authorization Error</h1>
    <p><code>${error}</code></p>
    <p style="margin-top: 1rem;">${description}</p>
  </div>
</body>
</html>
  `.trim();

  return new NextResponse(html, {
    status: 400,
    headers: { 'Content-Type': 'text/html' },
  });
}

/**
 * Validate required OAuth authorization parameters
 */
function validateAuthParams(searchParams: URLSearchParams): {
  valid: boolean;
  error?: OAuthError;
  params?: {
    client_id: string;
    redirect_uri: string;
    response_type: string;
    code_challenge: string;
    code_challenge_method: string;
    scope: string;
    state: string;
    resource?: string;
  };
} {
  const client_id = searchParams.get('client_id');
  const redirect_uri = searchParams.get('redirect_uri');
  const response_type = searchParams.get('response_type');
  const code_challenge = searchParams.get('code_challenge');
  const code_challenge_method = searchParams.get('code_challenge_method');
  const scope = searchParams.get('scope');
  const state = searchParams.get('state');
  const resource = searchParams.get('resource') || undefined;

  // Required parameters
  if (!client_id) {
    return {
      valid: false,
      error: { error: 'invalid_request', error_description: 'Missing client_id' },
    };
  }
  if (!redirect_uri) {
    return {
      valid: false,
      error: { error: 'invalid_request', error_description: 'Missing redirect_uri' },
    };
  }
  if (!response_type) {
    return {
      valid: false,
      error: { error: 'invalid_request', error_description: 'Missing response_type' },
    };
  }
  if (!code_challenge) {
    return {
      valid: false,
      error: {
        error: 'invalid_request',
        error_description: 'Missing code_challenge (PKCE required)',
      },
    };
  }
  if (!code_challenge_method) {
    return {
      valid: false,
      error: { error: 'invalid_request', error_description: 'Missing code_challenge_method' },
    };
  }
  if (!scope) {
    return {
      valid: false,
      error: { error: 'invalid_request', error_description: 'Missing scope' },
    };
  }
  if (!state) {
    return {
      valid: false,
      error: { error: 'invalid_request', error_description: 'Missing state' },
    };
  }

  // Validate response_type
  if (response_type !== 'code') {
    return {
      valid: false,
      error: {
        error: 'unsupported_response_type',
        error_description: 'Only response_type=code is supported',
      },
    };
  }

  // Validate code_challenge_method
  if (code_challenge_method !== 'S256') {
    return {
      valid: false,
      error: {
        error: 'invalid_request',
        error_description: 'Only code_challenge_method=S256 is supported',
      },
    };
  }

  return {
    valid: true,
    params: {
      client_id,
      redirect_uri,
      response_type,
      code_challenge,
      code_challenge_method,
      scope,
      state,
      resource,
    },
  };
}

/**
 * GET /api/oauth/authorize
 *
 * Entry point for OAuth authorization flow.
 * Validates parameters, checks authentication, redirects appropriately.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  // Step 1: Validate parameters
  const validation = validateAuthParams(searchParams);
  if (!validation.valid || !validation.params) {
    // If we can't validate client_id or redirect_uri, show error page
    const client_id = searchParams.get('client_id');
    const redirect_uri = searchParams.get('redirect_uri');

    if (!client_id) {
      return errorPage('invalid_client', 'Unknown or missing client_id');
    }

    const client = await getClient(client_id);
    if (!client) {
      return errorPage('invalid_client', 'Unknown or missing client_id');
    }
    if (!redirect_uri || !validateRedirectUriForClient(client, redirect_uri)) {
      return errorPage('invalid_request', 'Invalid or missing redirect_uri');
    }

    // Other validation errors can redirect with error
    const state = searchParams.get('state') || undefined;
    const errorUrl = buildErrorRedirect(
      redirect_uri,
      validation.error!.error,
      validation.error!.error_description || 'Invalid request',
      state
    );
    return NextResponse.redirect(errorUrl);
  }

  const { client_id, redirect_uri, scope, state, resource } = validation.params;

  logger.info(
    { client_id, scope, resource: resource || '(not provided)' },
    'OAuth authorize request'
  );

  // Step 2: Validate client_id
  const client = await getClient(client_id);
  if (!client) {
    return errorPage('invalid_client', 'Unknown client_id');
  }

  // Step 3: Validate redirect_uri
  if (!validateRedirectUriForClient(client, redirect_uri)) {
    return errorPage('invalid_request', 'redirect_uri is not registered for this client');
  }

  // Step 4: Validate scopes
  const requestedScopes = scope.split(' ').filter(Boolean);
  if (!validateScopesForClient(client, requestedScopes)) {
    const errorUrl = buildErrorRedirect(
      redirect_uri,
      'invalid_scope',
      'One or more requested scopes are not allowed for this client',
      state
    );
    return NextResponse.redirect(errorUrl);
  }

  // Step 5: Check if user is authenticated
  const session = await verifySession(req);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  if (!session) {
    // Not authenticated - redirect to login with return URL
    // Preserve all OAuth params so we can resume after login
    const loginUrl = new URL('/signin', baseUrl);
    const returnUrl = `/api/oauth/authorize?${searchParams.toString()}`;
    loginUrl.searchParams.set('returnUrl', returnUrl);
    return NextResponse.redirect(loginUrl);
  }

  // Step 6: User is authenticated - redirect to consent page
  // The consent page is a UI that shows what permissions are being requested
  const consentUrl = new URL('/oauth/authorize', baseUrl);

  // Pass all OAuth params to consent page
  consentUrl.searchParams.set('client_id', client_id);
  consentUrl.searchParams.set('redirect_uri', redirect_uri);
  consentUrl.searchParams.set('response_type', validation.params.response_type);
  consentUrl.searchParams.set('code_challenge', validation.params.code_challenge);
  consentUrl.searchParams.set('code_challenge_method', validation.params.code_challenge_method);
  consentUrl.searchParams.set('scope', scope);
  consentUrl.searchParams.set('state', state);
  if (resource) {
    consentUrl.searchParams.set('resource', resource);
  }

  return NextResponse.redirect(consentUrl);
}

/**
 * POST /api/oauth/authorize
 *
 * Called when user clicks "Allow" on the consent page.
 * Creates authorization code and redirects back to client.
 */
export async function POST(req: NextRequest) {
  try {
    // Step 1: User must be authenticated
    const session = await verifySession(req);
    if (!session) {
      return NextResponse.json(
        { error: 'unauthorized', error_description: 'User not authenticated' },
        { status: 401 }
      );
    }

    // Step 2: Parse form data (consent form submission)
    const formData = await req.formData();
    const client_id = formData.get('client_id') as string;
    const redirect_uri = formData.get('redirect_uri') as string;
    const response_type = formData.get('response_type') as string;
    const code_challenge = formData.get('code_challenge') as string;
    const code_challenge_method = formData.get('code_challenge_method') as string;
    const scope = formData.get('scope') as string;
    const state = formData.get('state') as string;
    const resource = (formData.get('resource') as string) || undefined;

    // Step 3: Validate all parameters (same as GET)
    if (
      !client_id ||
      !redirect_uri ||
      !response_type ||
      !code_challenge ||
      !code_challenge_method ||
      !scope ||
      !state
    ) {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'Missing required parameters' },
        { status: 400 }
      );
    }

    // Step 4: Validate client
    const client = await getClient(client_id);
    if (!client) {
      return NextResponse.json(
        { error: 'invalid_client', error_description: 'Unknown client_id' },
        { status: 400 }
      );
    }

    // Step 5: Validate redirect_uri
    if (!validateRedirectUriForClient(client, redirect_uri)) {
      return NextResponse.json(
        {
          error: 'invalid_request',
          error_description: 'redirect_uri is not registered for this client',
        },
        { status: 400 }
      );
    }

    // Step 6: Validate response_type and code_challenge_method
    if (response_type !== 'code') {
      const errorUrl = buildErrorRedirect(
        redirect_uri,
        'unsupported_response_type',
        'Only response_type=code is supported',
        state
      );
      return NextResponse.redirect(errorUrl, 302);
    }

    if (code_challenge_method !== 'S256') {
      const errorUrl = buildErrorRedirect(
        redirect_uri,
        'invalid_request',
        'Only code_challenge_method=S256 is supported',
        state
      );
      return NextResponse.redirect(errorUrl, 302);
    }

    // Step 7: Validate scopes
    const requestedScopes = scope.split(' ').filter(Boolean);
    if (!validateScopesForClient(client, requestedScopes)) {
      const errorUrl = buildErrorRedirect(
        redirect_uri,
        'invalid_scope',
        'One or more requested scopes are not allowed for this client',
        state
      );
      return NextResponse.redirect(errorUrl, 302);
    }

    // Step 8: Create authorization code
    const code = await createAuthorizationCode({
      clientId: client_id,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method,
      userId: session.userId,
      tenantId: session.tenantId,
      scope,
      resource,
    });

    // Step 9: Redirect to client with authorization code
    // Use 302 (Found) to change POST to GET - 307 would preserve POST method
    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set('code', code);
    redirectUrl.searchParams.set('state', state);

    logger.info(
      { client_id, scope, redirect_uri, resource: resource || '(not set)' },
      'OAuth authorization code issued, redirecting to client'
    );

    return NextResponse.redirect(redirectUrl, 302);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    const diagnostics = {
      err: error,
      error_message: errorMessage,
      error_stack: errorStack,
      has_private_key: !!process.env.JWT_PRIVATE_KEY,
      has_public_key: !!process.env.JWT_PUBLIC_KEY,
      has_key_id: !!process.env.JWT_KEY_ID,
      clickhouse_host: process.env.CLICKHOUSE_HOST || '(not set)',
    };
    logger.error(diagnostics, 'OAuth authorize POST error');
    return NextResponse.json(
      { error: 'server_error', error_description: 'Internal server error' },
      { status: 500 }
    );
  }
}
