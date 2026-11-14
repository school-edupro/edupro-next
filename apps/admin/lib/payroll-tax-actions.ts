'use server';
/** Income tax (docs/design/86, phase D): the forms of the tax centre and My tax, posted to the payroll API. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

const okId = (id: string) => /^\d{1,18}$/.test(id);
const okFy = (fy: string) => /^\d{4}-\d{2}$/.test(fy);
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
const join = (path: string) => (path.includes('?') ? '&' : '?');
const back = (path: string, e: ApiError): never =>
  redirect(
    `${path}${join(path)}error=${encodeURIComponent(e.problem.type ?? 'validation-failed')}&detail=${encodeURIComponent(detailOf(e).slice(0, 300))}`,
  );
const done = (path: string, detail: string): never => {
  revalidatePath('/payroll');
  redirect(
    `${path}${join(path)}ok=1&detail=${encodeURIComponent(detail)}&r=${Date.now().toString(36)}`,
  );
};
const text = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? '').trim();
  return v === '' ? null : v;
};
const amount = (fd: FormData, k: string) => text(fd, k)?.replace(/,/g, '') ?? null;
async function send<T = unknown>(path: string, method: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function attempt<T>(here: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError) back(here, e);
    throw e;
  }
}

/** PDFs and pictures of a form field, uploaded through the file service (10 MB each); their ids. */
async function uploadFiles(
  fd: FormData,
  field: string,
  max: number,
  pdfOnly = false,
): Promise<string[]> {
  const ids: string[] = [];
  const files = fd.getAll(field).filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > max)
    throw new ApiError(400, {
      type: 'validation-failed',
      detail: `Attach up to ${String(max)} files.`,
    });
  for (const entry of files) {
    const ok = pdfOnly
      ? entry.type === 'application/pdf'
      : /^(application\/pdf|image\/(png|jpeg))$/.test(entry.type);
    if (!ok || entry.size > 10 * 1024 * 1024)
      throw new ApiError(400, {
        type: 'validation-failed',
        detail: `${entry.name}: ${pdfOnly ? 'a PDF' : 'a PDF or a photo (JPEG, PNG)'} up to 10 MB`,
      });
    const reg = await apiFetch<{
      file: { id: string };
      upload: { url: string; method: string; headers?: Record<string, string> };
    }>('/platform/files', {
      method: 'POST',
      body: JSON.stringify({
        fileName: entry.name.slice(0, 200),
        contentType: entry.type,
        sizeBytes: entry.size,
        classification: 'internal',
      }),
    });
    const target = reg.upload.url.startsWith('http')
      ? reg.upload.url
      : `${process.env.API_BASE_URL ?? 'http://localhost:4000'}${reg.upload.url}`;
    const headers = new Headers({ 'content-type': entry.type });
    for (const [k, v] of Object.entries(reg.upload.headers ?? {})) headers.set(k, v);
    const put = await fetch(target, {
      method: reg.upload.method || 'PUT',
      headers,
      body: Buffer.from(await entry.arrayBuffer()),
    });
    if (!put.ok)
      throw new ApiError(put.status, {
        type: 'file.upload_failed',
        detail: `${entry.name} could not be uploaded`,
      });
    ids.push(reg.file.id);
  }
  return ids;
}

/** A declaration's body from the form: an amount, or (HRA) the rent of each month, the city and the landlord. */
function declaration(fy: string, fd: FormData) {
  const lineCode = String(fd.get('lineCode') ?? '');
  if (lineCode !== 'HRA_RENT') return { fy, lineCode, amount: amount(fd, 'amount') };
  const y = Number(fy.slice(0, 4));
  const months: Array<{ month: string; rent: string }> = [];
  for (let k = 0; k < 12; k += 1) {
    const m = ((k + 3) % 12) + 1;
    const ym = `${String(k < 9 ? y : y + 1)}-${String(m).padStart(2, '0')}`;
    const rent = amount(fd, `rent.${ym}`);
    if (rent && Number(rent) > 0) months.push({ month: ym, rent });
  }
  return {
    fy,
    lineCode,
    hra: {
      months,
      city: text(fd, 'city') ?? '',
      landlord: {
        name: text(fd, 'landlordName') ?? '',
        address: text(fd, 'landlordAddress') ?? '',
        relation: text(fd, 'landlordRelation') ?? '',
        ...(text(fd, 'landlordPan') ? { pan: text(fd, 'landlordPan')!.toUpperCase() } : {}),
      },
    },
  };
}

