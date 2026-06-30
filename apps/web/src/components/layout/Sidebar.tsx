/**
 * Sidebar Navigation Component
 * Fixed left sidebar with collapsible state and mobile overlay
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Route,
  TrendingUp,
  Gauge,
  FileText,
  AlertCircle,
  Scale,
  Settings,
  Menu,
  X,
  Users,
} from 'lucide-react';
import { UserDropdown } from '@/components/dashboard/UserDropdown';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import type { AccessibleTenant } from '@/contexts/DashboardContext';

/** Mountain logo SVG for the sidebar header */
const MountainLogo = () => (
  <div className="w-9 h-9 bg-primary rounded-[10px] flex items-center justify-center shadow-sm">
    <svg width="22" height="22" viewBox="0 0 36 36" fill="none">
      <path
        d="M4 28 L12 12 L16 18 L22 8 L32 28 Z"
        fill="rgba(255,255,255,0.25)"
        stroke="white"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M22 8 L25 14 L28 11 L32 28"
        fill="none"
        stroke="white"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="M8 28 C10 24, 14 22, 18 24 C22 26, 26 24, 30 28"
        fill="none"
        stroke="#c4a97a"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.8"
      />
    </svg>
  </div>
);

interface NavItem {
  label: string;
  path: string;
  icon: React.ElementType;
  section?: string;
}

const navItems: NavItem[] = [
  { label: 'Overview', path: '/', icon: LayoutDashboard, section: 'Analytics' },
  { label: 'Journey', path: '/journey', icon: Route },
  { label: 'Sessions', path: '/sessions', icon: Users },
  { label: 'Marketing', path: '/marketing', icon: TrendingUp },
  { label: 'Performance', path: '/performance', icon: Gauge },
  { label: 'Content', path: '/content', icon: FileText },
  { label: 'Errors', path: '/errors', icon: AlertCircle, section: 'Monitoring' },
  { label: 'Validation', path: '/validation', icon: Scale },
];

const STORAGE_KEY = 'opengander_sidebar_collapsed';

interface SidebarProps {
  email?: string;
  viewingTenantId?: string;
  viewingTenantName?: string;
  accessibleTenants?: AccessibleTenant[];
  onTenantSwitch?: (tenantId: string) => Promise<void>;
  onSignOut?: () => Promise<void>;
}

export function Sidebar({
  email,
  viewingTenantId,
  viewingTenantName,
  accessibleTenants = [],
  onTenantSwitch,
  onSignOut,
}: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Restore collapsed state from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'true') {
      setCollapsed(true);
    }
    setMounted(true);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  const toggleMobile = useCallback(() => {
    setMobileOpen((prev) => !prev);
  }, []);

  // Close mobile sidebar on navigation
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const isActive = (path: string) => {
    if (path === '/') {
      return pathname === '/';
    }
    return pathname?.startsWith(path);
  };

  // Render sidebar content (shared between desktop and mobile)
  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo — click toggles sidebar on desktop */}
      <div
        className={cn(
          'flex items-center border-b border-border flex-shrink-0',
          collapsed ? 'justify-center px-2 py-4' : 'px-5 py-4'
        )}
      >
        <button
          onClick={toggleCollapsed}
          className="hidden lg:flex items-center gap-2 min-w-0 cursor-pointer"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <MountainLogo />
          {!collapsed && (
            <span className="font-serif text-xl tracking-tight text-foreground truncate">
              OpenGander
            </span>
          )}
        </button>
        <Link href="/" className="lg:hidden flex items-center gap-2 min-w-0">
          <MountainLogo />
          <span className="font-serif text-xl tracking-tight text-foreground truncate">
            OpenGander
          </span>
        </Link>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
        {navItems.map((item) => {
          const active = isActive(item.path);
          const Icon = item.icon;
          return (
            <React.Fragment key={item.path}>
              {item.section && !collapsed && (
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-3 pt-4 pb-1">
                  {item.section}
                </div>
              )}
              <Link
                href={item.path}
                title={collapsed ? item.label : undefined}
                className={cn(
                  'relative flex items-center gap-2.5 px-3 py-2 text-sm rounded-md transition-colors',
                  active
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted font-normal',
                  collapsed && 'justify-center px-2'
                )}
              >
                {active && (
                  <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] bg-primary rounded-r-full" />
                )}
                <Icon className="h-4 w-4 flex-shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            </React.Fragment>
          );
        })}
      </nav>

      {/* Mountain silhouette watermark */}
      <div className="mt-auto px-0 overflow-hidden">
        <svg
          viewBox="0 0 240 80"
          fill="currentColor"
          preserveAspectRatio="none"
          className="w-full h-16 text-primary opacity-[0.04]"
        >
          <path d="M0 50 L30 30 L60 42 L90 20 L120 35 L150 15 L180 30 L210 12 L240 25 L240 80 L0 80Z" />
        </svg>
      </div>

      {/* Bottom Section: Settings, Theme, User */}
      <div className="border-t border-border flex-shrink-0 py-3 px-2 space-y-1">
        {/* Settings link */}
        <Link
          href="/settings"
          title={collapsed ? 'Settings' : undefined}
          className={cn(
            'relative flex items-center gap-2.5 px-3 py-2 text-sm rounded-md transition-colors',
            pathname?.startsWith('/settings')
              ? 'bg-primary/10 text-primary font-medium'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted font-normal',
            collapsed && 'justify-center px-2'
          )}
        >
          {pathname?.startsWith('/settings') && (
            <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] bg-primary rounded-r-full" />
          )}
          <Settings className="h-4 w-4 flex-shrink-0" />
          {!collapsed && <span>Settings</span>}
        </Link>

        {/* Theme toggle */}
        {!collapsed && (
          <div className="px-1">
            <ThemeToggle />
          </div>
        )}

        {/* User dropdown */}
        {email && onTenantSwitch && onSignOut && (
          <div className={cn('px-1', collapsed && 'flex justify-center')}>
            <UserDropdown
              email={email}
              viewingTenantId={viewingTenantId || ''}
              viewingTenantName={viewingTenantName || ''}
              accessibleTenants={accessibleTenants}
              onTenantSwitch={onTenantSwitch}
              onSignOut={onSignOut}
              collapsed={collapsed}
            />
          </div>
        )}
      </div>
    </div>
  );

  // Prevent layout shift before mount by rendering at default width
  const sidebarWidth = mounted ? (collapsed ? 'w-16' : 'w-60') : 'w-60';

  return (
    <>
      {/* Mobile top bar with hamburger */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 h-14 bg-card border-b border-border flex items-center px-4">
        <button
          onClick={toggleMobile}
          className="p-2 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors"
          aria-label="Toggle navigation"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <Link href="/" className="ml-3 flex items-center gap-2">
          <MountainLogo />
          <span className="font-serif text-xl tracking-tight text-foreground">OpenGander</span>
        </Link>
      </div>

      {/* Mobile overlay backdrop */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/50"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar (slides in from left) */}
      <aside
        className={cn(
          'lg:hidden fixed top-0 left-0 z-50 h-full w-60 bg-card border-r border-border',
          'transition-transform duration-200 ease-in-out',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {sidebarContent}
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden lg:flex flex-col flex-shrink-0 h-screen sticky top-0 bg-card border-r border-border',
          'transition-all duration-200',
          sidebarWidth
        )}
      >
        {sidebarContent}
      </aside>

      {/* Mobile spacer (pushes content below the top bar) */}
      <div className="lg:hidden h-14 flex-shrink-0" />
    </>
  );
}
