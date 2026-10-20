import { NextResponse } from 'next/server';
import { API } from '@/lib/api';

/** A sign-in code to the mobile or the email (the challenge solved in the browser). */
export async function POST(req: Request) {
  const body = (await req.json()) as {
    school: string;
    channel: 'mobile' | 'email';
    to: string;
    challenge: string;
    nonce: string;
  };
  const res = await fetch(`${API}/api/v1/public/careers/otp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      schoolCode: body.school,
      channel: body.channel,
      to: body.to,
      challenge: body.challenge,
      nonce: body.nonce,
    }),
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
