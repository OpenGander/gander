/**
 * Verification Badge Component
 * Shows domain verification status
 */

'use client';

import React from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VerificationBadgeProps {
  verified: boolean;
  className?: string;
}

export function VerificationBadge({ verified, className }: VerificationBadgeProps) {
  if (verified) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
          'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
          className
        )}
      >
        <CheckCircle2 className="h-3 w-3" />
        Verified
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
        'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
        className
      )}
    >
      <AlertCircle className="h-3 w-3" />
      Unverified
    </span>
  );
}
