import { NextResponse } from 'next/server';
import { API } from '@/lib/api';
import { SCHOOL_RE, TOKEN_RE } from '@/lib/consent';

/** Asks the API for a one-time code on a consent form's public link (after the proof of work). */
export async function POST(req: Request) {
  const body = (await req.json()) as Record<string, string | undefined>;
  const school = body.school ?? '';
  const token = body.token ?? '';
  if (!SCHOOL_RE.test(school) || !TOKEN_RE.test(token))
    return NextResponse.json({ type: 'not-found' }, { status: 404 });
  const res = await fetch(`${API}/api/v1/public/consent-forms/${school}/${token}/otp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: body.mode,
      mobile: body.mobile || undefined,
      email: body.email || undefined,
      admissionNo: body.admissionNo || undefined,
      challenge: body.challenge,
      nonce: body.nonce,
    }),
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
