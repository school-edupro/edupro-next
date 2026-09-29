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
  const reset = req.nextUrl.searchParams.get('reset') === '1';
  const resetYear = req.nextUrl.searchParams.get('resetYear') === '1';
  const current = reset ? {} : await readContext();
  if (resetYear && current.schoolId) {
    // a stale or closed working year: keep the school, let the API fall back to the active year
    await writeContext({ schoolId: current.schoolId });
    return NextResponse.redirect(new URL(safeReturn, req.url), { status: 303 });
  }
  if (!current.schoolId) {
    if (reset) await writeContext({}); // clear the stale school before calling the API
    const me = await getMe();
    const first = me.memberships[0];
    if (first) await writeContext({ schoolId: first.schoolId });
    else if (reset)
      return NextResponse.redirect(new URL('/login?error=no-membership', req.url), { status: 303 });
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

  let schoolChanged = false;
  if (typeof schoolId === 'string' && id.test(schoolId)) {
    const me = await getMe();
    if (!me.memberships.some((m) => m.schoolId === schoolId)) {
      return NextResponse.json({ type: 'tenant-forbidden' }, { status: 403 });
    }
    schoolChanged = schoolId !== current.schoolId;
    next.schoolId = schoolId;
    if (schoolChanged) next.academicYearId = undefined; // years are school-specific; the API falls back to the active year
  }
  // The switcher posts both selects; the year it carries belongs to the previous school when the school
  // changed, so it is ignored then (otherwise the API answers year-forbidden and the shell resets the school).
  if (!schoolChanged && typeof academicYearId === 'string' && id.test(academicYearId)) {
    next.academicYearId = academicYearId;
  }
  await writeContext(next);
  const back = req.headers.get('referer') ?? '/';
  return NextResponse.redirect(back, { status: 303 });
}
