/**
 * Individual MCP API Key - Revoke API key
 * DELETE /api/mcp-keys/[keyId] - Revoke API key (soft delete with RevokedAt)
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { getClickHouseClient } from '@/lib/clickhouse';
import { logAudit } from '@/lib/audit';
import { pgAuthEnabled } from '@/lib/db/auth-flag';
import * as apiKeysPg from '@/lib/queries/api-keys-pg';
import logger from '@/lib/logger';

interface RouteParams {
  params: Promise<{ keyId: string }>;
}

interface ApiKeyRow {
  KeyId: string;
  KeyHash: string;
  KeyPrefix: string;
  Name: string;
  UserId: string;
  TenantId: string;
  Role: string;
  AllowedTenants: string[];
  AllowedTools: string[];
  ExpiresAt: string | null;
  LastUsedAt: string | null;
  RevokedAt: string | null;
}

async function getApiKey(keyId: string): Promise<ApiKeyRow | null> {
  if (pgAuthEnabled()) return apiKeysPg.getApiKeyById(keyId);
  const client = getClickHouseClient();
  const result = await client.query({
    query: `
      SELECT
        KeyId,
        KeyHash,
        KeyPrefix,
        Name,
        UserId,
        TenantId,
        Role,
        AllowedTenants,
        AllowedTools,
        ExpiresAt,
        LastUsedAt,
        RevokedAt
      FROM opengander.api_keys FINAL
      WHERE KeyId = {keyId:String}
      LIMIT 1
    `,
    query_params: { keyId },
    format: 'JSONEachRow',
  });
  const rows = await result.json<ApiKeyRow[]>();
  return rows[0] || null;
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await verifySession(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { keyId } = await params;

    if (!keyId) {
      return NextResponse.json({ error: 'Key ID is required' }, { status: 400 });
    }

    // Get the API key
    const apiKey = await getApiKey(keyId);
    if (!apiKey) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    }

    // Verify ownership - users can only revoke their own keys
    if (apiKey.UserId !== session.userId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Check if already revoked
    if (apiKey.RevokedAt) {
      return NextResponse.json({ error: 'API key is already revoked' }, { status: 400 });
    }

    // Soft delete by setting RevokedAt
    if (pgAuthEnabled()) {
      await apiKeysPg.revokeApiKey(apiKey.KeyId);
    } else {
      // ClickHouse ReplacingMergeTree: insert a new row with RevokedAt set.
      // Must preserve all original values as the latest row becomes the source
      // of truth; FINAL in queries returns only the latest version.
      const now = new Date().toISOString().replace('Z', '');
      await getClickHouseClient().insert({
        table: 'opengander.api_keys',
        values: [
          {
            KeyId: apiKey.KeyId,
            KeyHash: apiKey.KeyHash,
            KeyPrefix: apiKey.KeyPrefix,
            Name: apiKey.Name,
            UserId: apiKey.UserId,
            TenantId: apiKey.TenantId,
            Role: apiKey.Role,
            AllowedTenants: apiKey.AllowedTenants,
            AllowedTools: apiKey.AllowedTools,
            ExpiresAt: apiKey.ExpiresAt,
            LastUsedAt: apiKey.LastUsedAt,
            RevokedAt: now,
            CreatedAt: now, // ReplacingMergeTree uses latest CreatedAt
          },
        ],
        format: 'JSONEachRow',
      });
    }

    // Log audit event
    await logAudit(session, 'revoke_api_key', req, {
      targetTenantId: apiKey.TenantId,
      metadata: {
        keyId: apiKey.KeyId,
        keyPrefix: apiKey.KeyPrefix,
        name: apiKey.Name,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'API key revoked successfully',
    });
  } catch (err) {
    logger.error({ err }, 'Error revoking API key');
    return NextResponse.json({ error: 'Failed to revoke API key' }, { status: 500 });
  }
}
