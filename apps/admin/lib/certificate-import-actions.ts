'use server';
/** Certificates from an Excel sheet (docs/design/87, 17 Nov 2026): upload, upload again, check, start withdrawals, issue. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import type { CertificateImport } from './certificates';

const okId = (id: string) => /^\d{1,18}$/.test(id);
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const detailOf = (e: ApiError) => {
  const errors = e.problem.errors as
    Record<string, string> | Array<{ message?: string }> | undefined;
  const first = Array.isArray(errors)
    ? errors.map((x) => x.message).find(Boolean)
    : errors
      ? Object.values(errors)[0]
      : undefined;
  return e.problem.detail ?? first ?? e.problem.type;
};
const back = (path: string, error: unknown): never => {
  if (error instanceof ApiError)
    redirect(
      `${path}${path.includes('?') ? '&' : '?'}error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detailOf(error).slice(0, 300))}`,
    );
  throw error;
};
const done = (path: string, said: string): never =>
  redirect(`${path}${path.includes('?') ? '&' : '?'}ok=1&detail=${encodeURIComponent(said)}`);

/** The file of a form as the API takes it (name and base64), or a refusal. */
async function fileOf(fd: FormData) {
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0)
    throw new ApiError(400, {
      type: 'validation-failed',
      detail: 'Choose the filled sheet (.xlsx).',
    });
  if (file.size > 700_000)
    throw new ApiError(400, {
      type: 'validation-failed',
      detail: 'The file is larger than 700 KB: upload fewer rows at a time.',
    });
  return {
    fileName: file.name.slice(0, 200) || 'sheet.xlsx',
    fileBase64: Buffer.from(await file.arrayBuffer()).toString('base64'),
  };
}

/** A filled sheet uploaded: each row checked; the upload opens. */
export async function uploadCertificateSheet(fd: FormData) {
  const type = str(fd, 'type');
  const here = `/certificates/imports${type ? `?type=${encodeURIComponent(type)}` : ''}`;
  let id = '';
  try {
    const f = await fileOf(fd);
    const sections = fd.getAll('section').map(String).filter(okId);
    const r = await apiFetch<CertificateImport>('/certificates/imports', {
      method: 'POST',
      body: JSON.stringify({
        typeCode: type,
        title: str(fd, 'title') || undefined,
        ...(sections.length ? { scope: { sectionIds: sections } } : {}),
        ...f,
      }),
    });
    id = r.id;
  } catch (e) {
    back(here, e);
  }
  revalidatePath('/certificates/imports');
  redirect(`/certificates/imports/${id}`);
}

/** A corrected sheet into the same upload. */
export async function reuploadCertificateSheet(fd: FormData) {
  const id = str(fd, 'id');
  if (!okId(id)) return;
  const here = `/certificates/imports/${id}`;
  let r: CertificateImport | null = null;
  try {
    r = await apiFetch<CertificateImport>(`/certificates/imports/${id}/upload`, {
      method: 'POST',
      body: JSON.stringify(await fileOf(fd)),
    });
  } catch (e) {
    back(here, e);
  }
  revalidatePath(here);
  done(
    here,
    `Uploaded again: ${String(r!.figures.ready)} ready, ${String(r!.figures.attention)} need attention.`,
  );
}

/** Every row not issued checked again. */
export async function verifyCertificateImport(fd: FormData) {
  const id = str(fd, 'id');
  if (!okId(id)) return;
  const here = `/certificates/imports/${id}`;
  let r: CertificateImport | null = null;
  try {
    r = await apiFetch<CertificateImport>(`/certificates/imports/${id}/verify`, { method: 'POST' });
  } catch (e) {
    back(here, e);
  }
  revalidatePath(here);
  done(
    here,
    `Checked again: ${String(r!.figures.ready)} ready, ${String(r!.figures.attention)} need attention.`,
  );
}

/** The rows that are ready, issued in one run; the run's page opens with its PDFs. */
export async function issueCertificateImport(fd: FormData) {
  const id = str(fd, 'id');
  if (!okId(id)) return;
  const here = `/certificates/imports/${id}`;
  let r: { runId: string | null; upload: CertificateImport } | null = null;
  try {
    r = await apiFetch<{ runId: string | null; upload: CertificateImport }>(
      `/certificates/imports/${id}/issue`,
      { method: 'POST' },
    );
  } catch (e) {
    back(here, e);
  }
  revalidatePath(here);
  revalidatePath('/certificates');
  done(
    here,
    r!.runId
      ? `Issued ${String(r!.upload.figures.issued)} in all. Their PDFs: see the run below.`
      : 'Nothing was issued: see what to fix.',
  );
}

/**
 * The withdrawals started for the rows whose students have none (People → Withdrawals, in bulk, one leaving date and
 * reason); the departments clear them as usual, then the rows are checked again.
 */
export async function startImportWithdrawals(fd: FormData) {
  const id = str(fd, 'id');
  if (!okId(id)) return;
  const here = `/certificates/imports/${id}`;
  let started = 0;
  let failed = 0;
  try {
    const u = await apiFetch<CertificateImport>(`/certificates/imports/${id}`);
    const studentIds = [
      ...new Set(
        u.rows
          .filter((r) => r.status === 'attention' && r.startWithdrawal && r.personId)
          .map((r) => r.personId!),
      ),
    ];
    if (!studentIds.length)
      throw new ApiError(400, { type: 'validation-failed', detail: 'No row needs a withdrawal.' });
    const r = await apiFetch<{ started: number; failed: number }>('/people/withdrawals/bulk', {
      method: 'POST',
      body: JSON.stringify({
        studentIds,
        leavingOn: str(fd, 'leavingOn'),
        reason: str(fd, 'reason'),
      }),
    });
    started = r.started;
    failed = r.failed;
    await apiFetch(`/certificates/imports/${id}/verify`, { method: 'POST' });
  } catch (e) {
    back(here, e);
  }
  revalidatePath(here);
  done(
    here,
    `Withdrawals started for ${String(started)}${failed ? ` (${String(failed)} could not be started)` : ''}. The departments clear them; then press Check again.`,
  );
}
