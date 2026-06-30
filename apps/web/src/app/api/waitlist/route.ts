import { NextResponse } from 'next/server';
import { sendWaitlistNotification } from '@/lib/email';
import { z } from 'zod';
import logger from '@/lib/logger';

const waitlistSchema = z.object({
  email: z.string().email('Invalid email address'),
  company: z.string().optional(),
});

// CORS headers for cross-origin requests from marketing site
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://opengander.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Handle preflight OPTIONS request
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Validate input
    const result = waitlistSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: result.error.errors[0].message },
        { status: 400, headers: corsHeaders }
      );
    }

    const { email, company } = result.data;

    await sendWaitlistNotification({ email, company });

    return NextResponse.json(
      {
        success: true,
        message: 'Thanks for joining the waitlist!',
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    logger.error({ err: error }, 'Error in waitlist signup');
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500, headers: corsHeaders }
    );
  }
}
