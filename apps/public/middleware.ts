import { NextResponse, type NextRequest } from 'next/server';

/** The admission portal's shell marks the page it is on: the path travels as `x-pathname` (docs/design/42). */
export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set('x-pathname', req.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ['/:school/admission/:path*', '/:school/admission'] };