// ---- My tax ------------------------------------------------------------------------------------------------------
export async function declareMine(fy: string, fd: FormData) {
  if (!okFy(fy)) return;
  const here = `/payroll/me/tax?fy=${fy}`;
  const proofs = await attempt(here, () => uploadFiles(fd, 'proofs', 5));
  const r = await attempt(here, () =>
    send<{ message: string }>('/payroll/me/tax/declarations', 'POST', {
      ...declaration(fy, fd),
      proofFileIds: proofs,
    }),
  );
  done(here, r.message);
}

export async function withdrawMine(fy: string, id: string) {
  if (!okFy(fy) || !okId(id)) return;
  const here = `/payroll/me/tax?fy=${fy}`;
  await attempt(here, () => send(`/payroll/me/tax/declarations/${id}`, 'DELETE'));
  done(here, 'Withdrawn.');
}

function prevBody(fy: string, fd: FormData) {
  return {
    fy,
    employerName: text(fd, 'employerName'),
    employerTan: text(fd, 'employerTan')?.toUpperCase() ?? null,
    periodFrom: text(fd, 'periodFrom'),
    periodTo: text(fd, 'periodTo'),
    gross: amount(fd, 'gross'),
    exempt: amount(fd, 'exempt') ?? '0',
    pf: amount(fd, 'pf') ?? '0',
    pt: amount(fd, 'pt') ?? '0',
    tds: amount(fd, 'tds') ?? '0',
  };
}

export async function prevMine(fy: string, fd: FormData) {
  if (!okFy(fy)) return;
  const here = `/payroll/me/tax?fy=${fy}`;
  const proofs = await attempt(here, () => uploadFiles(fd, 'proofs', 3));
  await attempt(here, () =>
    send('/payroll/me/tax/prev', 'POST', { ...prevBody(fy, fd), proofFileIds: proofs }),
  );
  done(here, 'Saved: a payroll checker verifies it.');
}

export async function regimeMine(fy: string, fd: FormData) {
  if (!okFy(fy)) return;
  const here = `/payroll/me/tax?fy=${fy}`;
  const r = await attempt(here, () =>
    send<{ message: string }>('/payroll/me/tax/regime', 'POST', { fy, regime: text(fd, 'regime') }),
  );
  done(here, r.message);
}

// ---- the tax centre ----------------------------------------------------------------------------------------------
export async function declareFor(fy: string, fd: FormData) {
  if (!okFy(fy)) return;
  const here = `/payroll/tax?fy=${fy}&tab=declarations`;
  const proofs = await attempt(here, () => uploadFiles(fd, 'proofs', 5));
  const r = await attempt(here, () =>
    send<{ message: string }>('/payroll/tax/declarations', 'POST', {
      ...declaration(fy, fd),
      employeeId: text(fd, 'employeeId'),
      proofFileIds: proofs,
    }),
  );
  done(here, r.message);
}

export async function decideDeclaration(
  fy: string,
  id: string,
  action: 'verify' | 'reject' | 'reopen',
  fd: FormData,
) {
  if (!okFy(fy) || !okId(id)) return;
  const here = `/payroll/tax?fy=${fy}&tab=declarations`;
  await attempt(here, () =>
    send(`/payroll/tax/declarations/${id}/decide`, 'POST', {
      action,
      ...(action === 'verify' && amount(fd, 'verified')
        ? { verified: amount(fd, 'verified') }
        : {}),
      ...(action === 'reject' ? { reason: text(fd, 'reason') } : {}),
    }),
  );
  done(here, action === 'verify' ? 'Verified.' : action === 'reject' ? 'Rejected.' : 'Reopened.');
}

