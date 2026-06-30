/**
 * Invite Accept Page
 * Allows users to accept invitations and join an organization
 */

'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CheckCircle, XCircle, Loader2, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ROLE_LABELS, type Role } from '@/lib/types/user-management';
import { cn, formatDate } from '@/lib/utils';

interface InviteDetails {
  InviteId: string;
  Email: string;
  TenantId: string;
  TenantName?: string;
  Role: Role;
  ExpiresAt: string;
}

function AcceptInviteContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');

  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAccepting, setIsAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('Missing invitation token');
      setIsLoading(false);
      return;
    }

    const fetchInvite = async () => {
      try {
        const res = await fetch(`/api/invites/accept?token=${encodeURIComponent(token)}`);
        const data = await res.json();

        if (!res.ok) {
          setError(data.error || 'Invalid invitation');
          return;
        }

        setInvite(data.invite);
      } catch {
        setError('Failed to load invitation');
      } finally {
        setIsLoading(false);
      }
    };

    fetchInvite();
  }, [token]);

  const handleAccept = async () => {
    if (!token) return;

    setIsAccepting(true);
    setError(null);

    try {
      const res = await fetch('/api/invites/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to accept invitation');
        return;
      }

      setSuccess(true);

      // Redirect to dashboard after a short delay
      setTimeout(() => {
        router.push('/');
      }, 2000);
    } catch {
      setError('Failed to accept invitation');
    } finally {
      setIsAccepting(false);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="mt-2 text-muted-foreground">Loading invitation...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6">
            <div className="text-center">
              <XCircle className="h-12 w-12 text-destructive mx-auto" />
              <h2 className="mt-4 text-lg font-semibold">Invalid Invitation</h2>
              <p className="mt-2 text-muted-foreground">{error}</p>
              <Button className="mt-6" variant="outline" onClick={() => router.push('/')}>
                Go to Homepage
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Success state
  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6">
            <div className="text-center">
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
              <h2 className="mt-4 text-lg font-semibold">Welcome!</h2>
              <p className="mt-2 text-muted-foreground">
                You've successfully joined {invite?.TenantName || 'the organization'}. Redirecting
                to dashboard...
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Invite details
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Building2 className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>You've been invited!</CardTitle>
          <CardDescription>
            Join {invite?.TenantName || 'an organization'} on OpenGander
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Invite Details */}
          <div className="space-y-3 p-4 bg-muted rounded-lg">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Email</span>
              <span className="font-medium">{invite?.Email}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Organization</span>
              <span className="font-medium">{invite?.TenantName || invite?.TenantId}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Role</span>
              <span
                className={cn(
                  'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                  invite?.Role === 'superadmin' &&
                    'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
                  invite?.Role === 'admin' &&
                    'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
                  invite?.Role === 'moderator' &&
                    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
                  invite?.Role === 'user' && 'bg-muted text-muted-foreground'
                )}
              >
                {invite?.Role ? ROLE_LABELS[invite.Role] : 'User'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Expires</span>
              <span className="text-sm">
                {invite?.ExpiresAt ? formatDate(invite.ExpiresAt) : 'N/A'}
              </span>
            </div>
          </div>

          {/* Error Message */}
          {error && <p className="text-sm text-destructive text-center">{error}</p>}

          {/* Actions */}
          <div className="flex flex-col gap-2">
            <Button onClick={handleAccept} disabled={isAccepting} className="w-full">
              {isAccepting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Accepting...
                </>
              ) : (
                'Accept Invitation'
              )}
            </Button>
            <Button
              variant="ghost"
              onClick={() => router.push('/')}
              disabled={isAccepting}
              className="w-full"
            >
              Decline
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
        <p className="mt-2 text-muted-foreground">Loading invitation...</p>
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <AcceptInviteContent />
    </Suspense>
  );
}
