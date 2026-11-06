'use server';
/** Purchase, part 1 (docs/design/83): vendors, approvals, payment terms, settings, department approvals. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import type { ApprovalLevel } from './recruitment';

const pick = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const okId = (id: string) => /^\d{1,18}$/.test(id);
const detailOf = (e: ApiError) => {
  const errs = e.problem.errors as Array<{ path?: string; message?: string }> | undefined;
  if (Array.isArray(errs) && errs.length)
    return errs.map((x) => [x.path, x.message].filter(Boolean).join(': ')).join('; ');
  return typeof e.problem.detail === 'string' && e.problem.detail
    ? e.problem.detail
    : e.problem.type;
};
/** Back to a purchase page with what happened (only this app's purchase pages). */
function back(to: string, status: 'ok' | string, detail?: string): never {
  const url = new URL(to.startsWith('/purchase') ? to : '/purchase', 'http://edupro.local');
  for (const k of ['ok', 'error', 'detail']) url.searchParams.delete(k);
  url.searchParams.set(status === 'ok' ? 'ok' : 'error', status === 'ok' ? '1' : status);
  if (detail) url.searchParams.set('detail', detail.slice(0, 300));
  revalidatePath(url.pathname);
  redirect(`${url.pathname}${url.search}`);
}
async function run(to: string, fn: () => Promise<unknown>, done: string): Promise<never> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof ApiError) back(to, e.problem.type, detailOf(e));
    throw e;
  }
  back(to, 'ok', done);
}

// ---- vendors --------------------------------------------------------------------------------------
export type SaveResult =
  | { ok: true; id: string; changeWaiting?: boolean }
  | {
      ok: false;
      type: string;
      error: string;
      duplicates?: Array<{ code: string; name: string; field: string }>;
    };

/** A vendor added (it waits for approval) or changed; the form keeps what was typed on a refusal. */
export async function saveVendor(
  id: string | null,
  body: Record<string, unknown>,
): Promise<SaveResult> {
  try {
    const r = await apiFetch<{ id: string; changeWaiting?: boolean }>(
      id ? `/purchase/vendors/${id}` : '/purchase/vendors',
      { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) },
    );
    revalidatePath('/purchase/vendors');
    return { ok: true, id: r.id, changeWaiting: r.changeWaiting };
  } catch (e) {
    if (e instanceof ApiError)
      return {
        ok: false,
        type: e.problem.type,
        error: detailOf(e),
        duplicates: e.problem.duplicates as
          Array<{ code: string; name: string; field: string }> | undefined,
      };
    throw e;
  }
}

export async function decideVendor(fd: FormData) {
  const id = pick(fd, 'id');
  const approve = pick(fd, 'approve') === '1';
  const to = pick(fd, 'back') || '/purchase/vendor-approvals';
  if (!okId(id)) back(to, 'validation-failed', 'Unknown vendor');
  return run(
    to,
    () =>
      apiFetch(`/purchase/vendors/${id}/decide`, {
        method: 'POST',
        body: JSON.stringify({ approve, note: pick(fd, 'reason') || undefined }),
      }),
    approve ? 'Vendor approved: it can now be used' : 'Vendor rejected',
  );
}

export async function decideVendorChange(fd: FormData) {
  const id = pick(fd, 'id');
  const approve = pick(fd, 'approve') === '1';
  const to = pick(fd, 'back') || '/purchase/vendor-approvals';
  if (!okId(id)) back(to, 'validation-failed', 'Unknown change');
  return run(
    to,
    () =>
      apiFetch(`/purchase/vendor-changes/${id}/decide`, {
        method: 'POST',
        body: JSON.stringify({ approve, note: pick(fd, 'reason') || undefined }),
      }),
    approve ? 'Change approved: the new details are in force' : 'Change rejected',
  );
}

export async function withdrawVendorChange(fd: FormData) {
  const id = pick(fd, 'id');
  const to = pick(fd, 'back') || '/purchase/vendors';
  if (!okId(id)) back(to, 'validation-failed', 'Unknown change');
  return run(
    to,
    () => apiFetch(`/purchase/vendor-changes/${id}/withdraw`, { method: 'POST' }),
    'Change withdrawn',
  );
}

