'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X, Loader2, AlertCircle } from 'lucide-react';

export default function DomainsPage() {
  const router = useRouter();
  const [domains, setDomains] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);

  function validateDomain(domain: string): boolean {
    const domainRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
    return domainRegex.test(domain);
  }

  function handleAddDomain() {
    const domainsToAdd = inputValue
      .split(/[,\s]+/)
      .map((d) => d.toLowerCase().trim())
      .filter((d) => d);

    if (domainsToAdd.length === 0) {
      setInputError('Please enter a domain');
      return;
    }

    const invalid = domainsToAdd.filter((d) => !validateDomain(d));
    if (invalid.length > 0) {
      setInputError(`Invalid: ${invalid.join(', ')}`);
      return;
    }

    const duplicates = domainsToAdd.filter((d) => domains.includes(d));
    const newDomains = domainsToAdd.filter((d) => !domains.includes(d));

    if (newDomains.length === 0) {
      setInputError(
        duplicates.length === 1 ? 'This domain is already added' : 'All domains already added'
      );
      return;
    }

    setDomains([...domains, ...newDomains]);
    setInputValue('');
    setInputError(null);
  }

  function handleRemoveDomain(domain: string) {
    setDomains(domains.filter((d) => d !== domain));
  }

  function handleKeyPress(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddDomain();
    }
  }

  async function handleContinue() {
    if (domains.length === 0) {
      setError('Please add at least one domain');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/onboarding/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domains }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save domains');
      }

      router.push(data.nextStep);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setIsLoading(false);
    }
  }

  return (
    <div className="flex justify-center">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Add Your Domains</CardTitle>
          <CardDescription>
            Enter the domains where you'll install the tracking snippet
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Domain input */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder="site1.com, site2.com"
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  setInputError(null);
                }}
                onKeyPress={handleKeyPress}
                className={inputError ? 'border-red-500' : ''}
              />
              <Button
                type="button"
                onClick={handleAddDomain}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                Add domain
              </Button>
            </div>
            {inputError && <p className="text-sm text-red-500">{inputError}</p>}
          </div>

          {/* Domain list */}
          {domains.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Your domains</label>
              <div className="space-y-2">
                {domains.map((domain) => (
                  <div
                    key={domain}
                    className="flex items-center justify-between rounded-md border bg-muted px-3 py-2"
                  >
                    <span className="text-sm text-foreground">{domain}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveDomain(domain)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Info box */}
          <div className="flex gap-3 rounded-md bg-primary/10 p-3">
            <AlertCircle className="h-5 w-5 flex-shrink-0 text-primary" />
            <p className="text-sm text-primary">
              You can add more domains later from your dashboard settings.
            </p>
          </div>

          {/* Error message */}
          {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}

          {/* Continue button */}
          <Button
            onClick={handleContinue}
            disabled={isLoading || domains.length === 0}
            className="w-full"
            size="lg"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Continue'
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
