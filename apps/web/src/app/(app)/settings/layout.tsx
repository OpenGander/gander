/**
 * Settings Layout
 * Shared layout for settings pages with sub-navigation
 * No FilterBar — settings pages don't need date/service filtering
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Users, Building2, Shield, Server } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';

interface SettingsLayoutProps {
  children: React.ReactNode;
}

const settingsTabs = [
  {
    label: 'Members',
    path: '/settings/members',
    icon: <Users className="h-4 w-4" />,
    description: 'Manage users and invitations',
  },
  {
    label: 'Organization',
    path: '/settings/organization',
    icon: <Building2 className="h-4 w-4" />,
    description: 'Organization settings and clients',
  },
  {
    label: 'Services',
    path: '/settings/services',
    icon: <Server className="h-4 w-4" />,
    description: 'Manage service display names',
  },
  {
    label: 'Audit Log',
    path: '/settings/audit',
    icon: <Shield className="h-4 w-4" />,
    description: 'Security and activity history',
  },
];

export default function SettingsLayout({ children }: SettingsLayoutProps) {
  const pathname = usePathname();

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold font-serif">Settings</h1>
        <p className="text-muted-foreground">
          Manage your organization, users, and security settings
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Sidebar Navigation */}
        <div className="lg:w-64 flex-shrink-0">
          <Card>
            <CardContent className="p-2">
              <nav className="space-y-1">
                {settingsTabs.map((tab) => {
                  const isActive = pathname === tab.path;
                  return (
                    <Link
                      key={tab.path}
                      href={tab.path}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                        isActive
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {tab.icon}
                      <div>
                        <div className="font-medium">{tab.label}</div>
                        <div
                          className={cn(
                            'text-xs',
                            isActive ? 'text-primary-foreground/80' : 'text-muted-foreground'
                          )}
                        >
                          {tab.description}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </nav>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </>
  );
}
