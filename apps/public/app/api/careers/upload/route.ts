import { NextResponse, type NextRequest } from 'next/server';
import { API, PublicApiError } from '@/lib/api';
import { careersFetch, type CareerMe } from '@/lib/careers';

/**
 * A document or photo of the careers form (docs/design/34-recruitment.md): an upload slot owned by the
 * candidate, the bytes, then the file becomes the document of that kind. A route rather than a server
 * action, which would refuse files over 1 MB; the API keeps the 5 MB limit and the types.
 */
export async function POST(req: NextRequest) {
  const fd = await req.formData().catch(() => null);
  const kind = String(fd?.get('kind') ?? '');
  const file = fd?.get('file');
  if (!/^[a-z_]{2,40}$/.test(kind) || !(file instanceof File) || file.size === 0)
    return NextResponse.json({ ok: false, errors: {}, problem: 'Choose a file' }, { status: 400 });
  try {
    const slot = await careersFetch<{
      file: { id: string };
      upload: { url: string; method?: string; headers?: Record<string, string> };
    }>('/me/files/slot', {
      method: 'POST',
      body: JSON.stringify({
        kind,
        fileName: file.name.slice(0, 200) || 'file',
        contentType: file.type,
        sizeBytes: file.size,
      }),
    });
    const target = slot.upload.url.startsWith('http')
      ? slot.upload.url
      : `${API}${slot.upload.url}`;
    const headers = new Headers({ 'content-type': file.type });
    for (const [k, v] of Object.entries(slot.upload.headers ?? {})) headers.set(k, v);
    const put = await fetch(target, {
      method: slot.upload.method || 'PUT',
      headers,
      body: Buffer.from(await file.arrayBuffer()),
    });
    if (!put.ok)
      return NextResponse.json(
        { ok: false, errors: {}, problem: `${file.name} did not upload; try again` },
        { status: 502 },
      );
    await careersFetch('/me/files', {
      method: 'POST',
      body: JSON.stringify({ kind, fileId: slot.file.id }),
    });
    return NextResponse.json({ ok: true, errors: {}, me: await careersFetch<CareerMe>('/me') });
  } catch (error) {
    if (error instanceof PublicApiError)
      return NextResponse.json(
        {
          ok: false,
          errors: {},
          problem:
            error.status === 401
              ? 'Your sign-in has ended: sign in again to go on.'
              : String(error.problem.detail ?? error.problem.type),
        },
        { status: error.status },
      );
    throw error;
  }
}
