/**
 * Services Settings Page
 * Manage services: create stubs, edit display names, view installation instructions
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Server,
  Check,
  X,
  Pencil,
  RefreshCw,
  Plus,
  ChevronDown,
  ChevronRight,
  Copy,
  Trash2,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ServiceWithMapping, ServicePlatform } from '@/lib/types/user-management';

interface ServiceWithSnippet extends ServiceWithMapping {
  installSnippet: string | null;
  installInstructions: string;
}

export default function ServicesSettingsPage() {
  const [services, setServices] = useState<ServiceWithSnippet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingService, setEditingService] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedService, setExpandedService] = useState<string | null>(null);
  const [copiedService, setCopiedService] = useState<string | null>(null);

  // Add Service Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newPlatform, setNewPlatform] = useState<ServicePlatform>('web');
  const [addingService, setAddingService] = useState(false);

  // Derive service name from display name
  const deriveServiceName = (displayName: string): string => {
    return displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with hyphens
      .replace(/^-|-$/g, ''); // Trim leading/trailing hyphens
  };

  const derivedServiceName = deriveServiceName(newDisplayName);

  const fetchServices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/settings/services');
      if (!res.ok) {
        throw new Error('Failed to fetch services');
      }
      const data = await res.json();
      setServices(data.services || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch services');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  const startEditing = (service: ServiceWithSnippet) => {
    setEditingService(service.serviceName);
    setEditValue(service.displayName);
  };

  const cancelEditing = () => {
    setEditingService(null);
    setEditValue('');
  };

  const saveDisplayName = async (serviceName: string) => {
    if (!editValue.trim()) {
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/settings/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceName,
          displayName: editValue.trim(),
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to save display name');
      }

      // Update local state
      setServices((prev) =>
        prev.map((s) =>
          s.serviceName === serviceName ? { ...s, displayName: editValue.trim() } : s
        )
      );
      setEditingService(null);
      setEditValue('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const resetDisplayName = async (serviceName: string) => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/services', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceName }),
      });

      if (!res.ok) {
        throw new Error('Failed to reset display name');
      }

      // Update local state - reset to serviceName
      setServices((prev) =>
        prev.map((s) => (s.serviceName === serviceName ? { ...s, displayName: serviceName } : s))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset');
    } finally {
      setSaving(false);
    }
  };

  const addService = async () => {
    const serviceName = derivedServiceName;
    if (!serviceName) {
      return;
    }

    setAddingService(true);
    setError(null);

    try {
      const res = await fetch('/api/settings/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceName,
          displayName: newDisplayName.trim(),
          platform: newPlatform,
          isStub: true,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to add service');
      }

      // Refresh the list, auto-expand the new service, and reset form
      await fetchServices();
      setExpandedService(serviceName);
      setShowAddModal(false);
      setNewDisplayName('');
      setNewPlatform('web');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add service');
    } finally {
      setAddingService(false);
    }
  };

  const deleteService = async (serviceName: string) => {
    if (!confirm(`Are you sure you want to delete "${serviceName}"? This cannot be undone.`)) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/settings/services', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceName, deleteStub: true }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete service');
      }

      // Remove from local state
      setServices((prev) => prev.filter((s) => s.serviceName !== serviceName));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete service');
    } finally {
      setSaving(false);
    }
  };

  const copySnippet = async (serviceName: string, snippet: string) => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopiedService(serviceName);
      setTimeout(() => setCopiedService(null), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = snippet;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedService(serviceName);
      setTimeout(() => setCopiedService(null), 2000);
    }
  };

  const toggleExpanded = (serviceName: string) => {
    setExpandedService((prev) => (prev === serviceName ? null : serviceName));
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5" />
                Services
              </CardTitle>
              <CardDescription>
                Add and manage services in your portfolio. Create services before telemetry arrives,
                or manage existing ones.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" />
                Add Service
              </button>
              <button
                onClick={fetchServices}
                disabled={loading}
                className="p-2 text-muted-foreground hover:text-foreground rounded hover:bg-muted disabled:opacity-50"
                title="Refresh services"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
              {error}
            </div>
          )}

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 bg-muted animate-pulse rounded-md" />
              ))}
            </div>
          ) : services.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Server className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium">No services yet</p>
              <p className="text-sm mt-1 mb-4">
                Add your first service to get started with tracking.
              </p>
              <button
                onClick={() => setShowAddModal(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" />
                Add Service
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {services.map((service) => (
                <div key={service.serviceName} className="border rounded-lg overflow-hidden">
                  {/* Service Header Row */}
                  <div className="flex items-center justify-between p-4">
                    <div className="flex-1 min-w-0">
                      {editingService === service.serviceName ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="flex-1 px-3 py-1.5 text-sm border rounded bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                            placeholder="Display name"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                saveDisplayName(service.serviceName);
                              } else if (e.key === 'Escape') {
                                cancelEditing();
                              }
                            }}
                          />
                          <button
                            onClick={() => saveDisplayName(service.serviceName)}
                            disabled={saving || !editValue.trim()}
                            className="p-1.5 text-green-600 hover:bg-green-50 rounded disabled:opacity-50"
                            title="Save"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            onClick={cancelEditing}
                            disabled={saving}
                            className="p-1.5 text-muted-foreground hover:bg-muted rounded"
                            title="Cancel"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <div>
                            <div className="font-medium flex items-center gap-2">
                              {service.displayName}
                              {/* Status Badge */}
                              {service.status === 'active' ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Active
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full">
                                  <Clock className="h-3 w-3" />
                                  Pending
                                </span>
                              )}
                            </div>
                            {service.displayName !== service.serviceName && (
                              <div className="text-sm text-muted-foreground">
                                {service.serviceName}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {editingService !== service.serviceName && (
                      <div className="flex items-center gap-2 ml-4">
                        <button
                          onClick={() => startEditing(service)}
                          className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded"
                          title="Edit display name"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        {service.displayName !== service.serviceName && (
                          <button
                            onClick={() => resetDisplayName(service.serviceName)}
                            disabled={saving}
                            className="text-xs text-muted-foreground hover:text-foreground"
                            title="Reset to service name"
                          >
                            Reset
                          </button>
                        )}
                        {/* Install button */}
                        <button
                          onClick={() => toggleExpanded(service.serviceName)}
                          className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded"
                          title="View installation instructions"
                        >
                          {expandedService === service.serviceName ? (
                            <ChevronDown className="h-3 w-3" />
                          ) : (
                            <ChevronRight className="h-3 w-3" />
                          )}
                          Install
                        </button>
                        {/* Delete button for stubs only */}
                        {service.status === 'stub' && (
                          <button
                            onClick={() => deleteService(service.serviceName)}
                            disabled={saving}
                            className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded disabled:opacity-50"
                            title="Delete service"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Expanded Installation Panel */}
                  {expandedService === service.serviceName && (
                    <div className="border-t bg-muted/50 p-4">
                      <div className="space-y-4">
                        {/* Instructions */}
                        <div>
                          <h4 className="text-sm font-medium mb-2">Installation Instructions</h4>
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                            {service.installInstructions}
                          </p>
                        </div>

                        {/* Snippet (for web platform) */}
                        {service.installSnippet && (
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="text-sm font-medium">Tracking Snippet</h4>
                              <button
                                onClick={() =>
                                  copySnippet(service.serviceName, service.installSnippet!)
                                }
                                className="flex items-center gap-1 px-2 py-1 text-xs bg-background border rounded hover:bg-muted"
                              >
                                {copiedService === service.serviceName ? (
                                  <>
                                    <Check className="h-3 w-3 text-green-600" />
                                    Copied!
                                  </>
                                ) : (
                                  <>
                                    <Copy className="h-3 w-3" />
                                    Copy
                                  </>
                                )}
                              </button>
                            </div>
                            <pre className="p-3 bg-zinc-900 text-zinc-100 rounded-md text-xs overflow-x-auto">
                              <code>{service.installSnippet}</code>
                            </pre>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="mt-6 pt-4 border-t">
            <h3 className="text-sm font-medium mb-2">About Services</h3>
            <p className="text-sm text-muted-foreground">
              Services are identified by the{' '}
              <code className="px-1 py-0.5 bg-muted rounded text-xs">serviceName</code> configured
              in your SDK. You can add services before installing tracking to prepare your
              dashboard. Once telemetry data arrives, the status will change from
              &quot;Pending&quot; to &quot;Active&quot;.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Add Service Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => !addingService && setShowAddModal(false)}
          />
          <div className="relative bg-background rounded-lg shadow-lg p-6 max-w-md w-full mx-4 z-50">
            <button
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
              onClick={() => setShowAddModal(false)}
              disabled={addingService}
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-2 mb-2">
              <Plus className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Add Service</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Create a new service to prepare for tracking. You&apos;ll get installation
              instructions after creating.
            </p>

            <div className="space-y-4">
              {/* Service Name (user-friendly input that generates technical ID) */}
              <div className="space-y-2">
                <label htmlFor="displayName" className="text-sm font-medium">
                  Service Name <span className="text-red-500">*</span>
                </label>
                <input
                  id="displayName"
                  type="text"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  placeholder="My Website"
                  className="w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                />
                {derivedServiceName ? (
                  <p className="text-xs text-muted-foreground">
                    Technical ID:{' '}
                    <code className="px-1 py-0.5 bg-muted rounded">{derivedServiceName}</code>
                    <span className="block mt-1">
                      This identifier will be used in your SDK configuration.
                    </span>
                  </p>
                ) : newDisplayName.trim() ? (
                  <p className="text-xs text-red-500">
                    Name must contain at least one letter or number.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Enter a name for your service. A technical identifier will be generated
                    automatically.
                  </p>
                )}
              </div>

              {/* Platform */}
              <div className="space-y-2">
                <label htmlFor="platform" className="text-sm font-medium">
                  Platform
                </label>
                <select
                  id="platform"
                  value={newPlatform}
                  onChange={(e) => setNewPlatform(e.target.value as ServicePlatform)}
                  className="w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="web">Web (JavaScript SDK)</option>
                  <option value="nodejs">Node.js</option>
                  <option value="python">Python</option>
                </select>
                <p className="text-xs text-muted-foreground">
                  Choose the platform to get the appropriate installation instructions.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4 mt-4 border-t">
              <button
                onClick={() => setShowAddModal(false)}
                disabled={addingService}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={addService}
                disabled={!derivedServiceName || addingService}
                className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
              >
                {addingService ? 'Creating...' : 'Create Service'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
