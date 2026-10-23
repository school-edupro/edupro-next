import { NextResponse } from 'next/server';
import { API } from '@/lib/api';

/** A sign-in code for the admission portal (the challenge solved in the browser). */
export async function POST(req: Request) {
  const body = (await req.json()) as {
    school: string;
    identifier: string;
    challenge: string;
    nonce: string;
  };
  const res = await fetch(`${API}/api/v1/public/admission/code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      schoolCode: body.school,
      identifier: body.identifier,
      challenge: body.challenge,
      nonce: body.nonce,
    }),
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
