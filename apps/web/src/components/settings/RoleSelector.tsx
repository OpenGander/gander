/**
 * Role Selector Component
 * Dropdown for changing user roles with hierarchy enforcement
 */

'use client';

import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ROLE_HIERARCHY, ROLE_LABELS, type Role } from '@/lib/types/user-management';

interface RoleSelectorProps {
  currentRole: Role;
  actorRole: Role;
  disabled?: boolean;
  onChange: (newRole: Role) => Promise<void>;
}

export function RoleSelector({ currentRole, actorRole, disabled, onChange }: RoleSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Get available roles based on actor's role
  const availableRoles: Role[] = (['user', 'moderator', 'admin', 'superadmin'] as Role[]).filter(
    (role) => {
      // Superadmin can assign any role
      if (actorRole === 'superadmin') return true;
      // Others can only assign roles below their own level
      return ROLE_HIERARCHY[actorRole] > ROLE_HIERARCHY[role];
    }
  );

  const handleSelect = async (role: Role) => {
    if (role === currentRole) {
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    try {
      await onChange(role);
    } finally {
      setIsLoading(false);
      setIsOpen(false);
    }
  };

  // If disabled or no roles to change to, just show the badge
  if (disabled || availableRoles.length <= 1) {
    return (
      <span
        className={cn(
          'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
          currentRole === 'superadmin' &&
            'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
          currentRole === 'admin' &&
            'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
          currentRole === 'moderator' &&
            'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
          currentRole === 'user' && 'bg-muted text-muted-foreground'
        )}
      >
        {ROLE_LABELS[currentRole]}
      </span>
    );
  }

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLoading}
      >
        <span
          className={cn(
            'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium mr-1',
            currentRole === 'superadmin' &&
              'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
            currentRole === 'admin' &&
              'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
            currentRole === 'moderator' &&
              'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
            currentRole === 'user' && 'bg-muted text-muted-foreground'
          )}
        >
          {ROLE_LABELS[currentRole]}
        </span>
        <ChevronDown className="h-3 w-3" />
      </Button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-20 bg-background border rounded-md shadow-lg py-1 min-w-[120px]">
            {availableRoles.map((role) => (
              <button
                key={role}
                className={cn(
                  'w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center justify-between',
                  role === currentRole && 'bg-muted'
                )}
                onClick={() => handleSelect(role)}
              >
                <span
                  className={cn(
                    'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium',
                    role === 'superadmin' &&
                      'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
                    role === 'admin' &&
                      'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
                    role === 'moderator' &&
                      'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
                    role === 'user' && 'bg-muted text-muted-foreground'
                  )}
                >
                  {ROLE_LABELS[role]}
                </span>
                {role === currentRole && <Check className="h-3 w-3" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
