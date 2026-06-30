import { NextRequest, NextResponse } from 'next/server';
import { generateSessionToken, getSessionCookieOptions } from '@/lib/auth';
import { getUserByEmail, getTenantById } from '@/lib/queries/users';
import { normalizeEmail } from '@/lib/utils/email';
import logger from '@/lib/logger';

export async function POST(req: NextRequest) {
  // Hard guard: only available in development
  if (process.env.NODE_ENV !== 'development') {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ error: 'Email required' }, { status: 400 });
    }

    const normalized = normalizeEmail(email);
    const user = await getUserByEmail(normalized);

    if (!user) {
      return NextResponse.json(
        { error: 'User not found. Run npm run db:seed first.' },
        { status: 404 }
      );
    }

    const tenant = await getTenantById(user.TenantId);
    const sessionToken = await generateSessionToken(
      user.UserId,
      user.Email,
      user.TenantId,
      tenant?.Name,
      user.Role
    );

    const cookieOptions = getSessionCookieOptions();
    const response = NextResponse.json({ success: true, redirectUrl: '/' });

    response.cookies.set({
      ...cookieOptions,
      value: sessionToken,
    });

    logger.info({ email: normalized, role: user.Role }, 'Dev login');
    return response;
  } catch (error) {
    logger.error({ err: error }, 'Dev login failed');
    return NextResponse.json({ error: 'Dev login failed' }, { status: 500 });
  }
}