export async function setVendorStatus(fd: FormData) {
  const id = pick(fd, 'id');
  const status = pick(fd, 'status');
  const to = `/purchase/vendors/${id}`;
  if (!okId(id) || !['active', 'inactive', 'blacklisted'].includes(status))
    back('/purchase/vendors', 'validation-failed', 'Unknown vendor');
  return run(
    to,
    () =>
      apiFetch(`/purchase/vendors/${id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status, reason: pick(fd, 'reason') || undefined }),
      }),
    status === 'blacklisted'
      ? 'Vendor blacklisted: it is not offered on any PR or PO'
      : status === 'inactive'
        ? 'Vendor made inactive'
        : 'Vendor active again',
  );
}

/** A PDF or photo uploaded through the file service; its id. */
async function uploadOne(entry: File): Promise<string> {
  if (!/^(application\/pdf|image\/(png|jpeg|webp))$/.test(entry.type) || entry.size > 5_242_880)
    throw new ApiError(400, {
      type: 'validation-failed',
      detail: 'A PDF or a photo (JPEG, PNG) up to 5 MB',
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
  if (!put.ok) throw new ApiError(put.status, { type: 'file.upload_failed' });
  return reg.file.id;
}

export async function addVendorDocument(fd: FormData) {
  const id = pick(fd, 'id');
  const kind = pick(fd, 'kind');
  const file = fd.get('file');
  const to = `/purchase/vendors/${id}`;
  if (!okId(id)) back('/purchase/vendors', 'validation-failed', 'Unknown vendor');
  if (!(file instanceof File) || file.size === 0) back(to, 'validation-failed', 'Choose the file');
  return run(
    to,
    async () =>
      apiFetch(`/purchase/vendors/${id}/documents`, {
        method: 'POST',
        body: JSON.stringify({ kind, fileId: await uploadOne(file) }),
      }),
    'Document added',
  );
}

export async function removeVendorDocument(fd: FormData) {
  const id = pick(fd, 'id');
  const docId = pick(fd, 'docId');
  const to = `/purchase/vendors/${id}`;
  if (!okId(id) || !okId(docId)) back('/purchase/vendors', 'validation-failed', 'Unknown document');
  return run(
    to,
    () => apiFetch(`/purchase/vendors/${id}/documents/${docId}`, { method: 'DELETE' }),
    'Document removed',
  );
}

export type ImportResult =
  | {
      ok: true;
      dryRun: boolean;
      rows: number;
      good: number;
      saved: number;
      results: Array<{ row: number; code: string; ok: boolean; error?: string }>;
    }
  | { ok: false; error: string };

export async function importVendors(file: string, dryRun: boolean): Promise<ImportResult> {
  try {
    const r = await apiFetch<Omit<Extract<ImportResult, { ok: true }>, 'ok'>>(
      '/purchase/vendors/import',
      { method: 'POST', body: JSON.stringify({ file, dryRun }) },
    );
    if (!dryRun) revalidatePath('/purchase/vendors');
    return { ok: true, ...r };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: detailOf(e) };
    throw e;
  }
}

// ---- payment terms --------------------------------------------------------------------------------
export async function savePaymentTerm(
  id: string | null,
  body: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await apiFetch(id ? `/purchase/payment-terms/${id}` : '/purchase/payment-terms', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(body),
    });
    revalidatePath('/purchase/payment-terms');
    return { ok: true };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: detailOf(e) };
    throw e;
  }
}

// ---- settings and committee -----------------------------------------------------------------------
const num = (fd: FormData, k: string) => Number(pick(fd, k).replace(/,/g, ''));

export async function savePurchaseSettings(fd: FormData) {
  const to = '/purchase/settings';
  const sig = pick(fd, 'committeeSignatures');
  const alert = pick(fd, 'largePoAlert');
  return run(
    to,
    () =>
      apiFetch('/purchase/settings', {
        method: 'PUT',
        body: JSON.stringify({
          gstin: pick(fd, 'gstin') || null,
          billingAddress: pick(fd, 'billingAddress') || null,
          deliveryAddress: pick(fd, 'deliveryAddress') || null,
          piPrefix: pick(fd, 'piPrefix'),
          prPrefix: pick(fd, 'prPrefix'),
          poPrefix: pick(fd, 'poPrefix'),
          directLimit: num(fd, 'directLimit'),
          committeeLimit: num(fd, 'committeeLimit'),
          committeeQuotes: num(fd, 'committeeQuotes'),
          committeeSignatures: sig ? Number(sig) : null,
          emergencyEnabled: fd.get('emergencyEnabled') === 'on',
          emergencyRatifier: pick(fd, 'emergencyRatifier') || 'Principal',
          poTerms: pick(fd, 'poTerms') || null,
          poValidityDays: num(fd, 'poValidityDays'),
          purchaseDepartmentId: pick(fd, 'purchaseDepartmentId') || null,
          poSignatures: pick(fd, 'poSignatures')
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean),
          largePoAlert: alert ? Number(alert.replace(/,/g, '')) : null,
          splitWindowDays: num(fd, 'splitWindowDays'),
          stockGstInCost: fd.get('stockGstInCost') === 'on',
          receiptTolerancePct: num(fd, 'receiptTolerancePct') || 0,
        }),
      }),
    'Purchase settings saved',
  );
}

export async function addCommitteeMember(fd: FormData) {
  const employeeId = pick(fd, 'employeeId');
  if (!okId(employeeId)) back('/purchase/settings', 'validation-failed', 'Pick the employee');
  return run(
    '/purchase/settings',
    () =>
      apiFetch('/purchase/committee', {
        method: 'POST',
        body: JSON.stringify({ employeeId, role: pick(fd, 'role') || undefined }),
      }),
    'Added to the purchase committee',
  );
}

export async function removeCommitteeMember(fd: FormData) {
  const id = pick(fd, 'id');
  if (!okId(id)) back('/purchase/settings', 'validation-failed', 'Unknown member');
  return run(
    '/purchase/settings',
    () => apiFetch(`/purchase/committee/${id}`, { method: 'DELETE' }),
    'Taken off the purchase committee',
  );
}

// ---- who approves per department ------------------------------------------------------------------
export async function saveDepartmentLevels(
  departmentId: string,
  doc: string,
  levels: ApprovalLevel[],
): Promise<
  { ok: true; moved: number; approved: number; warnings?: string[] } | { ok: false; error: string }
> {
  try {
    const r = await apiFetch<{ warnings: string[] }>(`/purchase/approvals/${departmentId}/${doc}`, {
      method: 'PUT',
      body: JSON.stringify({
        levels: levels.map((l) => ({
          name: l.name.trim(),
          by: l.by,
          employeeIds: l.by === 'employees' ? l.employeeIds : [],
          ...(l.by === 'designation' && l.designation ? { designation: l.designation } : {}),
          slaHours: l.slaHours,
        })),
      }),
    });
    revalidatePath('/purchase/approvals');
    return { ok: true, moved: 0, approved: 0, warnings: r.warnings };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: detailOf(e) };
    throw e;
  }
}

export async function saveDepartmentRules(fd: FormData) {
  const id = pick(fd, 'departmentId');
  const to = `/purchase/approvals?department=${id}`;
  if (!okId(id)) back('/purchase/approvals', 'validation-failed', 'Pick the department');
  return run(
    to,
    () =>
      apiFetch(`/purchase/approvals/${id}/rules`, {
        method: 'PUT',
        body: JSON.stringify({
          bypassLimit: num(fd, 'bypassLimit') || 0,
          rateContractBypass: fd.get('rateContractBypass') === 'on',
        }),
      }),
    'Bypass rules saved',
  );
}

// ---- copy from another school ---------------------------------------------------------------------
export async function copyFromSchool(fd: FormData) {
  const schoolId = pick(fd, 'schoolId');
  const parts = fd.getAll('parts').map(String);
  if (!okId(schoolId) || !parts.length)
    back('/purchase', 'validation-failed', 'Pick the school and what to copy');
  let copied: Record<string, number> = {};
  try {
    copied = (
      await apiFetch<{ copied: Record<string, number> }>('/purchase/copy-from', {
        method: 'POST',
        body: JSON.stringify({ schoolId, parts }),
      })
    ).copied;
  } catch (e) {
    if (e instanceof ApiError) back('/purchase', e.problem.type, detailOf(e));
    throw e;
  }
  const words: Record<string, string> = {
    uoms: 'units',
    hsn: 'HSN / SAC codes',
    categories: 'categories',
    items: 'items',
    paymentTerms: 'payment terms',
    vendors: 'vendors (waiting for approval)',
  };
  const said = Object.entries(copied)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${String(n)} ${words[k] ?? k}`);
  back('/purchase', 'ok', said.length ? `Copied: ${said.join(', ')}` : 'Nothing new to copy');
}

// ---- part 2: the Purchase Indent ------------------------------------------------------------------
export type IndentSaveResult =
  | { ok: true; id: string; number?: string }
  /** id: a new PI saved as a draft although sending it failed */
  | { ok: false; error: string; id?: string };

/** A PI saved as a draft (or changed), and sent for approval when asked; the form keeps what was typed. */
export async function saveIndent(
  id: string | null,
  body: Record<string, unknown>,
  submit: boolean,
): Promise<IndentSaveResult> {
  if (id && !okId(id)) return { ok: false, error: 'Unknown indent' };
  let saved: string | null = id;
  try {
    const r = await apiFetch<{ id: string }>(id ? `/purchase/indents/${id}` : '/purchase/indents', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(body),
    });
    saved = r.id;
    revalidatePath('/purchase/indents');
    if (!submit) return { ok: true, id: r.id };
    const s = await apiFetch<{ id: string; number: string }>(`/purchase/indents/${r.id}/submit`, {
      method: 'POST',
    });
    return { ok: true, id: s.id, number: s.number };
  } catch (e) {
    if (e instanceof ApiError)
      return saved && !id
        ? { ok: false, id: saved, error: `Saved as a draft, not sent: ${detailOf(e)}` }
        : { ok: false, error: detailOf(e) };
    throw e;
  }
}