export async function prevFor(fy: string, fd: FormData) {
  if (!okFy(fy)) return;
  const here = `/payroll/tax?fy=${fy}&tab=prev`;
  await attempt(here, () =>
    send('/payroll/tax/prev', 'POST', {
      ...prevBody(fy, fd),
      employeeId: text(fd, 'employeeId'),
      proofFileIds: [],
    }),
  );
  done(here, 'Saved: another checker verifies it.');
}

export async function decidePrev(
  fy: string,
  id: string,
  action: 'verify' | 'reject' | 'reopen',
  fd: FormData,
) {
  if (!okFy(fy) || !okId(id)) return;
  const here = `/payroll/tax?fy=${fy}&tab=prev`;
  await attempt(here, () =>
    send(`/payroll/tax/prev/${id}/decide`, 'POST', {
      action,
      ...(action === 'reject' ? { reason: text(fd, 'reason') } : {}),
    }),
  );
  done(here, 'Done.');
}

export async function savePerq(fy: string, fd: FormData) {
  if (!okFy(fy)) return;
  const here = `/payroll/tax?fy=${fy}&tab=perquisites`;
  const r = await attempt(here, () =>
    send<{ message: string }>('/payroll/tax/perquisites', 'POST', {
      fy,
      employeeId: text(fd, 'employeeId'),
      perqType: text(fd, 'perqType'),
      amount: amount(fd, 'amount'),
      description: text(fd, 'description'),
    }),
  );
  done(here, r.message);
}

export async function perqAction(fy: string, id: string, action: 'verify' | 'unverify' | 'delete') {
  if (!okFy(fy) || !okId(id)) return;
  const here = `/payroll/tax?fy=${fy}&tab=perquisites`;
  await attempt(here, () => send(`/payroll/tax/perquisites/${id}/${action}`, 'POST'));
  done(
    here,
    action === 'delete'
      ? 'Removed.'
      : action === 'verify'
        ? 'Verified: it now counts in the tax.'
        : 'Unverified.',
  );
}

export async function setFinal(fy: string, employeeId: string, fd: FormData) {
  if (!okFy(fy) || !okId(employeeId)) return;
  const here = `/payroll/tax/employees/${employeeId}?fy=${fy}`;
  const spread = text(fd, 'spreadMonths');
  const r = await attempt(here, () =>
    send<{ message: string }>('/payroll/tax/finals', 'POST', {
      fy,
      employeeId,
      annual: amount(fd, 'annual'),
      spreadMonths: spread ? Number(spread) : null,
      reason: text(fd, 'reason'),
    }),
  );
  done(here, r.message);
}

export async function clearFinal(fy: string, employeeId: string) {
  if (!okFy(fy) || !okId(employeeId)) return;
  const here = `/payroll/tax/employees/${employeeId}?fy=${fy}`;
  await attempt(here, () => send('/payroll/tax/finals/clear', 'POST', { fy, employeeId }));
  done(here, 'The worked-out figure applies again from the next run.');
}

export async function regimeFor(fy: string, employeeId: string, fd: FormData) {
  if (!okFy(fy) || !okId(employeeId)) return;
  const here = `/payroll/tax/employees/${employeeId}?fy=${fy}`;
  const r = await attempt(here, () =>
    send<{ message: string }>('/payroll/tax/regime', 'POST', {
      fy,
      employeeId,
      regime: text(fd, 'regime'),
      reason: text(fd, 'reason') ?? undefined,
    }),
  );
  done(here, r.message);
}

