/**
 * Remove User Dialog Component
 * Confirmation dialog for removing users from the organization
 */

'use client';

import React, { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { UserWithTenant } from '@/lib/types/user-management';

interface RemoveUserDialogProps {
  user: UserWithTenant;
  disabled?: boolean;
  onConfirm: () => Promise<void>;
}

export function RemoveUserDialog({
  user,
  disabled,
  onConfirm,
}: RemoveUserDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleConfirm = async () => {
    setIsLoading(true);
    try {
      await onConfirm();
      setIsOpen(false);
    } finally {
      setIsLoading(false);
    }
  };

  if (disabled) {
    return null;
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
        onClick={() => setIsOpen(true)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => !isLoading && setIsOpen(false)}
          />
          <div className="relative bg-background rounded-lg shadow-lg p-6 max-w-md w-full mx-4 z-50">
            <button
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
              onClick={() => !isLoading && setIsOpen(false)}
              disabled={isLoading}
            >
              <X className="h-4 w-4" />
            </button>

            <h2 className="text-lg font-semibold mb-2">Remove User</h2>
            <p className="text-muted-foreground mb-4">
              Are you sure you want to remove <strong>{user.Email}</strong> from{' '}
              {user.TenantName || 'the organization'}? This action cannot be undone.
            </p>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setIsOpen(false)}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirm}
                disabled={isLoading}
              >
                {isLoading ? 'Removing...' : 'Remove User'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