export async function submitIndent(fd: FormData) {
  const id = pick(fd, 'id');
  const to = `/purchase/indents/${id}`;
  if (!okId(id)) back('/purchase/indents', 'validation-failed', 'Unknown indent');
  return run(
    to,
    () => apiFetch(`/purchase/indents/${id}/submit`, { method: 'POST' }),
    'Sent for approval',
  );
}

export async function cancelIndent(fd: FormData) {
  const id = pick(fd, 'id');
  const to = `/purchase/indents/${id}`;
  if (!okId(id)) back('/purchase/indents', 'validation-failed', 'Unknown indent');
  return run(
    to,
    () =>
      apiFetch(`/purchase/indents/${id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: pick(fd, 'reason') }),
      }),
    'Indent withdrawn',
  );
}

export async function decideIndent(fd: FormData) {
  const id = pick(fd, 'id');
  const action = pick(fd, 'action');
  const to = `/purchase/indents/${id}`;
  if (!okId(id) || !['approve', 'reject', 'send_back'].includes(action))
    back('/purchase/indents', 'validation-failed', 'Unknown indent');
  return run(
    to,
    () =>
      apiFetch(`/purchase/indents/${id}/decide`, {
        method: 'POST',
        body: JSON.stringify({ action, note: pick(fd, 'reason') || undefined }),
      }),
    action === 'approve'
      ? 'Approved'
      : action === 'reject'
        ? 'Rejected: the raiser sees the reason'
        : 'Sent back to the raiser for changes',
  );
}

/** My PI, PR and PO approvals handed to a colleague for some days (the school admin: anyone's). */
export async function delegatePurchase(fd: FormData) {
  const to = '/purchase/delegations';
  const fromUserId = pick(fd, 'fromUserId');
  const toEmployeeId = pick(fd, 'toEmployeeId');
  if (!okId(toEmployeeId) || (fromUserId && !okId(fromUserId)))
    back(to, 'validation-failed', 'Pick the colleague');
  return run(
    to,
    () =>
      apiFetch('/purchase/delegations', {
        method: 'POST',
        body: JSON.stringify({
          fromUserId: fromUserId || undefined,
          toEmployeeId,
          startsOn: pick(fd, 'startsOn'),
          endsOn: pick(fd, 'endsOn'),
          reason: pick(fd, 'reason'),
        }),
      }),
    'Approvals handed over for those days',
  );
}

export async function revokePurchaseDelegation(fd: FormData) {
  const id = pick(fd, 'id');
  const to = '/purchase/delegations';
  if (!okId(id)) back(to, 'validation-failed', 'Unknown delegation');
  return run(
    to,
    () => apiFetch(`/purchase/delegations/${id}`, { method: 'DELETE' }),
    'Delegation ended',
  );
}

// ---- part 3: the Purchase Requisition -------------------------------------------------------------
const prPage = (id: string) => `/purchase/requisitions/${id}`;

/** Approved indents ticked on To requisition: one PR (their lines added up by item). */
export async function makeRequisition(fd: FormData) {
  const indentIds = fd.getAll('indentId').map(String).filter(okId);
  if (!indentIds.length) back('/purchase/to-requisition', 'validation-failed', 'Tick the indents');
  let made: { id: string; number: string } | null = null;
  try {
    made = await apiFetch<{ id: string; number: string }>('/purchase/requisitions', {
      method: 'POST',
      body: JSON.stringify({ indentIds }),
    });
  } catch (e) {
    if (e instanceof ApiError) back('/purchase/to-requisition', e.problem.type, detailOf(e));
    throw e;
  }
  revalidatePath('/purchase/to-requisition');
  back(prPage(made.id), 'ok', `${made.number} made from ${String(indentIds.length)} indent(s)`);
}

export async function closeIndent(fd: FormData) {
  const id = pick(fd, 'id');
  if (!okId(id)) back('/purchase/to-requisition', 'validation-failed', 'Unknown indent');
  return run(
    '/purchase/to-requisition',
    () =>
      apiFetch(`/purchase/indents/${id}/close`, {
        method: 'POST',
        body: JSON.stringify({ reason: pick(fd, 'reason') }),
      }),
    'Indent closed',
  );
}

export type RequisitionSaveResult = { ok: true; id: string } | { ok: false; error: string };

/** A direct PR made, or a PR's header and lines changed; the form keeps what was typed. */
export async function saveRequisition(
  id: string | null,
  body: Record<string, unknown>,
): Promise<RequisitionSaveResult> {
  if (id && !okId(id)) return { ok: false, error: 'Unknown requisition' };
  try {
    const r = await apiFetch<{ id: string }>(
      id ? `/purchase/requisitions/${id}` : '/purchase/requisitions',
      { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) },
    );
    revalidatePath('/purchase/requisitions');
    return { ok: true, id: r.id };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: detailOf(e) };
    throw e;
  }
}

const prAction =
  (path: string, method: string, done: string, body?: (fd: FormData) => unknown) =>
  async (fd: FormData) => {
    const id = pick(fd, 'id');
    if (!okId(id)) back('/purchase/requisitions', 'validation-failed', 'Unknown requisition');
    return run(
      prPage(id),
      () =>
        apiFetch(`/purchase/requisitions/${id}${path}`, {
          method,
          ...(body ? { body: JSON.stringify(body(fd)) } : {}),
        }),
      done,
    );
  };

export async function submitRequisition(fd: FormData) {
  return prAction('/submit', 'POST', 'Sent for approval')(fd);
}
export async function cancelRequisition(fd: FormData) {
  return prAction(
    '/cancel',
    'POST',
    'Requisition cancelled: its indents wait for a PR again',
    (f) => ({
      reason: pick(f, 'reason'),
    }),
  )(fd);
}
export async function reopenRequisition(fd: FormData) {
  return prAction('/reopen', 'POST', 'Reopened: change it and send it for approval again', (f) => ({
    reason: pick(f, 'reason'),
  }))(fd);
}
export async function decideRequisition(fd: FormData) {
  const action = pick(fd, 'action');
  if (!['approve', 'reject', 'send_back'].includes(action))
    back('/purchase/requisitions', 'validation-failed', 'Unknown decision');
  return prAction(
    '/decide',
    'POST',
    action === 'approve'
      ? 'Approved'
      : action === 'reject'
        ? 'Rejected: its indents wait for a PR again'
        : 'Sent back to the purchase office',
    (f) => ({ action, note: pick(f, 'reason') || undefined }),
  )(fd);
}
export async function signRequisition(fd: FormData) {
  return prAction('/sign', 'POST', 'You signed the comparative statement', (f) => ({
    note: pick(f, 'reason') || undefined,
  }))(fd);
}
export async function unsignRequisition(fd: FormData) {
  return prAction('/sign', 'DELETE', 'Your signature withdrawn')(fd);
}
export async function certifyRequisition(fd: FormData) {
  return prAction('/certificate', 'PUT', 'Certificate recorded', (f) => ({
    text: pick(f, 'text'),
  }))(fd);
}
export async function uncertifyRequisition(fd: FormData) {
  return prAction('/certificate', 'DELETE', 'Certificate removed')(fd);
}
export async function saveTender(fd: FormData) {
  return prAction('/tender', 'PUT', 'Tender reference saved', (f) => ({
    tenderRef: pick(f, 'tenderRef'),
    note: pick(f, 'note') || undefined,
  }))(fd);
}

export async function addRequisitionFile(fd: FormData) {
  const id = pick(fd, 'id');
  const file = fd.get('file');
  if (!okId(id)) back('/purchase/requisitions', 'validation-failed', 'Unknown requisition');
  if (!(file instanceof File) || !file.size)
    back(prPage(id), 'validation-failed', 'Choose the file');
  return run(
    prPage(id),
    async () =>
      apiFetch(`/purchase/requisitions/${id}/files`, {
        method: 'POST',
        body: JSON.stringify({ kind: 'tender', fileId: await uploadOne(file) }),
      }),
    'Document attached',
  );
}

export async function removeRequisitionFile(fd: FormData) {
  const id = pick(fd, 'id');
  const fileId = pick(fd, 'fileId');
  if (!okId(id) || !okId(fileId))
    back('/purchase/requisitions', 'validation-failed', 'Unknown file');
  return run(
    prPage(id),
    () => apiFetch(`/purchase/requisitions/${id}/files/${fileId}`, { method: 'DELETE' }),
    'Document removed',
  );
}

/** A vendor's quote: its details, the file, and a rate (and GST) per line it quoted. */
export async function saveQuote(fd: FormData) {
  const id = pick(fd, 'id');
  const quoteId = pick(fd, 'quoteId');
  if (!okId(id) || (quoteId && !okId(quoteId)))
    back('/purchase/requisitions', 'validation-failed', 'Unknown requisition');
  const to = `${prPage(id)}/quote${quoteId ? `?quoteId=${quoteId}` : ''}`;
  const lines = fd
    .getAll('lineId')
    .map(String)
    .filter(okId)
    .map((lineId) => ({
      lineId,
      rate: pick(fd, `rate_${lineId}`),
      gstRate: pick(fd, `gst_${lineId}`),
      note: pick(fd, `note_${lineId}`),
    }))
    .filter((l) => l.rate !== '')
    .map((l) => ({
      lineId: l.lineId,
      rate: l.rate,
      ...(l.gstRate !== '' ? { gstRate: l.gstRate } : {}),
      ...(l.note ? { note: l.note } : {}),
    }));
  const file = fd.get('file');
  try {
    const fileId = file instanceof File && file.size ? await uploadOne(file) : undefined;
    await apiFetch(`/purchase/requisitions/${id}/quotes${quoteId ? `/${quoteId}` : ''}`, {
      method: quoteId ? 'PUT' : 'POST',
      body: JSON.stringify({
        vendorId: pick(fd, 'vendorId'),
        quoteRef: pick(fd, 'quoteRef') || undefined,
        quoteDate: pick(fd, 'quoteDate') || undefined,
        validUntil: pick(fd, 'validUntil') || undefined,
        deliveryDays: pick(fd, 'deliveryDays') || undefined,
        note: pick(fd, 'note') || undefined,
        ...(fileId ? { fileId } : {}),
        lines,
      }),
    });
  } catch (e) {
    if (e instanceof ApiError) back(to, e.problem.type, detailOf(e));
    throw e;
  }
  back(prPage(id), 'ok', quoteId ? 'Quote changed' : 'Quote added');
}

export async function removeQuote(fd: FormData) {
  const id = pick(fd, 'id');
  const quoteId = pick(fd, 'quoteId');
  if (!okId(id) || !okId(quoteId))
    back('/purchase/requisitions', 'validation-failed', 'Unknown quote');
  return run(
    prPage(id),
    () => apiFetch(`/purchase/requisitions/${id}/quotes/${quoteId}`, { method: 'DELETE' }),
    'Quote removed: lines chosen from it lost their vendor',
  );
}

/** The vendor per line: one that quoted it takes its quoted rate; another needs the agreed rate. */
export async function saveChoices(fd: FormData) {
  const id = pick(fd, 'id');
  if (!okId(id)) back('/purchase/requisitions', 'validation-failed', 'Unknown requisition');
  const lines = fd
    .getAll('lineId')
    .map(String)
    .filter(okId)
    .map((lineId) => {
      const vendorId = pick(fd, `vendor_${lineId}`);
      const rate = pick(fd, `rate_${lineId}`);
      const reason = pick(fd, `reason_${lineId}`);
      return {
        lineId,
        vendorId: vendorId || null,
        ...(rate !== '' ? { rate } : {}),
        ...(reason ? { reason } : {}),
      };
    });
  return run(
    prPage(id),
    () =>
      apiFetch(`/purchase/requisitions/${id}/choices`, {
        method: 'PUT',
        body: JSON.stringify({ lines }),
      }),
    'Vendors saved',
  );
}

// ---- part 4: the Purchase Order -------------------------------------------------------------------
const poPage = (id: string) => `/purchase/orders/${id}`;

/** A draft PO for ticked lines of an approved requisition, to the vendor chosen (To order). */
export async function draftOrder(fd: FormData) {
  const requisitionId = pick(fd, 'requisitionId');
  const vendorId = pick(fd, 'vendorId');
  const lineIds = fd.getAll('lineId').map(String).filter(okId);
  if (!okId(requisitionId) || !okId(vendorId) || !lineIds.length)
    back('/purchase/to-order', 'validation-failed', 'Pick the vendor and tick the lines');
  let made: { id: string; number: string } | null = null;
  try {
    made = await apiFetch<{ id: string; number: string }>('/purchase/orders', {
      method: 'POST',
      body: JSON.stringify({ requisitionId, vendorId, lineIds }),
    });
  } catch (e) {
    if (e instanceof ApiError) back('/purchase/to-order', e.problem.type, detailOf(e));
    throw e;
  }
  back(poPage(made.id), 'ok', `${made.number} drafted: check it and send it for approval`);
}

export type OrderSaveResult = { ok: true; id: string } | { ok: false; error: string };

/** A draft PO's header, lines and charges saved (the GST and totals are worked out by the API). */
export async function saveOrder(
  id: string,
  body: Record<string, unknown>,
): Promise<OrderSaveResult> {
  if (!okId(id)) return { ok: false, error: 'Unknown purchase order' };
  try {
    await apiFetch(`/purchase/orders/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    revalidatePath(poPage(id));
    return { ok: true, id };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: detailOf(e) };
    throw e;
  }
}

