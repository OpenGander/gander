/**
 * MCP API Keys - List and create API keys
 * GET /api/mcp-keys - List user's API keys (masked display)
 * POST /api/mcp-keys - Create new API key (returns full key once, stores SHA-256 hash)
 */

import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { verifySession } from '@/lib/auth';
import { getClickHouseClient } from '@/lib/clickhouse';
import { getTenantScope } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { pgAuthEnabled } from '@/lib/db/auth-flag';
import * as apiKeysPg from '@/lib/queries/api-keys-pg';
import logger from '@/lib/logger';

/**
 * API Key prefix for identification
 */
const API_KEY_PREFIX = 'og_live_';

/**
 * Number of characters to show at end of masked key
 */
const MASKED_SUFFIX_LENGTH = 4;

/**
 * Hash a key using SHA-256
 */
function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Generate a new API key
 * Format: og_live_<32-char-random>
 */
function generateApiKey(): string {
  const randomPart = crypto.randomBytes(16).toString('hex');
  return `${API_KEY_PREFIX}${randomPart}`;
}

/**
 * Extract prefix for display (first 11 chars: "og_live_xxx")
 */
function getKeyPrefix(key: string): string {
  return key.substring(0, 11);
}

/**
 * Get masked key for display
 * Shows prefix + "..." + last 4 chars
 */
function getMaskedKey(keyPrefix: string, fullKey?: string): string {
  if (fullKey) {
    const suffix = fullKey.slice(-MASKED_SUFFIX_LENGTH);
    return `${keyPrefix}...${suffix}`;
  }
  return `${keyPrefix}...`;
}

interface ApiKeyRow {
  KeyId: string;
  KeyPrefix: string;
  Name: string;
  Role: string;
  AllowedTenants: string[];
  AllowedTools: string[];
  ExpiresAt: string | null;
  LastUsedAt: string | null;
  CreatedAt: string;
}

interface ApiKeyResponse {
  keyId: string;
  name: string;
  keyPrefix: string;
  maskedKey: string;
  role: string;
  allowedTenants: string[];
  allowedTools: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export async function GET(req: NextRequest) {
  try {
    const session = await verifySession(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Query active (non-revoked) API keys for the current user
    let rawKeys: ApiKeyRow[];
    if (pgAuthEnabled()) {
      rawKeys = await apiKeysPg.listActiveApiKeys(session.userId);
    } else {
      const result = await getClickHouseClient().query({
        query: `
          SELECT
            KeyId,
            KeyPrefix,
            Name,
            Role,
            AllowedTenants,
            AllowedTools,
            ExpiresAt,
            LastUsedAt,
            CreatedAt
          FROM opengander.api_keys FINAL
          WHERE UserId = {userId:String}
            AND RevokedAt IS NULL
          ORDER BY CreatedAt DESC
        `,
        query_params: { userId: session.userId },
        format: 'JSONEachRow',
      });
      rawKeys = await result.json<ApiKeyRow[]>();
    }

    // Transform to response format with masked keys
    const keys: ApiKeyResponse[] = rawKeys.map((key) => ({
      keyId: key.KeyId,
      name: key.Name,
      keyPrefix: key.KeyPrefix,
      maskedKey: getMaskedKey(key.KeyPrefix),
      role: key.Role,
      allowedTenants: key.AllowedTenants,
      allowedTools: key.AllowedTools,
      expiresAt: key.ExpiresAt,
      lastUsedAt: key.LastUsedAt,
      createdAt: key.CreatedAt,
    }));

    return NextResponse.json({ keys });
  } catch (err) {
    logger.error({ err }, 'Error listing API keys');
    return NextResponse.json({ error: 'Failed to list API keys' }, { status: 500 });
  }
}

interface CreateKeyRequest {
  name: string;
  allowedTools?: string[];
  expiresAt?: string;
}

export async function POST(req: NextRequest) {
  try {
    const session = await verifySession(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body: CreateKeyRequest = await req.json();
    const { name, allowedTools, expiresAt } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    if (name.length > 100) {
      return NextResponse.json({ error: 'Name must be 100 characters or less' }, { status: 400 });
    }

    // Validate expiresAt if provided
    let parsedExpiresAt: Date | null = null;
    if (expiresAt) {
      parsedExpiresAt = new Date(expiresAt);
      if (isNaN(parsedExpiresAt.getTime())) {
        return NextResponse.json({ error: 'Invalid expiresAt date format' }, { status: 400 });
      }
      if (parsedExpiresAt <= new Date()) {
        return NextResponse.json({ error: 'expiresAt must be in the future' }, { status: 400 });
      }
    }

    // Validate allowedTools if provided
    if (allowedTools !== undefined) {
      if (!Array.isArray(allowedTools)) {
        return NextResponse.json({ error: 'allowedTools must be an array' }, { status: 400 });
      }
      if (!allowedTools.every((t) => typeof t === 'string')) {
        return NextResponse.json(
          { error: 'allowedTools must contain only strings' },
          { status: 400 }
        );
      }
    }

    // Generate the API key
    const apiKey = generateApiKey();
    const keyHash = hashKey(apiKey);
    const keyPrefix = getKeyPrefix(apiKey);
    const keyId = `key_${uuidv4().replace(/-/g, '').substring(0, 16)}`;

    // Get user's tenant scope for allowed tenants
    const tenantScope = await getTenantScope(session);

    // Insert the new API key
    if (pgAuthEnabled()) {
      await apiKeysPg.createApiKey({
        keyId,
        keyHash,
        keyPrefix,
        name: name.trim(),
        userId: session.userId,
        tenantId: session.tenantId,
        role: session.role,
        allowedTenants: tenantScope,
        allowedTools: allowedTools || [],
        expiresAt: parsedExpiresAt,
      });
    } else {
      await getClickHouseClient().insert({
        table: 'opengander.api_keys',
        values: [
          {
            KeyId: keyId,
            KeyHash: keyHash,
            KeyPrefix: keyPrefix,
            Name: name.trim(),
            UserId: session.userId,
            TenantId: session.tenantId,
            Role: session.role,
            AllowedTenants: tenantScope,
            AllowedTools: allowedTools || [],
            ExpiresAt: parsedExpiresAt ? parsedExpiresAt.toISOString().replace('Z', '') : null,
            LastUsedAt: null,
            RevokedAt: null,
          },
        ],
        format: 'JSONEachRow',
      });
    }

    // Log audit event
    await logAudit(session, 'create_api_key', req, {
      targetTenantId: session.tenantId,
      metadata: {
        keyId,
        keyPrefix,
        name: name.trim(),
        allowedTools: allowedTools || [],
        expiresAt: parsedExpiresAt?.toISOString() || null,
      },
    });

    // Return the full key ONCE - it will never be shown again
    return NextResponse.json({
      success: true,
      key: {
        keyId,
        name: name.trim(),
        apiKey, // Full key - only returned on creation
        keyPrefix,
        role: session.role,
        allowedTenants: tenantScope,
        allowedTools: allowedTools || [],
        expiresAt: parsedExpiresAt?.toISOString() || null,
        createdAt: new Date().toISOString(),
      },
      warning: 'Save this API key now. It will not be shown again.',
    });
  } catch (err) {
    logger.error({ err }, 'Error creating API key');
    return NextResponse.json({ error: 'Failed to create API key' }, { status: 500 });
  }
}
