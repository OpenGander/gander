/**
 * Organization Settings Page
 * Manage tenant settings and child organizations
 */

'use client';

import React, { useEffect, useState } from 'react';
import { Building2, Globe, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Tenant, TenantWithChildren } from '@/lib/types/user-management';

export default function OrganizationPage() {
  const [tenants, setTenants] = useState<TenantWithChildren[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTenant, setCurrentTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    const fetchTenants = async () => {
      try {
        const res = await fetch('/api/tenants');
        const data = await res.json();
        if (res.ok) {
          setTenants(data.tenants || []);
          // Find current tenant (first one, or the parent)
          if (data.flat && data.flat.length > 0) {
            setCurrentTenant(data.flat[0]);
          }
        }
      } catch (err) {
        console.error('Failed to fetch tenants:', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchTenants();
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Organization Details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Organization Details
          </CardTitle>
          <CardDescription>Basic information about your organization</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {currentTenant ? (
            <>
              <div>
                <label className="block text-sm font-medium mb-1.5">Organization Name</label>
                <Input value={currentTenant.Name} disabled className="max-w-md" />
                <p className="text-xs text-muted-foreground mt-1">
                  Contact support to change your organization name
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">Organization ID</label>
                <Input
                  value={currentTenant.TenantId}
                  disabled
                  className="max-w-md font-mono text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">URL Slug</label>
                <Input value={currentTenant.Slug} disabled className="max-w-md" />
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">No organization found</p>
          )}
        </CardContent>
      </Card>

      {/* Allowed Domains */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Allowed Email Domains
          </CardTitle>
          <CardDescription>
            Users with these email domains can automatically join your organization
          </CardDescription>
        </CardHeader>
        <CardContent>
          {currentTenant?.AllowedDomains && currentTenant.AllowedDomains.length > 0 ? (
            <div className="space-y-2">
              {currentTenant.AllowedDomains.map((domain) => (
                <div
                  key={domain}
                  className="flex items-center justify-between p-3 bg-muted rounded-md"
                >
                  <span className="font-mono text-sm">{domain}</span>
                </div>
              ))}
              <p className="text-xs text-muted-foreground mt-2">
                Contact support to add or remove domains
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground">No allowed domains configured</p>
          )}
        </CardContent>
      </Card>

      {/* Child Organizations (for agencies) */}
      {tenants.length > 0 && tenants[0].children && tenants[0].children.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Client Organizations
            </CardTitle>
            <CardDescription>Organizations managed under your agency</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {tenants[0].children.map((child) => (
                <div
                  key={child.TenantId}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div>
                    <div className="font-medium">{child.Name}</div>
                    <div className="text-sm text-muted-foreground">
                      {child.Slug} &bull; {child.AllowedDomains?.join(', ') || 'No domains'}
                    </div>
                  </div>
                  <Button variant="outline" size="sm">
                    Manage
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Parent Organization (for clients) */}
      {currentTenant?.ParentTenantId && (
        <Card>
          <CardHeader>
            <CardTitle>Parent Organization</CardTitle>
            <CardDescription>Your organization is managed by an agency</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Parent ID: <span className="font-mono">{currentTenant.ParentTenantId}</span>
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