const poAction =
  (
    path: string,
    done: string | ((r: Record<string, unknown>) => string),
    body?: (fd: FormData) => unknown,
  ) =>
  async (fd: FormData) => {
    const id = pick(fd, 'id');
    if (!okId(id)) back('/purchase/orders', 'validation-failed', 'Unknown purchase order');
    let r: Record<string, unknown> = {};
    try {
      r = await apiFetch<Record<string, unknown>>(`/purchase/orders/${id}${path}`, {
        method: 'POST',
        ...(body ? { body: JSON.stringify(body(fd)) } : {}),
      });
    } catch (e) {
      if (e instanceof ApiError) back(poPage(id), e.problem.type, detailOf(e));
      throw e;
    }
    // an amendment opens the new revision
    const to = typeof r.id === 'string' && r.id !== id && path === '/amend' ? r.id : id;
    back(poPage(to), 'ok', typeof done === 'string' ? done : done(r));
  };

export async function submitOrder(fd: FormData) {
  return poAction('/submit', 'Sent for approval')(fd);
}
export async function decideOrder(fd: FormData) {
  const action = pick(fd, 'action');
  if (!['approve', 'reject', 'send_back'].includes(action))
    back('/purchase/orders', 'validation-failed', 'Unknown decision');
  return poAction(
    '/decide',
    action === 'approve'
      ? 'Approved'
      : action === 'reject'
        ? 'Rejected'
        : 'Sent back to the purchase office',
    (f) => ({ action, note: pick(f, 'reason') || undefined }),
  )(fd);
}
export async function sendOrder(fd: FormData) {
  return poAction('/send', 'Queued to the vendor with the PDF attached', (f) => ({
    to: pick(f, 'to'),
  }))(fd);
}
export async function closeOrder(fd: FormData) {
  return poAction('/close', 'Closed', (f) => ({ reason: pick(f, 'reason') }))(fd);
}
export async function cancelOrder(fd: FormData) {
  return poAction('/cancel', 'Cancelled: its lines are to order again', (f) => ({
    reason: pick(f, 'reason'),
  }))(fd);
}
export async function amendOrder(fd: FormData) {
  return poAction('/amend', 'Amendment opened: change it and send it for approval', (f) => ({
    reason: pick(f, 'reason'),
  }))(fd);
}

