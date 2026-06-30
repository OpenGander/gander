/**
 * Impersonation Banner Component
 * Displays warning banner when superadmin is impersonating another user
 */

'use client';

import React, { useState } from 'react';
import { AlertTriangle, LogOut, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ImpersonationContext } from '@/lib/types/user-management';

interface ImpersonationBannerProps {
  impersonating: ImpersonationContext;
  currentEmail: string;
  onEndImpersonation: () => Promise<void>;
}

export function ImpersonationBanner({
  impersonating,
  currentEmail,
  onEndImpersonation,
}: ImpersonationBannerProps) {
  const [isEnding, setIsEnding] = useState(false);

  const handleEnd = async () => {
    setIsEnding(true);
    try {
      await onEndImpersonation();
      // Page will reload/redirect after session change
    } catch (err) {
      console.error('Failed to end impersonation:', err);
      setIsEnding(false);
    }
  };

  return (
    <div className="bg-yellow-500 text-yellow-950">
      <div className="container mx-auto px-4 py-2">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span className="text-sm font-medium">
              Impersonating: <strong>{currentEmail}</strong>
            </span>
            <span className="text-sm opacity-75">
              (Logged in as {impersonating.originalEmail})
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="bg-yellow-600 border-yellow-700 text-yellow-950 hover:bg-yellow-700 hover:text-white"
            onClick={handleEnd}
            disabled={isEnding}
          >
            {isEnding ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
                Ending...
              </>
            ) : (
              <>
                <LogOut className="h-3 w-3 mr-1" />
                End Impersonation
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