export async function addChallan(fy: string, fd: FormData) {
  if (!okFy(fy)) return;
  const here = `/payroll/tax?fy=${fy}&tab=challans`;
  const r = await attempt(here, () =>
    send<{ message: string }>('/payroll/tax/challans', 'POST', {
      fy,
      quarter: Number(text(fd, 'quarter')),
      bsrCode: text(fd, 'bsrCode'),
      challanNo: text(fd, 'challanNo'),
      depositedOn: text(fd, 'depositedOn'),
      amount: amount(fd, 'amount'),
      interest: amount(fd, 'interest') ?? '0',
      lateFee: amount(fd, 'lateFee') ?? '0',
      months: fd
        .getAll('months')
        .map(Number)
        .filter((m) => m >= 1 && m <= 12),
    }),
  );
  done(here, r.message);
}

export async function removeChallan(fy: string, id: string, fd: FormData) {
  if (!okFy(fy) || !okId(id)) return;
  const here = `/payroll/tax?fy=${fy}&tab=challans`;
  await attempt(here, () =>
    send(`/payroll/tax/challans/${id}/remove`, 'POST', { reason: text(fd, 'reason') }),
  );
  done(here, 'Removed.');
}

export async function saveTaxYear(fy: string, fd: FormData) {
  if (!okFy(fy)) return;
  const here = `/payroll/tax?fy=${fy}&tab=year`;
  await attempt(here, () =>
    send(`/payroll/tax/years/${fy}`, 'PUT', {
      declareFrom: text(fd, 'declareFrom'),
      declareTo: text(fd, 'declareTo'),
      proofDue: text(fd, 'proofDue'),
      listedCities: String(fd.get('listedCities') ?? '')
        .split(/[,\n]/)
        .map((x) => x.trim())
        .filter(Boolean),
    }),
  );
  done(here, 'Saved.');
}

export async function freezeYear(fy: string) {
  if (!okFy(fy)) return;
  const here = `/payroll/tax?fy=${fy}&tab=year`;
  await attempt(here, () => send(`/payroll/tax/years/${fy}/freeze`, 'POST'));
  done(here, `${fy} is closed.`);
}

export async function panCheck(fy: string) {
  if (!okFy(fy)) return;
  const here = `/payroll/tax?fy=${fy}&tab=year`;
  const r = await attempt(here, () =>
    send<{ message: string; rows: Array<{ code: string; status: string }> }>(
      '/payroll/tax/pan-check',
      'GET',
    ),
  );
  done(
    here,
    `${r.message}${
      r.rows.length
        ? ` ${r.rows
            .slice(0, 15)
            .map((x) => `${x.code} (${x.status.toLowerCase()})`)
            .join(', ')}`
        : ''
    }`,
  );
}

export async function partA(fy: string, fd: FormData) {
  if (!okFy(fy)) return;
  const here = `/payroll/tax?fy=${fy}&tab=certificates`;
  const ids = await attempt(here, () => uploadFiles(fd, 'files', 500, true));
  if (!ids.length) done(here, 'Choose the Part A PDFs first.');
  const r = await attempt(here, () =>
    send<{ matched: string[]; unmatched: string[] }>('/payroll/tax/certificates/part-a', 'POST', {
      fy,
      fileIds: ids,
    }),
  );
  done(
    here,
    `${String(r.matched.length)} Part A file(s) matched by PAN.${r.unmatched.length ? ` Not matched: ${r.unmatched.slice(0, 10).join(', ')}.` : ''}`,
  );
}

export async function certificateStep(fy: string, step: 'make' | 'release' | 'send') {
  if (!okFy(fy)) return;
  const here = `/payroll/tax?fy=${fy}&tab=certificates`;
  const r = await attempt(here, () =>
    send<{ message?: string; released?: number; queued?: number; noEmail?: string[] }>(
      `/payroll/tax/certificates/${step}`,
      'POST',
      { fy },
    ),
  );
  done(
    here,
    r.message ??
      (step === 'release'
        ? `${String(r.released ?? 0)} released in My tax.`
        : `${String(r.queued ?? 0)} queued to e-mail.${r.noEmail?.length ? ` No e-mail address: ${r.noEmail.slice(0, 10).join(', ')}.` : ''}`),
  );
}