/** An emergency purchase: the vendor, the lines, the vendor's bill (uploaded here) and the reason. */
export async function recordEmergency(fd: FormData) {
  const to = '/purchase/emergency';
  const bill = fd.get('bill');
  if (!(bill instanceof File) || !bill.size)
    back(to, 'validation-failed', "Attach the vendor's bill");
  const lines = [0, 1, 2, 3, 4, 5]
    .map((i) => ({
      item: pick(fd, `item_${String(i)}`),
      description: pick(fd, `desc_${String(i)}`),
      quantity: pick(fd, `qty_${String(i)}`),
      uomId: pick(fd, `uom_${String(i)}`),
      rate: pick(fd, `rate_${String(i)}`),
      gstRate: pick(fd, `gst_${String(i)}`),
    }))
    .filter((l) => (l.item || l.description) && l.quantity && l.rate)
    .map((l) => ({
      ...(l.item
        ? { itemId: l.item }
        : { description: l.description, uomId: l.uomId || undefined }),
      quantity: l.quantity,
      rate: l.rate,
      ...(l.gstRate !== '' ? { gstRate: l.gstRate } : {}),
    }));
  let made: { id: string; number: string } | null = null;
  try {
    const billFileId = await uploadOne(bill);
    made = await apiFetch<{ id: string; number: string }>('/purchase/emergency-purchases', {
      method: 'POST',
      body: JSON.stringify({
        vendorId: pick(fd, 'vendorId'),
        departmentId: pick(fd, 'departmentId') || undefined,
        reason: pick(fd, 'reason'),
        billRef: pick(fd, 'billRef') || undefined,
        poDate: pick(fd, 'poDate') || undefined,
        billFileId,
        lines,
      }),
    });
  } catch (e) {
    if (e instanceof ApiError) back(to, e.problem.type, detailOf(e));
    throw e;
  }
  back(poPage(made.id), 'ok', `${made.number} recorded: send it for ratification`);
}

