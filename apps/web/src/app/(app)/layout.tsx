/**
 * App Layout
 * Provides DashboardContext + Sidebar for all (app) routes
 * Replaces per-page DashboardLayout wrappers
 */

'use client';

import React, { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { ImpersonationBanner } from '@/components/dashboard/ImpersonationBanner';
import { DashboardContext } from '@/contexts/DashboardContext';
import type { AccessibleTenant } from '@/contexts/DashboardContext';
import type { ServiceWithMapping } from '@/lib/types/user-management';
import type { ImpersonationContext } from '@/lib/types/user-management';
import { Calendar } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();

  // Initialize as null to avoid hydration mismatch, set in useEffect
  const [dateRange, setDateRange] = useState<{ start: Date; end: Date } | null>(null);

  // Earliest available data point (for the "All time" range / custom-range clamping)
  const [earliestDataPoint, setEarliestDataPoint] = useState<Date | null>(null);

  // Earliest point with unique sessions/visitors coverage (for the "since <date>" label)
  const [uniquesCoverageStart, setUniquesCoverageStart] = useState<Date | null>(null);

  // Session state (fetched from /api/me)
  const [sessionEmail, setSessionEmail] = useState<string | undefined>(undefined);
  const [sessionImpersonating, setSessionImpersonating] = useState<
    ImpersonationContext | undefined
  >(undefined);

  // Tenant state
  const [viewingTenantId, setViewingTenantId] = useState<string | undefined>(undefined);
  const [viewingTenantName, setViewingTenantName] = useState<string | undefined>(undefined);
  const [accessibleTenants, setAccessibleTenants] = useState<AccessibleTenant[]>([]);

  // Service filtering state
  const [services, setServices] = useState<ServiceWithMapping[]>([]);
  const [selectedService, setSelectedServiceState] = useState<string | null>(null);

  const SERVICE_STORAGE_KEY = 'opengander_dashboard_service';

  // Fetch session info on mount
  useEffect(() => {
    async function fetchSession() {
      try {
        const res = await fetch('/api/me');
        if (res.ok) {
          const data = await res.json();
          setSessionEmail(data.email);
          setSessionImpersonating(data.impersonating);
          if (!viewingTenantId && data.tenantId) {
            setViewingTenantId(data.tenantId);
            setViewingTenantName(data.tenantName);
          }
        }
      } catch (error) {
        console.error('Failed to fetch session:', error);
      }
    }
    fetchSession();
  }, [viewingTenantId]);

  // Fetch accessible tenants on mount
  useEffect(() => {
    async function fetchTenants() {
      try {
        const res = await fetch('/api/tenants');
        if (res.ok) {
          const data = await res.json();
          const flat: AccessibleTenant[] =
            data.flat?.map((t: { TenantId: string; Name: string }) => ({
              TenantId: t.TenantId,
              Name: t.Name,
            })) || [];
          setAccessibleTenants(flat);

          if (!viewingTenantId && flat.length > 0) {
            setViewingTenantId(flat[0].TenantId);
            setViewingTenantName(flat[0].Name);
          }
        }
      } catch (error) {
        console.error('Failed to fetch accessible tenants:', error);
      }
    }
    fetchTenants();
  }, [viewingTenantId]);

  // Fetch active services for filtering
  useEffect(() => {
    async function fetchServices() {
      try {
        const res = await fetch('/api/settings/services');
        if (res.ok) {
          const data = await res.json();
          const serviceList: ServiceWithMapping[] = data.services || [];
          setServices(serviceList);

          const stored = localStorage.getItem(SERVICE_STORAGE_KEY);
          if (stored && serviceList.some((s) => s.serviceName === stored)) {
            setSelectedServiceState(stored);
          } else {
            localStorage.removeItem(SERVICE_STORAGE_KEY);
            setSelectedServiceState(null);
          }
        }
      } catch (error) {
        console.error('Failed to fetch services:', error);
      }
    }
    fetchServices();
  }, [viewingTenantId]);

  // Handle service selection with localStorage persistence
  const setSelectedService = useCallback((serviceName: string | null) => {
    setSelectedServiceState(serviceName);
    if (serviceName) {
      localStorage.setItem(SERVICE_STORAGE_KEY, serviceName);
    } else {
      localStorage.removeItem(SERVICE_STORAGE_KEY);
    }
  }, []);

  // Switch viewing tenant
  const setViewingTenant = useCallback(
    async (tenantId: string) => {
      try {
        const res = await fetch('/api/tenant-switch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId }),
        });

        if (res.ok) {
          const tenant = accessibleTenants.find((t) => t.TenantId === tenantId);
          setViewingTenantId(tenantId);
          setViewingTenantName(tenant?.Name);
          router.refresh();
        }
      } catch (error) {
        console.error('Failed to switch tenant:', error);
      }
    },
    [accessibleTenants, router]
  );

  // Set default date range on client mount to avoid SSR/client mismatch
  useEffect(() => {
    setDateRange({
      start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      end: new Date(),
    });
  }, []);

  // Fetch earliest available data point for the viewing tenant (refetches on switch)
  useEffect(() => {
    let cancelled = false;
    async function fetchEarliest() {
      setEarliestDataPoint(null);
      try {
        const res = await fetch('/api/analytics/data-range');
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setEarliestDataPoint(data.earliest ? new Date(data.earliest) : null);
          }
        }
      } catch (error) {
        console.error('Failed to fetch data range:', error);
      }
    }
    fetchEarliest();
    return () => {
      cancelled = true;
    };
  }, [viewingTenantId]);

  // Fetch the uniques coverage start for the viewing tenant (refetches on switch)
  useEffect(() => {
    let cancelled = false;
    async function fetchUniquesCoverage() {
      setUniquesCoverageStart(null);
      try {
        const res = await fetch('/api/analytics/uniques-coverage');
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setUniquesCoverageStart(data.coverageStart ? new Date(data.coverageStart) : null);
          }
        }
      } catch (error) {
        console.error('Failed to fetch uniques coverage:', error);
      }
    }
    fetchUniquesCoverage();
    return () => {
      cancelled = true;
    };
  }, [viewingTenantId]);

  const handleEndImpersonation = async () => {
    const res = await fetch('/api/impersonate/end', { method: 'POST' });
    if (res.ok) {
      router.refresh();
      window.location.reload();
    }
  };

  const handleSignOut = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/signout', { method: 'POST' });
      if (res.ok) {
        window.location.href = '/signin';
      }
    } catch (error) {
      console.error('Sign out failed:', error);
    }
  }, []);

  const currentEmail = sessionEmail;
  const impersonating = sessionImpersonating;

  // Don't render content until dateRange is initialized (avoids hydration mismatch)
  if (!dateRange) {
    return (
      <div className="min-h-screen bg-background">
        {impersonating && currentEmail && (
          <ImpersonationBanner
            impersonating={impersonating}
            currentEmail={currentEmail}
            onEndImpersonation={handleEndImpersonation}
          />
        )}
        <div className="flex">
          <Sidebar
            email={currentEmail}
            viewingTenantId={viewingTenantId}
            viewingTenantName={viewingTenantName}
            accessibleTenants={accessibleTenants}
            onTenantSwitch={setViewingTenant}
            onSignOut={handleSignOut}
          />
          <main className="flex-1 min-w-0 overflow-auto">
            <div className="container mx-auto px-4 py-6 lg:px-6">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    <span>Loading...</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <DashboardContext.Provider
      value={{
        dateRange,
        setDateRange,
        earliestDataPoint,
        uniquesCoverageStart,
        impersonating,
        currentEmail,
        viewingTenantId,
        viewingTenantName,
        accessibleTenants,
        setViewingTenant,
        services,
        selectedService,
        setSelectedService,
      }}
    >
      <div className="min-h-screen bg-background">
        {impersonating && currentEmail && (
          <ImpersonationBanner
            impersonating={impersonating}
            currentEmail={currentEmail}
            onEndImpersonation={handleEndImpersonation}
          />
        )}
        <div className="flex">
          <Sidebar
            email={currentEmail}
            viewingTenantId={viewingTenantId}
            viewingTenantName={viewingTenantName}
            accessibleTenants={accessibleTenants}
            onTenantSwitch={setViewingTenant}
            onSignOut={handleSignOut}
          />
          <main className="flex-1 min-w-0 overflow-auto">
            <div className="container mx-auto px-4 py-6 lg:px-6">{children}</div>
          </main>
        </div>
      </div>
    </DashboardContext.Provider>
  );
}
