import { NextResponse, type NextRequest } from 'next/server';
import { API, PublicApiError } from '@/lib/api';
import { admissionFetch } from '@/lib/admission';

/** One upload of the registration form: a slot owned by the application, then the bytes. */
export async function POST(req: NextRequest) {
  const fd = await req.formData().catch(() => null);
  const applicationId = String(fd?.get('applicationId') ?? '');
  const fieldKey = String(fd?.get('fieldKey') ?? '');
  const file = fd?.get('file');
  if (
    !/^\d{1,18}$/.test(applicationId) ||
    !/^[a-z][a-z0-9_]{0,39}$/.test(fieldKey) ||
    !(file instanceof File) ||
    file.size === 0
  )
    return NextResponse.json({ ok: false, error: 'Choose a file' }, { status: 400 });
  try {
    const slot = await admissionFetch<{
      file: { id: string };
      upload: { url: string; method?: string; headers?: Record<string, string> };
    }>('/me/files/slot', {
      method: 'POST',
      body: JSON.stringify({
        applicationId,
        fieldKey,
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
        { ok: false, error: `${file.name} did not upload; try again` },
        { status: 502 },
      );
    return NextResponse.json({
      ok: true,
      fileId: slot.file.id,
      name: file.name,
      contentType: file.type,
    });
  } catch (error) {
    if (error instanceof PublicApiError)
      return NextResponse.json(
        {
          ok: false,
          error:
            error.status === 401
              ? 'Your sign-in has ended: sign in again to go on.'
              : String(error.problem.detail ?? error.problem.type),
        },
        { status: error.status },
      );
    throw error;
  }
}
