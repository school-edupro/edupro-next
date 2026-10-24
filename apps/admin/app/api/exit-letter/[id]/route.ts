import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** The letter of an employee exit (the office, the employee, an approver): opens, or saves with ?save=1. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id))
    return NextResponse.json({ type: 'validation-failed' }, { status: 400 });
  try {
    const r = await apiFetch<{ download: { url: string; saveUrl?: string } }>(
      `/people/exits/${id}/letter`,
    );
    const save = req.nextUrl.searchParams.get('save') === '1';
    return NextResponse.redirect(save ? (r.download.saveUrl ?? r.download.url) : r.download.url, {
      status: 303,
    });
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.json({ type: error.problem.type }, { status: error.status });
    throw error;
  }
}
