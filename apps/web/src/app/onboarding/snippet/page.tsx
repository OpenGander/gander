'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Check, Copy, Loader2, ExternalLink } from 'lucide-react';

export default function SnippetPage() {
  const router = useRouter();
  const [snippet, setSnippet] = useState<string | null>(null);
  const [domains, setDomains] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function fetchSnippet() {
      try {
        const response = await fetch('/api/onboarding/snippet');
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to load snippet');
        }

        setSnippet(data.snippet);
        setDomains(data.domains || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      } finally {
        setIsLoading(false);
      }
    }

    fetchSnippet();
  }, []);

  async function handleCopy() {
    if (!snippet) return;

    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = snippet;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function handleGoToDashboard() {
    router.push('/');
  }

  if (isLoading) {
    return (
      <div className="flex justify-center">
        <Card className="w-full max-w-2xl">
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex justify-center">
        <Card className="w-full max-w-2xl">
          <CardContent className="py-12 text-center">
            <p className="text-red-600">{error}</p>
            <Button onClick={() => router.push('/onboarding/domains')} className="mt-4">
              Go Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex justify-center">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Install Your Tracking Snippet</CardTitle>
          <CardDescription>Add this code to your website's {`<head>`} section</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Domains */}
          {domains.length > 0 && (
            <div className="rounded-md bg-green-50 p-3">
              <p className="text-sm text-green-700">
                Configured for: <strong>{domains.join(', ')}</strong>
              </p>
            </div>
          )}

          {/* Code block */}
          <div className="relative">
            <pre className="overflow-x-auto rounded-lg bg-zinc-900 p-4 text-sm text-zinc-100">
              <code>{snippet}</code>
            </pre>
            <Button
              variant="secondary"
              size="sm"
              className="absolute right-2 top-2"
              onClick={handleCopy}
            >
              {copied ? (
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

          {/* Instructions */}
          <div className="space-y-4">
            <h3 className="font-medium text-foreground">Installation Instructions</h3>
            <ol className="list-inside list-decimal space-y-2 text-sm text-muted-foreground">
              <li>Copy the code snippet above</li>
              <li>
                Paste it into your website's{' '}
                <code className="rounded bg-muted px-1">&lt;head&gt;</code> section
              </li>
              <li>Deploy your changes</li>
              <li>Visit your site to verify data is being collected</li>
            </ol>
          </div>

          {/* CMS-specific tips */}
          <div className="rounded-md border bg-muted p-4">
            <h4 className="mb-2 font-medium text-foreground">Popular Platforms</h4>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>
                <strong>WordPress:</strong> Use a plugin like "Insert Headers and Footers"
              </li>
              <li>
                <strong>Ghost:</strong> Go to Settings → Code Injection → Site Header
              </li>
              <li>
                <strong>Next.js:</strong> Add to your custom{' '}
                <code className="rounded bg-muted px-1">_document.tsx</code>
              </li>
            </ul>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button onClick={handleGoToDashboard} className="flex-1" size="lg">
              Go to Dashboard
              <ExternalLink className="ml-2 h-4 w-4" />
            </Button>
          </div>

          <p className="text-center text-xs text-muted-foreground">
            Data will appear in your dashboard within a few minutes of installation.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
