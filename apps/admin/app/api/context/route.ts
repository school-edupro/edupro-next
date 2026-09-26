import { NextResponse, type NextRequest } from 'next/server';
import { getMe } from '@/lib/api';
import { readContext, writeContext } from '@/lib/session';

/**
 * First-login convenience: when no school is selected yet, pick the user's first membership and return to
 * where they were. Server components cannot set cookies, so the shell layout redirects here.
 */
export async function GET(req: NextRequest) {
  const returnTo = req.nextUrl.searchParams.get('returnTo') ?? '/';
  const safeReturn = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
  const current = await readContext();
  if (!current.schoolId) {
    const me = await getMe();
    const first = me.memberships[0];
    if (first) await writeContext({ schoolId: first.schoolId });
  }
  return NextResponse.redirect(new URL(safeReturn, req.url), { status: 303 });
}

/**
 * Switches the working school or year. The school must be one of the user's memberships (the API also
 * enforces this on every call, so this check is for a good error message, not for security).
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const schoolId = form.get('schoolId');
  const academicYearId = form.get('academicYearId');
  const id = /^[0-9]{1,18}$/;

  const current = await readContext();
  const next = { ...current };

  if (typeof schoolId === 'string' && id.test(schoolId)) {
    const me = await getMe();
    if (!me.memberships.some((m) => m.schoolId === schoolId)) {
      return NextResponse.json({ type: 'tenant-forbidden' }, { status: 403 });
    }
    next.schoolId = schoolId;
    next.academicYearId = undefined; // year is school-specific; the API falls back to the active year
  }
  if (typeof academicYearId === 'string' && id.test(academicYearId)) {
    next.academicYearId = academicYearId;
  }
  await writeContext(next);
  const back = req.headers.get('referer') ?? '/';
  return NextResponse.redirect(back, { status: 303 });
}
