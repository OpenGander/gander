/**
 * Add Domain Dialog Component
 * Modal for adding a new website domain for telemetry collection
 */

'use client';

import React, { useState } from 'react';
import { X, Globe, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface AddDomainDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (domain: string, displayName?: string) => Promise<void>;
}

export function AddDomainDialog({ isOpen, onClose, onAdd }: AddDomainDialogProps) {
  const [domain, setDomain] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Basic validation
    const trimmedDomain = domain.trim().toLowerCase();
    if (!trimmedDomain) {
      setError('Domain is required');
      return;
    }

    // Remove protocol and path if user accidentally included them
    const cleanDomain = trimmedDomain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');

    // Validate domain format
    const hostnameRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
    if (!hostnameRegex.test(cleanDomain)) {
      setError('Invalid domain format. Use a hostname like "www.example.com"');
      return;
    }

    setIsLoading(true);
    try {
      await onAdd(cleanDomain, displayName.trim() || undefined);
      // Reset form and close
      setDomain('');
      setDisplayName('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add domain');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (!isLoading) {
      setError(null);
      setDomain('');
      setDisplayName('');
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
          <Globe className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Add Domain</h2>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          Add a website domain to collect telemetry data. The domain will appear as
          &quot;Unverified&quot; until DNS verification is completed.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Domain Input */}
          <div>
            <label className="block text-sm font-medium mb-1.5">
              <Globe className="inline h-4 w-4 mr-1" />
              Domain
            </label>
            <Input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="www.example.com"
              disabled={isLoading}
              required
            />
            <p className="text-xs text-muted-foreground mt-1">
              Enter the hostname without https:// or trailing path
            </p>
          </div>

          {/* Display Name Input */}
          <div>
            <label className="block text-sm font-medium mb-1.5">
              <Tag className="inline h-4 w-4 mr-1" />
              Display Name <span className="text-muted-foreground">(optional)</span>
            </label>
            <Input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="My Website"
              disabled={isLoading}
            />
            <p className="text-xs text-muted-foreground mt-1">
              A friendly name shown in the dashboard selector
            </p>
          </div>

          {/* Error Message */}
          {error && <p className="text-sm text-destructive">{error}</p>}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={handleClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Adding...' : 'Add Domain'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
