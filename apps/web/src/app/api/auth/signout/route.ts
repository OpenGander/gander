import { NextResponse } from 'next/server';
import { getSessionCookieOptions } from '@/lib/auth';
import logger from '@/lib/logger';

export async function POST() {
  try {
    const response = NextResponse.json({ success: true });

    // Clear session cookie
    const cookieOptions = getSessionCookieOptions();
    response.cookies.set({
      ...cookieOptions,
      value: '',
      maxAge: 0,
    });

    return response;
  } catch (error) {
    logger.error({ err: error }, 'Error in signout');
    return NextResponse.json({ error: 'Signout failed' }, { status: 500 });
  }
}
