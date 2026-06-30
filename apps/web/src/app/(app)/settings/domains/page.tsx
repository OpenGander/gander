/**
 * Domains Settings Page
 * Manage website domains for telemetry collection
 */

'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Globe, Plus, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DomainsTable, AddDomainDialog } from '@/components/settings';
import type { TenantDomain, Role } from '@/lib/types/user-management';

export default function DomainsPage() {
  const [domains, setDomains] = useState<TenantDomain[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [session, setSession] = useState<{ role: Role } | null>(null);

  // Fetch session to check permissions
  useEffect(() => {
    const getSession = async () => {
      try {
        const res = await fetch('/api/me');
        if (res.ok) {
          const data = await res.json();
          setSession({ role: data.role as Role });
        }
      } catch (err) {
        console.error('Failed to get session:', err);
      }
    };
    getSession();
  }, []);

  // Fetch domains
  const fetchDomains = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch('/api/domains');
      if (!res.ok) {
        if (res.status === 403) {
          setError('You do not have permission to manage domains');
          return;
        }
        throw new Error('Failed to fetch domains');
      }
      const data = await res.json();
      setDomains(data.domains);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch domains');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDomains();
  }, [fetchDomains]);

  // Add domain handler
  const handleAddDomain = async (domain: string, displayName?: string) => {
    const res = await fetch('/api/domains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, displayName }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to add domain');
    }

    // Refresh the list
    await fetchDomains();
  };

  // Remove domain handler
  const handleRemoveDomain = async (domainId: string) => {
    const res = await fetch(`/api/domains/${domainId}`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to remove domain');
    }

    // Refresh the list
    await fetchDomains();
  };

  // Check if user has admin permission
  const isAdmin = session?.role === 'admin' || session?.role === 'superadmin';

  return (
    <div className="space-y-6">
      {/* Domains Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Website Domains
            </CardTitle>
            <CardDescription>Domains registered for telemetry collection</CardDescription>
          </div>
          {isAdmin && (
            <Button onClick={() => setIsAddDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Domain
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="flex items-center gap-2 text-destructive text-sm py-4">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          ) : (
            <DomainsTable
              domains={domains}
              onRemoveDomain={handleRemoveDomain}
              isLoading={isLoading}
            />
          )}
        </CardContent>
      </Card>

      {/* Empty State Info */}
      {!isLoading && !error && domains.length === 0 && (
        <Card>
          <CardContent className="py-8">
            <div className="text-center">
              <Globe className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No domains configured</h3>
              <p className="text-muted-foreground mb-4">
                Add your first domain to start collecting telemetry data from your website.
              </p>
              {isAdmin && (
                <Button onClick={() => setIsAddDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Your First Domain
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* SDK Instructions */}
      {domains.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">SDK Integration</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              Add the OpenGander SDK to your website to start collecting telemetry:
            </p>
            <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto">
              {`<script src="https://cdn.opengander.io/sdk/opengander-sdk.js"></script>
<script>
  OpenGander.init({
    tokenEndpoint: 'https://your-collector.opengander.io/token'
  });
</script>`}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Add Domain Dialog */}
      <AddDomainDialog
        isOpen={isAddDialogOpen}
        onClose={() => setIsAddDialogOpen(false)}
        onAdd={handleAddDomain}
      />
    </div>
  );
}
