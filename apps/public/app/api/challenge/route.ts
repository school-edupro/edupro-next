import { NextResponse } from 'next/server';
import { API } from '@/lib/api';

export async function POST() {
  const res = await fetch(`${API}/api/v1/public/admissions/challenge`, {
    method: 'POST',
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