// ---- phase 2, part 6: stores and stock ------------------------------------------------------------
export type StoreSaveResult = { ok: true; id: string } | { ok: false; error: string };

/** A sub-store added, or a store's details and keepers changed. */
export async function saveStore(
  id: string | null,
  body: Record<string, unknown>,
): Promise<StoreSaveResult> {
  if (id && !okId(id)) return { ok: false, error: 'Unknown store' };
  try {
    const r = await apiFetch<{ id: string }>(id ? `/purchase/stores/${id}` : '/purchase/stores', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(body),
    });
    revalidatePath('/purchase/stores');
    return { ok: true, id: r.id };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: detailOf(e) };
    throw e;
  }
}

/** The reorder level, reorder quantity and maximum of the items of a store (one form row each). */
export async function saveStoreLevels(fd: FormData) {
  const id = pick(fd, 'id');
  if (!okId(id)) back('/purchase/stores', 'validation-failed', 'Unknown store');
  const lines = fd
    .getAll('itemId')
    .map(String)
    .filter(okId)
    .map((itemId) => {
      const n = (k: string) => {
        const v = pick(fd, `${k}_${itemId}`);
        return v === '' ? null : v;
      };
      return {
        itemId,
        reorderLevel: n('level') ?? 0,
        reorderQty: n('qty'),
        maxQty: n('max'),
      };
    });
  // a new item's levels, from the last row
  const added = pick(fd, 'newItemId');
  if (okId(added) && !lines.some((l) => l.itemId === added))
    lines.push({
      itemId: added,
      reorderLevel: pick(fd, 'level_new') || 0,
      reorderQty: pick(fd, 'qty_new') || null,
      maxQty: pick(fd, 'max_new') || null,
    });
  return run(
    `/purchase/stores/${id}`,
    () =>
      apiFetch(`/purchase/stores/${id}/levels`, { method: 'PUT', body: JSON.stringify({ lines }) }),
    'Reorder levels saved',
  );
}

