'use server';
/** Staff leave and attendance set-up (docs/design/85): who approves and the settings. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import type { ApplyResult } from './leave';
import type { ApprovalLevel } from './recruitment';

const okId = (id: string) => /^\d{1,18}$/.test(id);
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
const back = (path: string, error: ApiError): never =>
  redirect(
    `${path}${path.includes('?') ? '&' : '?'}error=validation-failed&detail=${encodeURIComponent(detailOf(error).slice(0, 300))}`,
  );

const ruleBody = (fd: FormData) => ({
  kind: fd.get('kind') === 'regularisation' ? 'regularisation' : 'leave',
  name: String(fd.get('name') ?? '').trim(),
  scope: String(fd.get('scope') ?? 'all'),
  scopeValues: fd
    .getAll('scopeValues')
    .map((v) => String(v).trim())
    .filter(Boolean),
  leaveTypeId: okId(String(fd.get('leaveTypeId') ?? '')) ? String(fd.get('leaveTypeId')) : null,
  priority: Math.min(9999, Math.max(1, Number(fd.get('priority') ?? 100) || 100)),
});

/** A new rule: its staff and leave type first; the levels of each day band next, on its page. */
export async function createApprovalRule(fd: FormData) {
  let id = '';
  try {
    id = (
      await apiFetch<{ id: string }>('/leave/setup/approvals', {
        method: 'POST',
        body: JSON.stringify(ruleBody(fd)),
      })
    ).id;
  } catch (e) {
    if (e instanceof ApiError) back('/leave/setup/approvals', e);
    throw e;
  }
  revalidatePath('/leave/setup');
  redirect(
    `/leave/setup/approvals/${id}?ok=1&detail=${encodeURIComponent('Rule added: now set who approves in each day band.')}`,
  );
}

export async function updateApprovalRule(id: string, fd: FormData) {
  if (!okId(id)) return;
  try {
    await apiFetch(`/leave/setup/approvals/${id}`, {
      method: 'PUT',
      body: JSON.stringify(ruleBody(fd)),
    });
  } catch (e) {
    if (e instanceof ApiError) back(`/leave/setup/approvals/${id}`, e);
    throw e;
  }
  revalidatePath('/leave/setup/approvals');
  redirect(`/leave/setup/approvals/${id}?ok=1`);
}

export async function setApprovalRuleStatus(id: string, status: 'active' | 'inactive') {
  if (!okId(id)) return;
  try {
    await apiFetch(`/leave/setup/approvals/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
  } catch (e) {
    if (e instanceof ApiError) back(`/leave/setup/approvals/${id}`, e);
    throw e;
  }
  revalidatePath('/leave/setup/approvals');
  redirect(
    `/leave/setup/approvals/${id}?ok=1&detail=${encodeURIComponent(status === 'active' ? 'Switched on.' : 'Switched off: it no longer decides who approves.')}`,
  );
}

/** The levels of one day band (the shared levels editor calls this). */
export async function saveApprovalBand(
  id: string,
  band: number,
  levels: ApprovalLevel[],
): Promise<{ ok: true; moved: number; approved: number } | { ok: false; error: string }> {
  if (!okId(id)) return { ok: false, error: 'No such rule' };
  try {
    const r = await apiFetch<{ moved: number; approved: number }>(
      `/leave/setup/approvals/${id}/bands/${String(band)}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          levels: levels.map((l) => ({
            name: l.name.trim(),
            by: l.by,
            employeeIds: l.by === 'employees' ? l.employeeIds : [],
            ...(l.by === 'designation' && l.designation ? { designation: l.designation } : {}),
            ...(l.by === 'role' && l.roleCode ? { roleCode: l.roleCode } : {}),
            slaHours: l.slaHours,
          })),
        }),
      },
    );
    revalidatePath('/leave/setup/approvals');
    revalidatePath('/leave/setup');
    return { ok: true, ...r };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: detailOf(e) };
    throw e;
  }
}

const int = (fd: FormData, k: string, d: number) => {
  const v = Number(fd.get(k));
  return Number.isFinite(v) && String(fd.get(k) ?? '').trim() !== '' ? Math.round(v) : d;
};
const day = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
};

