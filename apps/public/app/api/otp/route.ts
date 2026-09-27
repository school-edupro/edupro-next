import { NextResponse } from 'next/server';
import { API } from '@/lib/api';

export async function POST(req: Request) {
  const body = (await req.json()) as {
    school: string;
    mobile: string;
    challenge: string;
    nonce: string;
  };
  const res = await fetch(`${API}/api/v1/public/admissions/otp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      schoolCode: body.school,
      mobile: body.mobile,
      challenge: body.challenge,
      nonce: body.nonce,
    }),
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