export type OpeningResult = { ok: true; posted: number } | { ok: false; error: string };

export async function postOpening(
  storeId: string,
  body: Record<string, unknown>,
): Promise<OpeningResult> {
  if (!okId(storeId)) return { ok: false, error: 'Unknown store' };
  try {
    const r = await apiFetch<{ posted: number }>(`/purchase/stores/${storeId}/opening`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    revalidatePath(`/purchase/stores/${storeId}`);
    return { ok: true, posted: r.posted };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: detailOf(e) };
    throw e;
  }
}

export type OpeningImportResult =
  | {
      ok: true;
      dryRun: boolean;
      good: number;
      bad: number;
      posted: number;
      rows: Array<{ row: number; code: string; ok: boolean; error?: string }>;
    }
  | { ok: false; error: string };

export async function importOpening(
  storeId: string,
  file: string,
  dryRun: boolean,
): Promise<OpeningImportResult> {
  if (!okId(storeId)) return { ok: false, error: 'Unknown store' };
  try {
    const r = await apiFetch<Omit<Extract<OpeningImportResult, { ok: true }>, 'ok'>>(
      `/purchase/stores/${storeId}/opening-import`,
      { method: 'POST', body: JSON.stringify({ file, dryRun }) },
    );
    if (!dryRun) revalidatePath(`/purchase/stores/${storeId}`);
    return { ok: true, ...r };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: detailOf(e) };
    throw e;
  }
}

