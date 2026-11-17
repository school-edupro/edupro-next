import { NextResponse } from 'next/server';
import { API } from '@/lib/api';
import { visitorHeaders } from '@/lib/visitor';

/**
 * A certificate check from the verify pages (17 Nov 2026): the number and date (a search) or the QR's code, with the
 * human check's answer, passed to the API with the visitor's address.
 */
export async function POST(req: Request) {
  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ type: 'validation-failed' }, { status: 400 });
  }
  const school = typeof b.school === 'string' ? b.school : '';
  const token = typeof b.token === 'string' ? b.token : '';
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(school) || (token && !/^[0-9a-f]{20,64}$/.test(token)))
    return NextResponse.json({ type: 'validation-failed' }, { status: 400 });
  const str = (k: string) =>
    typeof b[k] === 'string' ? (b[k] as string).slice(0, 4000) : undefined;
  const human = { recaptcha: str('recaptcha'), challenge: str('challenge'), nonce: str('nonce') };
  const res = await fetch(
    `${API}/api/v1/public/certificates/${encodeURIComponent(school)}/verify${token ? `/${token}` : ''}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await visitorHeaders()) },
      body: JSON.stringify(token ? human : { number: str('number'), date: str('date'), ...human }),
      cache: 'no-store',
    },
  );
  return NextResponse.json(await res.json(), { status: res.status });
}
