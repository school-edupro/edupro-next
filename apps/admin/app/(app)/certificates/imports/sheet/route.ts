import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';
import { NO_DEPT } from '@/lib/certificates';

/**
 * A certificate's sheet for the chosen classes and sections (the leavers, or departments): one row a person, filled
 * from the records (17 Nov 2026). Back to the page with the reason when it cannot be made.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const type = sp.get('type') ?? '';
  const scope = sp.get('scope') ?? 'sections';
  const sections = sp.getAll('section').filter((x) => /^\d{1,18}$/.test(x));
  const depts = sp.getAll('dept').filter((x) => x.length <= 80);
  const back = `/certificates/imports?type=${encodeURIComponent(type)}`;
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      '/certificates/imports/sheet',
      {
        method: 'POST',
        body: JSON.stringify({
          typeCode: type,
          ...(depts.length
            ? {
                departments: depts.map((d) => (d === NO_DEPT ? '' : d)),
                staffState: sp.get('state') === 'left' ? 'left' : 'active',
              }
            : scope === 'leavers'
              ? { leavers: true }
              : { sectionIds: sections }),
        }),
      },
    );
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `attachment; filename="${f.filename.replace(/"/g, '')}"`,
      },
    });
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.redirect(
        new URL(
          `${back}&error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(error.problem.detail ?? '')}`,
          req.url,
        ),
        { status: 303 },
      );
    throw error;
  }
}