// ---- phase 2, part 7: goods receipts and completion certificates ------------------------------------
export type ReceiptSaveResult =
  { ok: true; id: string; number: string } | { ok: false; error: string };

/**
 * What came against a PO (or the work done): the details and lines as JSON in `body`, the challan /
 * invoice photo or PDF in `file` (optional). The form keeps what was typed when it is refused.
 */
export async function recordReceipt(fd: FormData): Promise<ReceiptSaveResult> {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(String(fd.get('body') ?? '{}')) as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'The form could not be read' };
  }
  try {
    const file = fd.get('file');
    const fileId = file instanceof File && file.size ? await uploadOne(file) : undefined;
    const r = await apiFetch<{ id: string; number: string }>('/purchase/receipts', {
      method: 'POST',
      body: JSON.stringify({ ...body, ...(fileId ? { fileId } : {}) }),
    });
    revalidatePath('/purchase/receipts');
    if (typeof body.orderId === 'string') revalidatePath(poPage(body.orderId));
    return { ok: true, id: r.id, number: r.number };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: detailOf(e) };
    throw e;
  }
}

export type InspectResult = { ok: true; status: string } | { ok: false; error: string };

/** The inspector's decision: accept (line by line, rejecting some) or reject all with the reason. */
export async function inspectReceipt(
  id: string,
  body: Record<string, unknown>,
): Promise<InspectResult> {
  if (!okId(id)) return { ok: false, error: 'Unknown receipt' };
  try {
    const r = await apiFetch<{ status: string; orderId: string }>(
      `/purchase/receipts/${id}/inspect`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    );
    revalidatePath(`/purchase/receipts/${id}`);
    revalidatePath(poPage(r.orderId));
    return { ok: true, status: r.status };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: detailOf(e) };
    throw e;
  }
}

export async function cancelReceipt(fd: FormData) {
  const id = pick(fd, 'id');
  if (!okId(id)) back('/purchase/receipts', 'validation-failed', 'Unknown receipt');
  return run(
    `/purchase/receipts/${id}`,
    () =>
      apiFetch(`/purchase/receipts/${id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: pick(fd, 'reason') }),
      }),
    'Receipt cancelled: what it brought counts as still to come',
  );
}
