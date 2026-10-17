import { NextResponse } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/**
 * The hostel files: the mess (the week's menu, the diet list and its upload format, the meal register, the
 * head count) and the visitors (the visit register, the approved lists).
 */
const KINDS: Record<string, { path: string; keys: string[] }> = {
  menu: { path: '/hostel/menu/file', keys: ['hostelId', 'weekOf'] },
  diets: { path: '/hostel/diets/file', keys: ['hostelId', 'diet', 'allergy', 'set', 'q'] },
  'diet-template': { path: '/hostel/diets/template', keys: ['hostelId'] },
  register: { path: '/hostel/meal-register/file', keys: ['hostelId', 'month'] },
  headcount: { path: '/hostel/headcount/file', keys: ['hostelId', 'on'] },
  visits: { path: '/hostel/visits/file', keys: ['hostelId', 'from', 'to', 'show', 'q'] },
  'visitor-list': { path: '/hostel/visitors/file', keys: ['hostelId'] },
  incidents: {
    path: '/hostel/incidents/file',
    keys: ['hostelId', 'category', 'severity', 'status', 'from', 'to', 'q'],
  },
};

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const kind = KINDS[sp.get('kind') ?? ''];
  if (!kind) return NextResponse.json({ type: 'not-found' }, { status: 404 });
  const qs = new URLSearchParams();
  if (sp.get('kind') !== 'diet-template')
    qs.set('format', sp.get('format') === 'pdf' ? 'pdf' : 'xlsx');
  for (const k of kind.keys) {
    const v = sp.get(k);
    if (v) qs.set(k, v.slice(0, 60));
  }
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `${kind.path}?${qs.toString()}`,
    );
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `attachment; filename="${f.filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.json({ type: error.problem.type }, { status: error.status });
    throw error;
  }
}
