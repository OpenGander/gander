/**
 * Audit Logging Utility
 * Logs security-relevant events to the audit_logs table
 */

import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getClickHouseClient } from './clickhouse';
import type { SessionPayload } from './auth';
import type { AuditAction, AuditLog, AuditLogParsed } from './types/user-management';
import { getRealActor } from './rbac';

/**
 * Extract IP address from request
 */
function getIpAddress(req: NextRequest): string {
  // Check common headers for proxied requests
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  const realIp = req.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  // Fallback - in production behind a proxy this would be the proxy's IP
  return 'unknown';
}

/**
 * Extract user agent from request
 */
function getUserAgent(req: NextRequest): string {
  return req.headers.get('user-agent') || 'unknown';
}

/**
 * Log an audit event
 *
 * @param session - The current session (gets real actor if impersonating)
 * @param action - The action being performed
 * @param req - The incoming request (for IP/UA)
 * @param options - Additional options
 */
export async function logAudit(
  session: SessionPayload,
  action: AuditAction,
  req: NextRequest,
  options: {
    targetUserId?: string;
    targetTenantId?: string;
    metadata?: Record<string, unknown>;
  } = {}
): Promise<void> {
  const client = getClickHouseClient();

  // Get the real actor (original user if impersonating)
  const actor = getRealActor(session);

  const auditId = uuidv4();
  const ipAddress = getIpAddress(req);
  const userAgent = getUserAgent(req);

  // Include impersonation context in metadata if applicable
  const metadata = {
    ...options.metadata,
    ...(session.impersonating && {
      impersonating: {
        userId: session.userId,
        email: session.email,
        tenantId: session.tenantId,
      },
    }),
  };

  await client.insert({
    table: 'opengander.audit_logs',
    values: [
      {
        AuditId: auditId,
        ActorUserId: actor.userId,
        ActorEmail: actor.email,
        ActorTenantId: actor.tenantId,
        Action: action,
        TargetUserId: options.targetUserId || null,
        TargetTenantId: options.targetTenantId || null,
        Metadata: JSON.stringify(metadata),
        IpAddress: ipAddress,
        UserAgent: userAgent,
      },
    ],
    format: 'JSONEachRow',
  });
}

/**
 * Query audit logs with filters
 *
 * @param options - Filter options
 * @returns Array of parsed audit logs
 */
export async function queryAuditLogs(options: {
  actorTenantId?: string;
  targetTenantId?: string;
  action?: AuditAction;
  actorUserId?: string;
  targetUserId?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}): Promise<{ logs: AuditLogParsed[]; total: number }> {
  const client = getClickHouseClient();

  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (options.actorTenantId) {
    conditions.push('ActorTenantId = {actorTenantId:String}');
    params.actorTenantId = options.actorTenantId;
  }

  if (options.targetTenantId) {
    conditions.push('TargetTenantId = {targetTenantId:String}');
    params.targetTenantId = options.targetTenantId;
  }

  if (options.action) {
    conditions.push('Action = {action:String}');
    params.action = options.action;
  }

  if (options.actorUserId) {
    conditions.push('ActorUserId = {actorUserId:String}');
    params.actorUserId = options.actorUserId;
  }

  if (options.targetUserId) {
    conditions.push('TargetUserId = {targetUserId:String}');
    params.targetUserId = options.targetUserId;
  }

  if (options.startDate) {
    conditions.push('Timestamp >= {startDate:DateTime64(3)}');
    params.startDate = options.startDate.toISOString();
  }

  if (options.endDate) {
    conditions.push('Timestamp <= {endDate:DateTime64(3)}');
    params.endDate = options.endDate.toISOString();
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit || 50;
  const offset = options.offset || 0;

  // Get total count
  const countResult = await client.query({
    query: `SELECT count() as total FROM opengander.audit_logs ${whereClause}`,
    query_params: params,
    format: 'JSONEachRow',
  });
  const countRows = await countResult.json<{ total: string }[]>();
  const total = parseInt(countRows[0]?.total || '0', 10);

  // Get logs
  const result = await client.query({
    query: `
      SELECT
        AuditId,
        Timestamp,
        ActorUserId,
        ActorEmail,
        ActorTenantId,
        Action,
        TargetUserId,
        TargetTenantId,
        Metadata,
        IpAddress,
        UserAgent
      FROM opengander.audit_logs
      ${whereClause}
      ORDER BY Timestamp DESC
      LIMIT {limit:UInt32} OFFSET {offset:UInt32}
    `,
    query_params: { ...params, limit, offset },
    format: 'JSONEachRow',
  });

  const rawLogs = await result.json<AuditLog[]>();

  // Parse metadata JSON
  const logs: AuditLogParsed[] = rawLogs.map((log) => ({
    ...log,
    Metadata: JSON.parse(log.Metadata || '{}'),
  }));

  return { logs, total };
}

/**
 * Get audit logs for a specific user (either as actor or target)
 */
export async function getUserAuditLogs(
  userId: string,
  limit: number = 50
): Promise<AuditLogParsed[]> {
  const client = getClickHouseClient();

  const result = await client.query({
    query: `
      SELECT
        AuditId,
        Timestamp,
        ActorUserId,
        ActorEmail,
        ActorTenantId,
        Action,
        TargetUserId,
        TargetTenantId,
        Metadata,
        IpAddress,
        UserAgent
      FROM opengander.audit_logs
      WHERE ActorUserId = {userId:String} OR TargetUserId = {userId:String}
      ORDER BY Timestamp DESC
      LIMIT {limit:UInt32}
    `,
    query_params: { userId, limit },
    format: 'JSONEachRow',
  });

  const rawLogs = await result.json<AuditLog[]>();

  return rawLogs.map((log) => ({
    ...log,
    Metadata: JSON.parse(log.Metadata || '{}'),
  }));
}

/**
 * Get recent impersonation events for security monitoring
 */
export async function getRecentImpersonations(
  hours: number = 24,
  limit: number = 100
): Promise<AuditLogParsed[]> {
  const client = getClickHouseClient();

  const result = await client.query({
    query: `
      SELECT
        AuditId,
        Timestamp,
        ActorUserId,
        ActorEmail,
        ActorTenantId,
        Action,
        TargetUserId,
        TargetTenantId,
        Metadata,
        IpAddress,
        UserAgent
      FROM opengander.audit_logs
      WHERE Action IN ('impersonate_start', 'impersonate_end')
        AND Timestamp >= now64(3) - INTERVAL {hours:UInt32} HOUR
      ORDER BY Timestamp DESC
      LIMIT {limit:UInt32}
    `,
    query_params: { hours, limit },
    format: 'JSONEachRow',
  });

  const rawLogs = await result.json<AuditLog[]>();

  return rawLogs.map((log) => ({
    ...log,
    Metadata: JSON.parse(log.Metadata || '{}'),
  }));
}