export async function saveLeaveSettings(fd: FormData) {
  const backdate = String(fd.get('backdateDays') ?? '').trim();
  const shift = String(fd.get('defaultShiftId') ?? '');
  try {
    await apiFetch('/leave/setup/settings', {
      method: 'PUT',
      body: JSON.stringify({
        lateMarksPerLeave: int(fd, 'lateMarksPerLeave', 3),
        missingPunchesPerLeave: int(fd, 'missingPunchesPerLeave', 4),
        lopAfterDays: int(fd, 'lopAfterDays', 7),
        punchGapMinutes: int(fd, 'punchGapMinutes', 10),
        recheckDays: int(fd, 'recheckDays', 10),
        absentLookbackDays: int(fd, 'absentLookbackDays', 31),
        exceptionsFrom: day(fd, 'exceptionsFrom'),
        defaultShiftId: okId(shift) ? shift : null,
        lateReducesHours: fd.get('lateReducesHours') === 'on',
        allowTimeEdit: fd.get('allowTimeEdit') === 'on',
        allowOnBehalf: fd.get('allowOnBehalf') === 'on',
        backdateDays: backdate === '' ? null : int(fd, 'backdateDays', 0),
        missingPunchCc: String(fd.get('missingPunchCc') ?? '').trim() || null,
        deviceSerials: String(fd.get('deviceSerials') ?? '')
          .split(/[\s,]+/)
          .map((x) => x.trim())
          .filter(Boolean),
        sendEmail: fd.get('sendEmail') === 'on',
        sendWhatsapp: fd.get('sendWhatsapp') === 'on',
        sendApp: fd.get('sendApp') === 'on',
        sendSms: fd.get('sendSms') === 'on',
      }),
    });
  } catch (e) {
    if (e instanceof ApiError) back('/leave/setup/settings', e);
    throw e;
  }
  revalidatePath('/leave/setup');
  redirect('/leave/setup/settings?ok=1');
}

// ---- phase B: applying, deciding, cancelling, balances -------------------------------------------------

