/**
 * User Management Types
 * Defines roles, tenants, invites, and audit log interfaces for the user management system
 */

// =============================================================================
// Role System
// =============================================================================

/**
 * User roles with hierarchical permissions
 * - superadmin: Global access, can impersonate users with audit trail
 * - admin: Agency-level, manages users/clients within their org
 * - moderator: Can invite/remove users in their tenant
 * - user: View-only analytics access
 */
export type Role = 'superadmin' | 'admin' | 'moderator' | 'user';

/**
 * Role hierarchy for permission checks (higher number = more permissions)
 */
export const ROLE_HIERARCHY: Record<Role, number> = {
  user: 1,
  moderator: 2,
  admin: 3,
  superadmin: 4,
};

/**
 * Human-readable role labels
 */
export const ROLE_LABELS: Record<Role, string> = {
  superadmin: 'Super Admin',
  admin: 'Admin',
  moderator: 'Moderator',
  user: 'User',
};

/**
 * Role descriptions for UI tooltips
 */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  superadmin: 'Full system access including impersonation and all tenants',
  admin: 'Manage users and clients within the organization',
  moderator: 'Invite and remove users within the tenant',
  user: 'View analytics data only',
};

// =============================================================================
// Tenant Types
// =============================================================================

/**
 * Tenant (organization) record
 * Supports parent/child hierarchy for agency/client model
 */
export interface Tenant {
  TenantId: string;
  Name: string;
  Slug: string;
  AllowedDomains: string[];
  ParentTenantId: string | null;
  CreatedAt: string;
  UpdatedAt: string;
}

/**
 * Tenant with computed child tenants
 */
export interface TenantWithChildren extends Tenant {
  children?: Tenant[];
}

// =============================================================================
// User Types
// =============================================================================

/**
 * User record from database
 */
export interface User {
  UserId: string;
  Email: string;
  TenantId: string;
  Role: Role;
  CreatedAt: string;
  UpdatedAt: string;
}

/**
 * User with associated tenant info for UI display
 */
export interface UserWithTenant extends User {
  TenantName?: string;
  TenantSlug?: string;
}

// =============================================================================
// Multi-Tenant Membership Types
// =============================================================================

/**
 * User-Tenant membership record from database
 * Represents a user's membership in a specific tenant with their role there
 */
export interface UserTenantMembership {
  UserId: string;
  TenantId: string;
  Role: Role;
  JoinedAt: string;
  InvitedBy: string | null;
  UpdatedAt?: string;
}

/**
 * Membership with additional tenant info for UI display
 */
export interface MembershipWithTenant extends UserTenantMembership {
  TenantName?: string;
  TenantSlug?: string;
}

// =============================================================================
// Invite Types
// =============================================================================

/**
 * Invite status computed from dates
 */
export type InviteStatus = 'pending' | 'accepted' | 'expired';

/**
 * Invite record from database
 */
export interface Invite {
  InviteId: string;
  Email: string;
  TenantId: string;
  Token: string;
  Role: Role;
  InvitedBy: string;
  ExpiresAt: string;
  CreatedAt: string;
  AcceptedAt: string | null;
}

/**
 * Invite with computed status and inviter info
 */
export interface InviteWithStatus extends Invite {
  status: InviteStatus;
  InviterEmail?: string;
  TenantName?: string;
}

/**
 * Get the status of an invite based on dates
 */
export function getInviteStatus(invite: Invite): InviteStatus {
  if (invite.AcceptedAt) {
    return 'accepted';
  }
  if (new Date(invite.ExpiresAt) < new Date()) {
    return 'expired';
  }
  return 'pending';
}

// =============================================================================
// Audit Log Types
// =============================================================================

/**
 * Audit action types for security tracking
 */
export type AuditAction =
  | 'impersonate_start'
  | 'impersonate_end'
  | 'invite_user'
  | 'invite_accept'
  | 'invite_cancel'
  | 'change_role'
  | 'remove_user'
  | 'add_to_tenant'
  | 'remove_from_tenant'
  | 'create_tenant'
  | 'update_tenant'
  | 'delete_tenant'
  | 'create_api_key'
  | 'revoke_api_key'
  | 'token_revoked'
  | 'token_revocation_denied'
  | 'add_domain'
  | 'remove_domain';

