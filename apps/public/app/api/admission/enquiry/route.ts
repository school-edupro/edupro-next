import { NextResponse } from 'next/server';
import { API } from '@/lib/api';

/** The website's admission enquiry (the challenge solved in the browser). */
export async function POST(req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  const pick = (k: string) =>
    typeof body[k] === 'string' && (body[k] as string).trim()
      ? (body[k] as string).trim()
      : undefined;
  const res = await fetch(`${API}/api/v1/public/admission/enquiry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      schoolCode: pick('school'),
      challenge: pick('challenge'),
      nonce: pick('nonce'),
      parentName: pick('parentName'),
      childName: pick('childName'),
      childDob: pick('childDob'),
      classId: pick('classId'),
      mobile: pick('mobile'),
      email: pick('email'),
      locality: pick('locality'),
      message: pick('message'),
    }),
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
