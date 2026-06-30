/**
 * Dashboard Context
 * Shared context for dashboard state (date range, tenant, services, impersonation)
 * Used by the (app) layout and consumed by pages/hooks via useDashboard()
 */

'use client';

import { createContext, useContext } from 'react';
import type { ServiceWithMapping } from '@/lib/types/user-management';
import type { ImpersonationContext } from '@/lib/types/user-management';

export interface DateRange {
  start: Date;
  end: Date;
}

export interface AccessibleTenant {
  TenantId: string;
  Name: string;
}

export interface DashboardContextType {
  dateRange: DateRange;
  setDateRange: (range: DateRange) => void;
  /** Earliest data point available for the viewing tenant, or null if unknown/no data. */
  earliestDataPoint: Date | null;
  /** Earliest point with unique sessions/visitors coverage, or null if unknown/no data. */
  uniquesCoverageStart: Date | null;
  impersonating?: ImpersonationContext;
  currentEmail?: string;
  viewingTenantId?: string;
  viewingTenantName?: string;
  accessibleTenants: AccessibleTenant[];
  setViewingTenant: (tenantId: string) => Promise<void>;
  // Service filtering
  services: ServiceWithMapping[];
  selectedService: string | null; // null means "All Services"
  setSelectedService: (serviceName: string | null) => void;
}

export const DashboardContext = createContext<DashboardContextType | undefined>(undefined);

export const useDashboard = () => {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error('useDashboard must be used within a DashboardContext provider');
  }
  return context;
};