/**
 * Audit log record from database
 */
export interface AuditLog {
  AuditId: string;
  Timestamp: string;
  ActorUserId: string;
  ActorEmail: string;
  ActorTenantId: string;
  Action: AuditAction;
  TargetUserId: string | null;
  TargetTenantId: string | null;
  Metadata: string; // JSON string
  IpAddress: string;
  UserAgent: string;
}

/**
 * Parsed audit log with metadata object
 */
export interface AuditLogParsed extends Omit<AuditLog, 'Metadata'> {
  Metadata: Record<string, unknown>;
}

/**
 * Human-readable audit action labels
 */
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  impersonate_start: 'Started impersonation',
  impersonate_end: 'Ended impersonation',
  invite_user: 'Invited user',
  invite_accept: 'Accepted invite',
  invite_cancel: 'Cancelled invite',
  change_role: 'Changed role',
  remove_user: 'Removed user',
  add_to_tenant: 'Added to organization',
  remove_from_tenant: 'Removed from organization',
  create_tenant: 'Created organization',
  update_tenant: 'Updated organization',
  delete_tenant: 'Deleted organization',
  create_api_key: 'Created API key',
  revoke_api_key: 'Revoked API key',
  token_revoked: 'Revoked OAuth token',
  token_revocation_denied: 'Token revocation denied',
  add_domain: 'Added domain',
  remove_domain: 'Removed domain',
};

// =============================================================================
// Domain Types
// =============================================================================

/**
 * Tenant domain for telemetry collection
 */
export interface TenantDomain {
  DomainId: string;
  TenantId: string;
  Domain: string;
  DisplayName: string;
  Verified: boolean;
  VerificationToken: string;
  CreatedAt: string;
  UpdatedAt: string;
}

// =============================================================================
// Impersonation Types
// =============================================================================

/**
 * Impersonation context stored in session
 */
export interface ImpersonationContext {
  originalUserId: string;
  originalEmail: string;
  originalTenantId: string;
  originalRole: Role;
  startedAt: string;
}

// =============================================================================
// API Request/Response Types
// =============================================================================

/**
 * Request to create an invite
 */
export interface CreateInviteRequest {
  email: string;
  role: Role;
  tenantId?: string; // Optional, defaults to actor's tenant
}

/**
 * Request to update a user's role
 */
export interface UpdateUserRoleRequest {
  role: Role;
}

/**
 * Request to start impersonation
 */
export interface StartImpersonationRequest {
  targetUserId: string;
}

/**
 * Request to create a tenant
 */
export interface CreateTenantRequest {
  name: string;
  slug: string;
  allowedDomains?: string[];
  parentTenantId?: string;
}

/**
 * Request to update a tenant
 */
export interface UpdateTenantRequest {
  name?: string;
  allowedDomains?: string[];
}

// =============================================================================
// Service Mapping Types
// =============================================================================

/**
 * Service mapping from ClickHouse
 * Maps SDK ServiceName to a user-friendly display name
 */
export interface ServiceMapping {
  TenantId: string;
  ServiceName: string;
  DisplayName: string;
  CreatedAt: string;
  UpdatedAt: string;
}

/**
 * Service status
 * - stub: Manually created service waiting for telemetry data
 * - active: Service has received telemetry data
 */
export type ServiceStatus = 'stub' | 'active';

/**
 * Platform types for SDK installation instructions
 */
export type ServicePlatform = 'web' | 'nodejs' | 'python' | '';

/**
 * Service with optional display name mapping
 * Used in the UI to show services from actual data with friendly names
 */
export interface ServiceWithMapping {
  serviceName: string;
  displayName: string; // Falls back to serviceName if no mapping
  hasData: boolean;
  status: ServiceStatus; // 'stub' = pending data, 'active' = has telemetry
  platform?: ServicePlatform; // Platform for installation instructions
  createdBy?: string; // UserId who created the stub
}
