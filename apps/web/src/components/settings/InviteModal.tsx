/**
 * Invite Modal Component
 * Modal for inviting new users to the organization
 */

'use client';

import React, { useState } from 'react';
import { X, UserPlus, Mail, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  ROLE_HIERARCHY,
  ROLE_LABELS,
  ROLE_DESCRIPTIONS,
  type Role,
  type Tenant,
} from '@/lib/types/user-management';

interface InviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInvite: (email: string, role: Role, tenantId?: string) => Promise<void>;
  actorRole: Role;
  tenants?: Tenant[];
  defaultTenantId?: string;
}

export function InviteModal({
  isOpen,
  onClose,
  onInvite,
  actorRole,
  tenants,
  defaultTenantId,
}: InviteModalProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('user');
  const [tenantId, setTenantId] = useState(defaultTenantId || '');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get available roles based on actor's role
  const availableRoles: Role[] = (['user', 'moderator', 'admin', 'superadmin'] as Role[]).filter(
    (r) => {
      if (actorRole === 'superadmin') return true;
      return ROLE_HIERARCHY[actorRole] > ROLE_HIERARCHY[r];
    }
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Please enter a valid email address');
      return;
    }

    setIsLoading(true);
    try {
      await onInvite(email, role, tenantId || undefined);
      // Reset form and close
      setEmail('');
      setRole('user');
      setTenantId(defaultTenantId || '');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invite');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (!isLoading) {
      setError(null);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={handleClose} />
      <div className="relative bg-background rounded-lg shadow-lg p-6 max-w-md w-full mx-4 z-50">
        <button
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
          onClick={handleClose}
          disabled={isLoading}
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2 mb-4">
          <UserPlus className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Invite User</h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email Input */}
          <div>
            <label className="block text-sm font-medium mb-1.5">
              <Mail className="inline h-4 w-4 mr-1" />
              Email Address
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              disabled={isLoading}
              required
            />
          </div>

          {/* Role Selection */}
          <div>
            <label className="block text-sm font-medium mb-1.5">
              <Shield className="inline h-4 w-4 mr-1" />
              Role
            </label>
            <div className="grid grid-cols-2 gap-2">
              {availableRoles.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={cn(
                    'p-3 rounded-md border text-left transition-colors',
                    role === r
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50'
                  )}
                  onClick={() => setRole(r)}
                  disabled={isLoading}
                >
                  <span
                    className={cn(
                      'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium mb-1',
                      r === 'superadmin' &&
                        'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
                      r === 'admin' &&
                        'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
                      r === 'moderator' &&
                        'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
                      r === 'user' && 'bg-muted text-muted-foreground'
                    )}
                  >
                    {ROLE_LABELS[r]}
                  </span>
                  <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[r]}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Tenant Selection (if multiple tenants) */}
          {tenants && tenants.length > 1 && (
            <div>
              <label className="block text-sm font-medium mb-1.5">Organization</label>
              <select
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                disabled={isLoading}
              >
                {tenants.map((tenant) => (
                  <option key={tenant.TenantId} value={tenant.TenantId}>
                    {tenant.Name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Error Message */}
          {error && <p className="text-sm text-destructive">{error}</p>}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={handleClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Sending...' : 'Send Invite'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
