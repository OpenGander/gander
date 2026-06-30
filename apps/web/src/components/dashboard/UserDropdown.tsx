/**
 * User Dropdown Component
 * Avatar with initials, name/role display, tenant switcher, and sign out
 */

'use client';

import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown, Check, LogOut, Building2 } from 'lucide-react';

interface Tenant {
  TenantId: string;
  Name: string;
}

interface UserDropdownProps {
  email: string;
  role?: string;
  viewingTenantId: string;
  viewingTenantName: string;
  accessibleTenants: Tenant[];
  onTenantSwitch: (tenantId: string) => Promise<void>;
  onSignOut: () => Promise<void>;
  collapsed?: boolean;
}

/** Extract initials from an email address (e.g. "chrisdbaldwin@gmail.com" -> "CB") */
function getInitials(email: string): string {
  const local = email.split('@')[0] || '';
  // Split on dots, hyphens, underscores, or camelCase boundaries
  const parts = local
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[.\-_\s]+/)
    .filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return local.substring(0, 2).toUpperCase();
}

/** Extract a display name from email (e.g. "chris.baldwin@example.com" -> "Chris Baldwin") */
function getDisplayName(email: string): string {
  const local = email.split('@')[0] || '';
  const parts = local
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[.\-_\s]+/)
    .filter(Boolean);
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ');
}

export function UserDropdown({
  email,
  role,
  viewingTenantId,
  viewingTenantName,
  accessibleTenants,
  onTenantSwitch,
  onSignOut,
  collapsed = false,
}: UserDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const showTenantSelector = accessibleTenants.length > 1;
  const initials = getInitials(email);
  const displayName = getDisplayName(email);
  const displayRole = role || 'User';

  const handleTenantSelect = async (tenantId: string) => {
    if (tenantId === viewingTenantId) {
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    try {
      await onTenantSwitch(tenantId);
    } finally {
      setIsLoading(false);
      setIsOpen(false);
    }
  };

  const handleSignOut = async () => {
    setIsLoading(true);
    try {
      await onSignOut();
    } finally {
      setIsLoading(false);
      setIsOpen(false);
    }
  };

  const avatar = (
    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center text-xs font-semibold text-primary-foreground flex-shrink-0">
      {initials}
    </div>
  );

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLoading}
        className={cn(
          'flex items-center gap-2.5 px-3 py-2 rounded-lg transition-colors w-full',
          'hover:bg-muted',
          isLoading && 'opacity-50 cursor-not-allowed',
          collapsed && 'justify-center px-2'
        )}
      >
        {avatar}
        {!collapsed && (
          <>
            <div className="flex flex-col items-start min-w-0 flex-1">
              <span className="text-[13px] font-medium text-foreground truncate max-w-full">
                {displayName}
              </span>
              <span className="text-[11px] text-muted-foreground leading-tight">{displayRole}</span>
            </div>
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 text-muted-foreground flex-shrink-0 transition-transform',
                isOpen && 'rotate-180'
              )}
            />
          </>
        )}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div
            className={cn(
              'absolute z-20 bg-background border rounded-lg shadow-lg py-1 min-w-[220px]',
              collapsed ? 'bottom-0 left-full ml-2' : 'bottom-full left-0 mb-1'
            )}
          >
            {/* Current tenant indicator */}
            {showTenantSelector && (
              <>
                <div className="px-3 py-2 text-xs text-muted-foreground border-b">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-3 w-3" />
                    <span>Viewing: {viewingTenantName}</span>
                  </div>
                </div>

                {/* Tenant list */}
                <div className="py-1">
                  <div className="px-3 py-1 text-xs text-muted-foreground font-medium">
                    Switch Organization
                  </div>
                  {accessibleTenants.map((tenant) => (
                    <button
                      key={tenant.TenantId}
                      className={cn(
                        'w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center justify-between',
                        tenant.TenantId === viewingTenantId && 'bg-muted/50'
                      )}
                      onClick={() => handleTenantSelect(tenant.TenantId)}
                      disabled={isLoading}
                    >
                      <span className="truncate">{tenant.Name}</span>
                      {tenant.TenantId === viewingTenantId && (
                        <Check className="h-4 w-4 text-primary flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
                <div className="border-t" />
              </>
            )}

            {/* Sign out */}
            <button
              className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2 text-destructive"
              onClick={handleSignOut}
              disabled={isLoading}
            >
              <LogOut className="h-4 w-4" />
              <span>Sign out</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
