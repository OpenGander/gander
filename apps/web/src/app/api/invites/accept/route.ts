/**
 * Accept Invite API
 * GET /api/invites/accept?token=xxx - Get invite details for acceptance page
 * POST /api/invites/accept - Accept invite and create user
 */

import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { generateSessionToken, getSessionCookieOptions } from '@/lib/auth';
import { getClickHouseClient } from '@/lib/clickhouse';
import { generateUserId } from '@/lib/utils/ids';
import { normalizeEmail } from '@/lib/utils/email';
import { pgIdentityEnabled } from '@/lib/db/identity-flag';
import * as identityPg from '@/lib/queries/identity-pg';
import type { Invite, Role } from '@/lib/types/user-management';
import logger from '@/lib/logger';

interface InviteWithTenant extends Invite {
  TenantName?: string;
}

async function getInviteByToken(token: string): Promise<InviteWithTenant | null> {
  if (pgIdentityEnabled()) return identityPg.getInviteByToken(token);
  const client = getClickHouseClient();
  const result = await client.query({
    query: `
      SELECT
        i.InviteId,
        i.Email,
        i.TenantId,
        i.Token,
        i.Role,
        i.InvitedBy,
        i.ExpiresAt,
        i.CreatedAt,
        i.AcceptedAt,
        t.Name AS TenantName
      FROM opengander.invites i FINAL
      LEFT JOIN opengander.tenants t FINAL ON i.TenantId = t.TenantId
      WHERE i.Token = {token:String}
      LIMIT 1
    `,
    query_params: { token },
    format: 'JSONEachRow',
  });
  const rows = await result.json<InviteWithTenant[]>();
  return rows[0] || null;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }

    const invite = await getInviteByToken(token);

    if (!invite) {
      return NextResponse.json({ error: 'Invalid invite token' }, { status: 404 });
    }

    // Check if already accepted
    if (invite.AcceptedAt) {
      return NextResponse.json({ error: 'Invite has already been accepted' }, { status: 400 });
    }

    // Check if expired
    if (new Date(invite.ExpiresAt) < new Date()) {
      return NextResponse.json({ error: 'Invite has expired' }, { status: 400 });
    }

    // Return invite details (without sensitive token)
    return NextResponse.json({
      invite: {
        InviteId: invite.InviteId,
        Email: invite.Email,
        TenantId: invite.TenantId,
        TenantName: invite.TenantName,
        Role: invite.Role,
        ExpiresAt: invite.ExpiresAt,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Error getting invite');
    return NextResponse.json({ error: 'Failed to get invite' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token } = body;

    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }

    const invite = await getInviteByToken(token);

    if (!invite) {
      return NextResponse.json({ error: 'Invalid invite token' }, { status: 404 });
    }

    // Check if already accepted
    if (invite.AcceptedAt) {
      return NextResponse.json({ error: 'Invite has already been accepted' }, { status: 400 });
    }

    // Check if expired
    if (new Date(invite.ExpiresAt) < new Date()) {
      return NextResponse.json({ error: 'Invite has expired' }, { status: 400 });
    }

    // Normalize email for consistent storage and lookup
    const email = normalizeEmail(invite.Email);
    const userId = generateUserId();

    if (pgIdentityEnabled()) {
      // Postgres: create the user and mark the invite accepted atomically.
      const result = await identityPg.acceptInvite(invite.Token, userId);
      if (!result.ok) {
        switch (result.reason) {
          case 'user_exists':
            return NextResponse.json({ error: 'User already exists' }, { status: 400 });
          case 'already_accepted':
            return NextResponse.json(
              { error: 'Invite has already been accepted' },
              { status: 400 }
            );
          case 'expired':
            return NextResponse.json({ error: 'Invite has expired' }, { status: 400 });
          default:
            return NextResponse.json({ error: 'Invalid invite token' }, { status: 404 });
        }
      }
    } else {
      const client = getClickHouseClient();

      // Check if user already exists
      const existingUserResult = await client.query({
        query: `
          SELECT UserId FROM opengander.users FINAL
          WHERE Email = {email:String}
          LIMIT 1
        `,
        query_params: { email },
        format: 'JSONEachRow',
      });
      const existingUsers = await existingUserResult.json<{ UserId: string }[]>();

      if (existingUsers.length > 0) {
        return NextResponse.json({ error: 'User already exists' }, { status: 400 });
      }

      // Create user
      await client.insert({
        table: 'opengander.users',
        values: [
          {
            UserId: userId,
            Email: email,
            TenantId: invite.TenantId,
            Role: invite.Role,
          },
        ],
        format: 'JSONEachRow',
      });

      // Mark invite as accepted (insert new row with AcceptedAt)
      await client.insert({
        table: 'opengander.invites',
        values: [
          {
            InviteId: invite.InviteId,
            Email: email,
            TenantId: invite.TenantId,
            Token: invite.Token,
            Role: invite.Role,
            InvitedBy: invite.InvitedBy,
            ExpiresAt: invite.ExpiresAt,
            AcceptedAt: new Date().toISOString().replace('Z', ''),
          },
        ],
        format: 'JSONEachRow',
      });
    }

    // Log audit event (audit_logs stays in ClickHouse — append-only)
    await getClickHouseClient().insert({
      table: 'opengander.audit_logs',
      values: [
        {
          AuditId: uuidv4(),
          ActorUserId: userId,
          ActorEmail: email,
          ActorTenantId: invite.TenantId,
          Action: 'invite_accept',
          TargetUserId: null,
          TargetTenantId: invite.TenantId,
          Metadata: JSON.stringify({
            inviteId: invite.InviteId,
            invitedBy: invite.InvitedBy,
          }),
          IpAddress: req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown',
          UserAgent: req.headers.get('user-agent') || 'unknown',
        },
      ],
      format: 'JSONEachRow',
    });

    // Create session token
    const sessionToken = await generateSessionToken(
      userId,
      email,
      invite.TenantId,
      invite.TenantName,
      invite.Role as Role
    );

    // Create response with session cookie
    const response = NextResponse.json({
      success: true,
      user: {
        UserId: userId,
        Email: email,
        TenantId: invite.TenantId,
        TenantName: invite.TenantName,
        Role: invite.Role,
      },
    });

    // Set session cookie
    const cookieOptions = getSessionCookieOptions();
    response.cookies.set({
      ...cookieOptions,
      value: sessionToken,
    });

    return response;
  } catch (err) {
    logger.error({ err }, 'Error accepting invite');
    return NextResponse.json({ error: 'Failed to accept invite' }, { status: 500 });
  }
}
