import { NextResponse } from 'next/server';
import { API } from '@/lib/api';
import { visitorHeaders } from '@/lib/visitor';

export async function POST() {
  const res = await fetch(`${API}/api/v1/public/admissions/challenge`, {
    method: 'POST',
    headers: { ...(await visitorHeaders()) },
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