/** A document (PDF or photo, up to 5 MB) uploaded through the file service; its id. */
async function uploadDocument(entry: FormDataEntryValue | null): Promise<string | null> {
  if (!(entry instanceof File) || entry.size === 0) return null;
  if (!/^(application\/pdf|image\/(png|jpeg|webp))$/.test(entry.type) || entry.size > 5_242_880)
    throw new ApiError(400, {
      type: 'validation-failed',
      detail: `${entry.name}: a PDF or a photo (JPEG, PNG) up to 5 MB`,
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
      classification: 'personal',
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

/**
 * Apply (for myself, or the office for an employee): the answer is the leave made, or a question to
 * confirm (the sandwich across two leaves, the paid part + loss of pay) — sent again with it accepted.
 */
export async function applyLeave(fd: FormData): Promise<ApplyResult> {
  try {
    const kept = String(fd.get('documentFileId') ?? '');
    const documentFileId = okId(kept) ? kept : await uploadDocument(fd.get('document'));
    const employeeId = String(fd.get('employeeId') ?? '');
    const halfDay = fd.get('halfDay') === 'on';
    const body = {
      leaveTypeId: String(fd.get('leaveTypeId') ?? ''),
      from: String(fd.get('from') ?? ''),
      to: halfDay ? String(fd.get('from') ?? '') : String(fd.get('to') ?? ''),
      halfDay,
      session: halfDay ? (fd.get('session') === 'second' ? 'second' : 'first') : null,
      reason: String(fd.get('reason') ?? '').trim(),
      documentFileId,
      bridgeOk: fd.get('bridgeOk') === '1',
      splitOk: fd.get('splitOk') === '1',
      ...(okId(employeeId) ? { employeeId } : {}),
    };
    const r = await apiFetch<
      | { confirm: { kind: 'bridge' | 'split'; message: string } }
      | Omit<Extract<ApplyResult, { ok: true }>, 'ok'>
    >(okId(employeeId) ? '/leave/on-behalf' : '/leave/apply', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if ('confirm' in r)
      return { ok: 'confirm', kind: r.confirm.kind, message: r.confirm.message, documentFileId };
    revalidatePath('/leave');
    revalidatePath('/leave/register');
    return { ok: true, ...r };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: detailOf(e) };
    throw e;
  }
}

const reqPath = (id: string) => `/leave/requests/${id}`;
const done = (id: string, detail: string): never =>
  redirect(`${reqPath(id)}?ok=1&detail=${encodeURIComponent(detail)}`);

async function act(id: string, path: string, body: unknown): Promise<void> {
  if (!okId(id)) return;
  try {
    await apiFetch(`${reqPath(id)}/${path}`, { method: 'POST', body: JSON.stringify(body) });
  } catch (e) {
    if (e instanceof ApiError) back(reqPath(id), e);
    throw e;
  }
  revalidatePath('/leave');
  revalidatePath('/leave/approvals');
  revalidatePath('/leave/register');
}

export async function decideLeave(id: string, fd: FormData) {
  const outcome = fd.get('outcome') === 'rejected' ? 'rejected' : 'approved';
  await act(id, 'decide', { outcome, note: String(fd.get('note') ?? '').trim() });
  done(id, outcome === 'approved' ? 'Approved.' : 'Not approved: the employee is told.');
}

export async function decideLeaveCancel(id: string, fd: FormData) {
  const outcome = fd.get('outcome') === 'rejected' ? 'rejected' : 'approved';
  await act(id, 'cancel-decide', { outcome, note: String(fd.get('note') ?? '').trim() });
  done(
    id,
    outcome === 'approved' ? 'The cancellation is approved.' : 'The cancellation is not approved.',
  );
}

export async function withdrawLeave(id: string, fd: FormData) {
  await act(id, 'withdraw', { reason: String(fd.get('reason') ?? '').trim() });
  done(id, 'Withdrawn: the days are given back.');
}

export async function askCancelLeave(id: string, fd: FormData) {
  await act(id, 'cancel-request', { reason: String(fd.get('reason') ?? '').trim() });
  done(id, 'The cancellation is sent to your approvers.');
}

export async function cancelLeave(id: string, fd: FormData) {
  await act(id, 'cancel', { reason: String(fd.get('reason') ?? '').trim() });
  done(id, 'Cancelled: the days are given back and the employee is told.');
}

export async function overrideLeave(id: string, fd: FormData) {
  const outcome = fd.get('outcome') === 'rejected' ? 'rejected' : 'approved';
  await act(id, 'override', { outcome, reason: String(fd.get('reason') ?? '').trim() });
  done(id, outcome === 'approved' ? 'Approved by the office.' : 'Not approved by the office.');
}

export async function trimLeave(id: string, fd: FormData) {
  await act(id, 'trim', {
    from: String(fd.get('from') ?? ''),
    to: String(fd.get('to') ?? ''),
    reason: String(fd.get('reason') ?? '').trim(),
  });
  done(id, 'The dates are changed: the days cut are given back.');
}

export async function adjustBalance(fd: FormData) {
  const back_ = String(fd.get('back') ?? '/leave/balances');
  const safe = back_.startsWith('/leave/balances') ? back_ : '/leave/balances';
  try {
    await apiFetch('/leave/balances/adjust', {
      method: 'POST',
      body: JSON.stringify({
        employeeId: String(fd.get('employeeId') ?? ''),
        leaveTypeId: String(fd.get('leaveTypeId') ?? ''),
        days: Number(fd.get('days')),
        reason: String(fd.get('reason') ?? '').trim(),
      }),
    });
  } catch (e) {
    if (e instanceof ApiError) back(safe, e);
    throw e;
  }
  revalidatePath('/leave/balances');
  redirect(
    `${safe}${safe.includes('?') ? '&' : '?'}ok=1&detail=${encodeURIComponent('Corrected.')}`,
  );
}

export async function runLeaveMonth() {
  let n = 0;
  try {
    n = (
      await apiFetch<{ rows: number }>('/leave/balances/run-month', { method: 'POST', body: '{}' })
    ).rows;
  } catch (e) {
    if (e instanceof ApiError) back('/leave/balances', e);
    throw e;
  }
  revalidatePath('/leave/balances');
  redirect(
    `/leave/balances?ok=1&detail=${encodeURIComponent(`Done: ${String(n)} balance rows closed, opened or credited.`)}`,
  );
}

export type BalanceImportResult =
  | {
      ok: true;
      rows: Array<{
        row: number;
        employee: string;
        type: string;
        balance: number | null;
        now: number | null;
        ok: boolean;
        error?: string;
      }>;
      saved: number;
    }
  | { ok: false; error: string };
export async function importBalances(file: string, dryRun: boolean): Promise<BalanceImportResult> {
  try {
    const r = await apiFetch<Omit<Extract<BalanceImportResult, { ok: true }>, 'ok'>>(
      '/leave/balances/import',
      { method: 'POST', body: JSON.stringify({ file, dryRun }) },
    );
    if (!dryRun) revalidatePath('/leave/balances');
    return { ok: true, ...r };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: detailOf(e) };
    throw e;
  }
}
