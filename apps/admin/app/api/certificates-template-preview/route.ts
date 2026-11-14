import { NextResponse } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** The template editor's live preview: the body and styles as typed, rendered by the API (nothing saved). */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: 'The template could not be read' }, { status: 400 });
  }
  try {
    const r = await apiFetch<{ html: string }>('/certificates/setup/templates/preview', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return NextResponse.json({ html: r.html });
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.json(
        { detail: error.problem.detail ?? error.problem.type },
        { status: error.status },
      );
    throw error;
  }
}
