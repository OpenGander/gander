/**
 * Domain Manager Component
 * Manages domain list with verification status and tracking scripts
 */

'use client';

import React, { useState, useCallback, useEffect } from 'react';
import {
  Globe,
  Plus,
  Trash2,
  CheckCircle,
  Clock,
  AlertCircle,
  Copy,
  Check,
  Code,
  RefreshCw,
  X,
  Loader2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Domain {
  domain: string;
  status: 'verified' | 'pending' | 'failed';
  createdAt: string | null;
  verifiedAt: string | null;
  verificationToken?: string;
}

interface DNSInstructions {
  recordType: string;
  recordName: string;
  recordValue: string;
  fullName: string;
}

interface AddDomainResponse {
  domain: string;
  verificationToken: string;
  status: string;
  dnsInstructions: DNSInstructions;
}

export function DomainManager() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add domain modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // DNS instructions modal state
  const [dnsModal, setDnsModal] = useState<{
    domain: string;
    instructions: DNSInstructions;
  } | null>(null);
  const [dnsCopied, setDnsCopied] = useState(false);

  // Verification state
  const [verifyingDomain, setVerifyingDomain] = useState<string | null>(null);

  // Snippet modal state
  const [snippetModal, setSnippetModal] = useState<{
    domain: string;
    snippet: string;
  } | null>(null);
  const [snippetCopied, setSnippetCopied] = useState(false);
  const [loadingSnippet, setLoadingSnippet] = useState(false);

  // Delete confirmation state
  const [domainToDelete, setDomainToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchDomains = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/settings/domains');
      if (!res.ok) {
        throw new Error('Failed to fetch domains');
      }
      const data = await res.json();
      setDomains(data.domains || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch domains');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDomains();
  }, [fetchDomains]);

  const handleAddDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);

    const trimmedDomain = newDomain.trim().toLowerCase();
    if (!trimmedDomain) {
      setAddError('Domain is required');
      return;
    }

    setIsAdding(true);
    try {
      const res = await fetch('/api/settings/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: trimmedDomain }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to add domain');
      }

      const response = data as AddDomainResponse;

      // Close add modal and show DNS instructions
      setIsAddModalOpen(false);
      setNewDomain('');
      setDnsModal({
        domain: response.domain,
        instructions: response.dnsInstructions,
      });

      await fetchDomains();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add domain');
    } finally {
      setIsAdding(false);
    }
  };

  const handleVerifyDomain = async (domain: string) => {
    setVerifyingDomain(domain);
    try {
      const res = await fetch('/api/settings/domains/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
      });

      const data = await res.json();

      if (data.verified) {
        await fetchDomains();
      } else {
        setError(data.error || 'Verification failed');
        setTimeout(() => setError(null), 5000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
      setTimeout(() => setError(null), 5000);
    } finally {
      setVerifyingDomain(null);
    }
  };

  const handleDeleteDomain = async () => {
    if (!domainToDelete) return;

    setIsDeleting(true);
    try {
      const res = await fetch('/api/settings/domains', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: domainToDelete }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete domain');
      }

      setDomainToDelete(null);
      await fetchDomains();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete domain');
      setTimeout(() => setError(null), 5000);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleViewSnippet = async (domain: string) => {
    setLoadingSnippet(true);
    try {
      const res = await fetch(`/api/settings/snippet?domain=${encodeURIComponent(domain)}`);
      if (!res.ok) {
        throw new Error('Failed to fetch snippet');
      }
      const data = await res.json();
      setSnippetModal({ domain, snippet: data.snippet });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch snippet');
      setTimeout(() => setError(null), 5000);
    } finally {
      setLoadingSnippet(false);
    }
  };

  const copyToClipboard = async (text: string, setCopied: (v: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getStatusIcon = (status: Domain['status']) => {
    switch (status) {
      case 'verified':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'pending':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'failed':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
    }
  };

  const getStatusText = (status: Domain['status']) => {
    switch (status) {
      case 'verified':
        return 'Verified';
      case 'pending':
        return 'Pending verification';
      case 'failed':
        return 'Verification failed';
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Your Domains
            </CardTitle>
            <CardDescription>
              Manage domains for tracking and verify ownership via DNS
            </CardDescription>
          </div>
          <Button onClick={() => setIsAddModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Domain
          </Button>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : domains.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Globe className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No domains configured yet.</p>
              <p className="text-sm">Add your first domain to start tracking.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {domains.map((domain) => (
                <div
                  key={domain.domain}
                  className="flex items-center justify-between p-4 rounded-lg border bg-card"
                >
                  <div className="flex items-center gap-3">
                    {getStatusIcon(domain.status)}
                    <div>
                      <p className="font-medium">{domain.domain}</p>
                      <p className="text-sm text-muted-foreground">
                        {getStatusText(domain.status)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {domain.status === 'verified' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleViewSnippet(domain.domain)}
                        disabled={loadingSnippet}
                      >
                        <Code className="h-4 w-4 mr-1" />
                        View Script
                      </Button>
                    )}

                    {domain.status === 'pending' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleVerifyDomain(domain.domain)}
                        disabled={verifyingDomain === domain.domain}
                      >
                        {verifyingDomain === domain.domain ? (
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4 mr-1" />
                        )}
                        Verify
                      </Button>
                    )}

                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setDomainToDelete(domain.domain)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Domain Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => !isAdding && setIsAddModalOpen(false)}
          />
          <div className="relative bg-background rounded-lg shadow-lg p-6 max-w-md w-full mx-4 z-50">
            <button
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
              onClick={() => !isAdding && setIsAddModalOpen(false)}
              disabled={isAdding}
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-2 mb-4">
              <Globe className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Add Domain</h2>
            </div>

            <form onSubmit={handleAddDomain} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Domain Name</label>
                <Input
                  type="text"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  placeholder="example.com"
                  disabled={isAdding}
                  required
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Enter your domain without http:// or https://
                </p>
              </div>

              {addError && <p className="text-sm text-destructive">{addError}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsAddModalOpen(false)}
                  disabled={isAdding}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isAdding}>
                  {isAdding ? 'Adding...' : 'Add Domain'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DNS Instructions Modal */}
      {dnsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" />
          <div className="relative bg-background rounded-lg shadow-lg p-6 max-w-lg w-full mx-4 z-50">
            <button
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
              onClick={() => setDnsModal(null)}
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-2 mb-4">
              <Globe className="h-5 w-5 text-primary" />
              <div>
                <h2 className="text-lg font-semibold">Verify Domain Ownership</h2>
                <p className="text-sm text-muted-foreground">{dnsModal.domain}</p>
              </div>
            </div>

            <div className="space-y-4">
              <p className="text-sm">
                Add this TXT record to your DNS settings to verify ownership:
              </p>

              <div className="bg-muted rounded-lg p-4 space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Type</p>
                  <p className="font-mono text-sm">{dnsModal.instructions.recordType}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Name / Host</p>
                  <p className="font-mono text-sm">{dnsModal.instructions.recordName}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Value</p>
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-sm break-all flex-1">
                      {dnsModal.instructions.recordValue}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 flex-shrink-0"
                      onClick={() =>
                        copyToClipboard(dnsModal.instructions.recordValue, setDnsCopied)
                      }
                    >
                      {dnsCopied ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-md p-3">
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  DNS changes can take up to 48 hours to propagate, though usually it&apos;s much
                  faster. Click &quot;Verify&quot; once you&apos;ve added the record.
                </p>
              </div>

              <div className="flex justify-end">
                <Button onClick={() => setDnsModal(null)}>Done</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Snippet Modal */}
      {snippetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => setSnippetModal(null)} />
          <div className="relative bg-background rounded-lg shadow-lg p-6 max-w-2xl w-full mx-4 z-50 max-h-[90vh] overflow-y-auto">
            <button
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
              onClick={() => setSnippetModal(null)}
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-2 mb-4">
              <Code className="h-5 w-5 text-primary" />
              <div>
                <h2 className="text-lg font-semibold">Tracking Script</h2>
                <p className="text-sm text-muted-foreground">{snippetModal.domain}</p>
              </div>
            </div>

            <div className="space-y-4">
              <p className="text-sm">Add this code to your website&apos;s &lt;head&gt; section:</p>

              <div className="relative">
                <pre className="overflow-x-auto rounded-lg bg-zinc-900 p-4 text-sm text-zinc-100">
                  <code>{snippetModal.snippet}</code>
                </pre>
                <Button
                  variant="secondary"
                  size="sm"
                  className="absolute right-2 top-2"
                  onClick={() => copyToClipboard(snippetModal.snippet, setSnippetCopied)}
                >
                  {snippetCopied ? (
                    <>
                      <Check className="mr-1 h-4 w-4" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="mr-1 h-4 w-4" />
                      Copy
                    </>
                  )}
                </Button>
              </div>

              <div className="flex justify-end">
                <Button onClick={() => setSnippetModal(null)}>Done</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {domainToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => !isDeleting && setDomainToDelete(null)}
          />
          <div className="relative bg-background rounded-lg shadow-lg p-6 max-w-md w-full mx-4 z-50">
            <button
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
              onClick={() => !isDeleting && setDomainToDelete(null)}
              disabled={isDeleting}
            >
              <X className="h-4 w-4" />
            </button>

            <h2 className="text-lg font-semibold mb-2">Remove Domain</h2>
            <p className="text-muted-foreground mb-4">
              Are you sure you want to remove <strong>{domainToDelete}</strong>? This will stop
              tracking for this domain.
            </p>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setDomainToDelete(null)}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDeleteDomain} disabled={isDeleting}>
                {isDeleting ? 'Removing...' : 'Remove Domain'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
