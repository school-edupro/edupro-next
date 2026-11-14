'use server';
/** My tax in the staff app (docs/design/86, phase D): declare with proofs, withdraw, the earlier employer, the regime. */
import { ApiError } from '@edupro/bff';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { bff } from '@/lib/bff';

const API =
  process.env.INTERNAL_API_BASE_URL ?? process.env.API_BASE_URL ?? 'http://localhost:4000';
const okFy = (fy: string) => /^\d{4}-\d{2}$/.test(fy);
const okId = (id: string) => /^\d{1,18}$/.test(id);
const detailOf = (e: ApiError) => {
  const errs = e.problem.errors as Array<{ message?: string }> | Record<string, string> | undefined;
  const first = Array.isArray(errs)
    ? errs.map((x) => x.message).find(Boolean)
    : errs
      ? Object.values(errs)[0]
      : undefined;
  return (typeof e.problem.detail === 'string' ? e.problem.detail : '') || first || e.problem.type;
};
const text = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? '').trim();
  return v === '' ? null : v;
};
const amount = (fd: FormData, k: string) => text(fd, k)?.replace(/,/g, '') ?? null;
const go = (fy: string, q: string): never => {
  revalidatePath('/my-tax');
  redirect(`/my-tax?fy=${fy}&${q}&r=${Date.now().toString(36)}`);
};
async function attempt<T>(fy: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError)
      go(fy, `error=1&detail=${encodeURIComponent(detailOf(e).slice(0, 300))}`);
    throw e;
  }
}

/** Proofs: PDFs or photos (JPEG, PNG), 10 MB each, up to 5; uploaded through the file service. */
async function uploadProofs(fd: FormData): Promise<string[]> {
  const files = fd.getAll('proofs').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > 5)
    throw new ApiError(400, { type: 'validation-failed', detail: 'Attach up to 5 files.' });
  const ids: string[] = [];
  for (const file of files) {
    if (!/^(application\/pdf|image\/(png|jpeg))$/.test(file.type) || file.size > 10 * 1024 * 1024)
      throw new ApiError(400, {
        type: 'validation-failed',
        detail: `${file.name}: a PDF or a photo (JPEG, PNG) up to 10 MB`,
      });
    const reg = await bff.api.fetch<{
      file: { id: string };
      upload: { url: string; method: string; headers?: Record<string, string> };
    }>('/platform/files', {
      method: 'POST',
      body: JSON.stringify({
        fileName: file.name.slice(0, 200),
        contentType: file.type,
        sizeBytes: file.size,
        classification: 'internal',
      }),
    });
    const target = reg.upload.url.startsWith('http') ? reg.upload.url : `${API}${reg.upload.url}`;
    const headers = new Headers({ 'content-type': file.type });
    for (const [k, v] of Object.entries(reg.upload.headers ?? {})) headers.set(k, v);
    const put = await fetch(target, {
      method: reg.upload.method || 'PUT',
      headers,
      body: Buffer.from(await file.arrayBuffer()),
    });
    if (!put.ok)
      throw new ApiError(put.status, {
        type: 'file.upload_failed',
        detail: `${file.name} could not be uploaded.`,
      });
    ids.push(reg.file.id);
  }
  return ids;
}

export async function declareMine(fy: string, fd: FormData) {
  if (!okFy(fy)) return;
  const lineCode = String(fd.get('lineCode') ?? '');
  const y = Number(fy.slice(0, 4));
  const months: Array<{ month: string; rent: string }> = [];
  for (let k = 0; k < 12; k += 1) {
    const m = ((k + 3) % 12) + 1;
    const ym = `${String(k < 9 ? y : y + 1)}-${String(m).padStart(2, '0')}`;
    const rent = amount(fd, `rent.${ym}`);
    if (rent && Number(rent) > 0) months.push({ month: ym, rent });
  }
  const proofs = await attempt(fy, () => uploadProofs(fd));
  const r = await attempt(fy, () =>
    bff.api.fetch<{ message: string }>('/payroll/me/tax/declarations', {
      method: 'POST',
      body: JSON.stringify(
        lineCode === 'HRA_RENT'
          ? {
              fy,
              lineCode,
              proofFileIds: proofs,
              hra: {
                months,
                city: text(fd, 'city') ?? '',
                landlord: {
                  name: text(fd, 'landlordName') ?? '',
                  address: text(fd, 'landlordAddress') ?? '',
                  relation: text(fd, 'landlordRelation') ?? '',
                  ...(text(fd, 'landlordPan')
                    ? { pan: text(fd, 'landlordPan')!.toUpperCase() }
                    : {}),
                },
              },
            }
          : { fy, lineCode, amount: amount(fd, 'amount'), proofFileIds: proofs },
      ),
    }),
  );
  go(fy, `ok=1&detail=${encodeURIComponent(r.message)}`);
}

export async function withdrawMine(fy: string, id: string) {
  if (!okFy(fy) || !okId(id)) return;
  await attempt(fy, () =>
    bff.api.fetch(`/payroll/me/tax/declarations/${id}`, { method: 'DELETE' }),
  );
  go(fy, 'ok=1&detail=Withdrawn.');
}

export async function prevMine(fy: string, fd: FormData) {
  if (!okFy(fy)) return;
  const proofs = await attempt(fy, () => uploadProofs(fd));
  await attempt(fy, () =>
    bff.api.fetch('/payroll/me/tax/prev', {
      method: 'POST',
      body: JSON.stringify({
        fy,
        employerName: text(fd, 'employerName'),
        employerTan: text(fd, 'employerTan')?.toUpperCase() ?? null,
        gross: amount(fd, 'gross'),
        exempt: amount(fd, 'exempt') ?? '0',
        pf: amount(fd, 'pf') ?? '0',
        pt: amount(fd, 'pt') ?? '0',
        tds: amount(fd, 'tds') ?? '0',
        proofFileIds: proofs,
      }),
    }),
  );
  go(fy, `ok=1&detail=${encodeURIComponent('Saved: payroll verifies it.')}`);
}

export async function regimeMine(fy: string, fd: FormData) {
  if (!okFy(fy)) return;
  const r = await attempt(fy, () =>
    bff.api.fetch<{ message: string }>('/payroll/me/tax/regime', {
      method: 'POST',
      body: JSON.stringify({ fy, regime: text(fd, 'regime') }),
    }),
  );
  go(fy, `ok=1&detail=${encodeURIComponent(r.message)}`);
}
