import { NextResponse, type NextRequest } from 'next/server';
import { otp } from '@/lib/otp';

/** Sign-in with a code by email (0136): start, verify, resend, cancel. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const h = otp.handlers;
  if (action === 'start') return h.start(req);
  if (action === 'verify') return h.verify(req);
  if (action === 'resend') return h.resend(req);
  if (action === 'cancel') return h.cancel(req);
  return NextResponse.json({ type: 'not-found' }, { status: 404 });
}
