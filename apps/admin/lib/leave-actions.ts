'use server';
/** Staff leave and attendance set-up (docs/design/85): who approves and the settings. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import type { ApplyResult, CorrectionsLog, ShiftAssignResult, ShiftCopyResult } from './leave';
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

/** A group rule one place up or down in the order the rules are checked. */
export async function moveApprovalRule(id: string, direction: 'up' | 'down') {
  if (!okId(id)) return;
  try {
    await apiFetch(`/leave/setup/approvals/${id}/move`, {
      method: 'POST',
      body: JSON.stringify({ direction }),
    });
  } catch (e) {
    if (e instanceof ApiError) back('/leave/setup/approvals/rules', e);
    throw e;
  }
  revalidatePath('/leave/setup/approvals/rules');
  redirect(`/leave/setup/approvals/rules?moved=${id}&r=${Date.now().toString(36)}`);
}

/** A new rule: who it is for and the leave type first (placed above “All staff”); its levels next, on its page. */
export async function createApprovalRule(fd: FormData) {
  let id = '';
  try {
    id = (
      await apiFetch<{ id: string }>('/leave/setup/approvals', {
        method: 'POST',
        body: JSON.stringify({ ...ruleBody(fd), place: 'auto' }),
      })
    ).id;
  } catch (e) {
    if (e instanceof ApiError) back('/leave/setup/approvals/rules', e);
    throw e;
  }
  revalidatePath('/leave/setup');
  redirect(
    `/leave/setup/approvals/${id}?ok=1&detail=${encodeURIComponent('Rule added just above “All staff” in Group rules (move it with ↑ ↓ there). Now set who approves below.')}`,
  );
}

/** An employee's own rule, from the by-employee view: the one they have, or a new one from their approvers now. */
export async function ownApprovalRule(fd: FormData) {
  const employeeId = String(fd.get('employeeId') ?? '');
  const kind = fd.get('kind') === 'regularisation' ? 'regularisation' : 'leave';
  const from = String(fd.get('back') ?? '/leave/setup/approvals');
  const path = /^\/leave\/setup\/approvals(\?|$)/.test(from) ? from : '/leave/setup/approvals';
  if (!okId(employeeId)) return;
  let r: { id: string; created: boolean } | null = null;
  try {
    r = await apiFetch<{ id: string; created: boolean }>('/leave/setup/approvals/own', {
      method: 'POST',
      body: JSON.stringify({ employeeId, kind }),
    });
  } catch (e) {
    if (e instanceof ApiError) back(path, e);
    throw e;
  }
  revalidatePath('/leave/setup');
  redirect(
    `/leave/setup/approvals/${r.id}${
      r.created
        ? `?ok=1&detail=${encodeURIComponent('Own rule made from the approvers the employee had: change any level below. It comes first for this employee (priority 1).')}`
        : ''
    }`,
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
            need: l.by === 'employees' || l.by === 'designation' ? (l.need ?? 'any') : 'any',
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
/** The list a row was acted on from (My leave's tabs, with their filters), to come back to; else none. */
const listOf = (fd: FormData) => {
  const b = String(fd.get('back') ?? '');
  return /^\/leave(\/register)?\?[\w=&%.+-]{1,500}$/.test(b) ? b : null;
};
const done = (id: string, detail: string, list?: string | null): never =>
  redirect(`${list ?? reqPath(id)}${list ? '&' : '?'}ok=1&detail=${encodeURIComponent(detail)}`);

async function act(id: string, path: string, body: unknown, list?: string | null): Promise<void> {
  if (!okId(id)) return;
  try {
    await apiFetch(`${reqPath(id)}/${path}`, { method: 'POST', body: JSON.stringify(body) });
  } catch (e) {
    if (e instanceof ApiError) back(list ?? reqPath(id), e);
    throw e;
  }
  revalidatePath('/leave');
  revalidatePath('/leave/approvals');
  revalidatePath('/leave/register');
}

export async function decideLeave(id: string, fd: FormData) {
  const outcome = fd.get('outcome') === 'rejected' ? 'rejected' : 'approved';
  const list = listOf(fd);
  await act(id, 'decide', { outcome, note: String(fd.get('note') ?? '').trim() }, list);
  done(id, outcome === 'approved' ? 'Approved.' : 'Not approved: the employee is told.', list);
}

export async function decideLeaveCancel(id: string, fd: FormData) {
  const outcome = fd.get('outcome') === 'rejected' ? 'rejected' : 'approved';
  const list = listOf(fd);
  await act(id, 'cancel-decide', { outcome, note: String(fd.get('note') ?? '').trim() }, list);
  done(
    id,
    outcome === 'approved' ? 'The cancellation is approved.' : 'The cancellation is not approved.',
    list,
  );
}

export async function withdrawLeave(id: string, fd: FormData) {
  const list = listOf(fd);
  await act(id, 'withdraw', { reason: String(fd.get('reason') ?? '').trim() }, list);
  done(id, 'Withdrawn: the days are given back.', list);
}

export async function askCancelLeave(id: string, fd: FormData) {
  const list = listOf(fd);
  await act(id, 'cancel-request', { reason: String(fd.get('reason') ?? '').trim() }, list);
  done(id, 'The cancellation is sent to your approvers.', list);
}

export async function cancelLeave(id: string, fd: FormData) {
  const list = listOf(fd);
  await act(id, 'cancel', { reason: String(fd.get('reason') ?? '').trim() }, list);
  done(id, 'Cancelled: the days are given back and the employee is told.', list);
}

export async function overrideLeave(id: string, fd: FormData) {
  const outcome = fd.get('outcome') === 'rejected' ? 'rejected' : 'approved';
  const list = listOf(fd);
  await act(id, 'override', { outcome, reason: String(fd.get('reason') ?? '').trim() }, list);
  done(
    id,
    outcome === 'approved' ? 'Approved by the office.' : 'Not approved by the office.',
    list,
  );
}

export async function trimLeave(id: string, fd: FormData) {
  const list = listOf(fd);
  await act(
    id,
    'trim',
    {
      from: String(fd.get('from') ?? ''),
      to: String(fd.get('to') ?? ''),
      reason: String(fd.get('reason') ?? '').trim(),
    },
    list,
  );
  done(id, 'The dates are changed: the days cut are given back.', list);
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

export type ApproversImportResult =
  | {
      ok: true;
      rows: Array<{
        row: number;
        employee: string;
        changes: string[];
        ok: boolean;
        error?: string;
      }>;
      saved: number;
    }
  | { ok: false; error: string };
/** Who approves, by employee, from Excel: check (dryRun), then save the rows that change. */
export async function importApprovers(
  file: string,
  dryRun: boolean,
): Promise<ApproversImportResult> {
  try {
    const r = await apiFetch<Omit<Extract<ApproversImportResult, { ok: true }>, 'ok'>>(
      '/leave/setup/approvals/import',
      { method: 'POST', body: JSON.stringify({ file, dryRun }) },
    );
    if (!dryRun) {
      revalidatePath('/leave/setup/approvals');
      revalidatePath('/leave/setup');
    }
    return { ok: true, ...r };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: detailOf(e) };
    throw e;
  }
}

// ---- phase C: staff attendance -------------------------------------------------------------------------
const attBack = (path: string) =>
  path.startsWith('/leave/attendance') || path.startsWith('/leave/setup/timings')
    ? path
    : '/leave/attendance';
async function attCall(back_: string, path: string, method: string, body: unknown, ok: string) {
  const safe = attBack(back_);
  try {
    await apiFetch(path, { method, body: JSON.stringify(body) });
  } catch (e) {
    if (e instanceof ApiError) back(safe, e);
    throw e;
  }
  revalidatePath('/leave/attendance');
  redirect(`${safe}${safe.includes('?') ? '&' : '?'}ok=1&detail=${encodeURIComponent(ok)}`);
}
const t = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? '').trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null;
};

export async function correctDay(fd: FormData) {
  const type = String(fd.get('dayType') ?? '');
  await attCall(
    String(fd.get('back') ?? ''),
    '/staff-attendance/days',
    'POST',
    {
      employeeId: String(fd.get('employeeId') ?? ''),
      day: String(fd.get('day') ?? ''),
      dayType: ['P', 'HD', 'A', 'WO', 'H', 'HOLD'].includes(type) ? type : null,
      in: t(fd, 'in'),
      out: t(fd, 'out'),
      reason: String(fd.get('reason') ?? '').trim(),
      confirmOff: fd.get('confirmOff') === '1',
    },
    'The day is corrected.',
  );
}

/** The corrections log for the register's dialog and its count panels (a read: nothing changes). */
export async function loadCorrections(q: {
  month: string;
  q?: string;
  people: boolean;
  employeeId?: string;
  page?: number;
  size?: 25 | 50 | 100;
}): Promise<({ ok: true } & CorrectionsLog) | { ok: false; error: string }> {
  const p = new URLSearchParams({
    people: q.people ? '1' : '0',
    page: String(Math.max(1, q.page ?? 1)),
    size: String(q.size ?? 50),
  });
  if (/^\d{4}-\d{2}$/.test(q.month)) p.set('month', q.month);
  if (q.q?.trim()) p.set('q', q.q.trim().slice(0, 80));
  if (q.employeeId && /^\d{1,18}$/.test(q.employeeId)) p.set('employeeId', q.employeeId);
  try {
    return {
      ok: true,
      ...(await apiFetch<CorrectionsLog>(`/staff-attendance/corrections?${p.toString()}`)),
    };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: detailOf(e) };
    throw e;
  }
}

/** Bulk update: one status for the employees picked (or a department) over the dates, with the reason. */
export async function bulkDays(fd: FormData) {
  const ids = fd
    .getAll('employeeIds')
    .map(String)
    .filter((x) => /^\d{1,18}$/.test(x));
  const dept = String(fd.get('department') ?? '').trim();
  const who = fd.get('who') === 'department' ? 'department' : 'employees';
  const type = String(fd.get('dayType') ?? '');
  let r: { set: number; onLeave: number; employees: number } | null = null;
  const safe = attBack(String(fd.get('back') ?? ''));
  try {
    r = await apiFetch('/staff-attendance/days/bulk', {
      method: 'POST',
      body: JSON.stringify({
        ...(who === 'department' ? { department: dept || undefined } : { employeeIds: ids }),
        from: String(fd.get('from') ?? ''),
        to: String(fd.get('to') ?? ''),
        dayType: ['P', 'A', 'HD', 'WO', 'H'].includes(type) ? type : 'P',
        reason: String(fd.get('reason') ?? '').trim(),
        confirmOff: fd.get('confirmOff') === '1',
      }),
    });
  } catch (e) {
    if (e instanceof ApiError) back(safe, e);
    throw e;
  }
  revalidatePath('/leave/attendance');
  const words = `${String(r!.set)} day${r!.set === 1 ? '' : 's'} set for ${String(r!.employees)} staff${r!.onLeave ? `; ${String(r!.onLeave)} on leave left as they are` : ''}.`;
  redirect(`${safe}${safe.includes('?') ? '&' : '?'}ok=1&detail=${encodeURIComponent(words)}`);
}

export async function askRegularisation(fd: FormData) {
  const type = String(fd.get('dayType') ?? '');
  await attCall(
    String(fd.get('back') ?? ''),
    '/staff-attendance/regularisations',
    'POST',
    {
      day: String(fd.get('day') ?? ''),
      in: t(fd, 'in'),
      out: t(fd, 'out'),
      dayType: ['P', 'HD', 'A', 'WO', 'H'].includes(type) ? type : null,
      reason: String(fd.get('reason') ?? '').trim(),
    },
    'The correction is sent to your approver.',
  );
}

export async function decideRegularisation(id: string, fd: FormData) {
  if (!okId(id)) return;
  const outcome = fd.get('outcome') === 'rejected' ? 'rejected' : 'approved';
  await attCall(
    String(fd.get('back') ?? ''),
    `/staff-attendance/regularisations/${id}/decide`,
    'POST',
    {
      outcome,
      note: String(fd.get('note') ?? '').trim(),
    },
    outcome === 'approved' ? 'Approved: the day is set.' : 'Not approved.',
  );
}

export async function withdrawRegularisation(id: string, fd: FormData) {
  if (!okId(id)) return;
  await attCall(
    String(fd.get('back') ?? ''),
    `/staff-attendance/regularisations/${id}/withdraw`,
    'POST',
    { reason: '' },
    'Withdrawn.',
  );
}

export async function clearAttendanceMark(kind: 'late' | 'missing', id: string, fd: FormData) {
  if (!okId(id)) return;
  await attCall(
    String(fd.get('back') ?? ''),
    kind === 'late'
      ? `/staff-attendance/late-marks/${id}/waive`
      : `/staff-attendance/missing-punches/${id}/retire`,
    'POST',
    { reason: String(fd.get('reason') ?? '').trim() },
    kind === 'late' ? 'The late mark is waived.' : 'The missing punch is retired.',
  );
}

export async function lockMonth(lock: boolean, fd: FormData) {
  await attCall(
    String(fd.get('back') ?? ''),
    lock ? '/staff-attendance/lock' : '/staff-attendance/unlock',
    'POST',
    {
      month: String(fd.get('month') ?? ''),
      reason: String(fd.get('reason') ?? '').trim(),
    },
    lock ? 'Locked for payroll.' : 'Unlocked.',
  );
}

export async function runAttendance(fd: FormData) {
  const what = String(fd.get('what') ?? 'sync');
  const day = (k: string) => {
    const v = String(fd.get(k) ?? '');
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
  };
  const month = String(fd.get('month') ?? '');
  await attCall(
    String(fd.get('back') ?? ''),
    '/staff-attendance/run',
    'POST',
    {
      what,
      ...(day('from') ? { from: day('from') } : {}),
      ...(day('to') ? { to: day('to') } : {}),
      ...(/^\d{4}-\d{2}$/.test(month) ? { month } : {}),
    },
    'Done.',
  );
}

/**
 * A timing from its dialog: a special timing, or a department timing — when adding, one for each
 * department picked (the same times). Refused ones are named; the saved ones stay saved.
 */
export async function saveTimingDialog(fd: FormData) {
  const id = String(fd.get('id') ?? '');
  const num = (k: string) => (String(fd.get(k) ?? '').trim() === '' ? null : Number(fd.get(k)));
  const day = (k: string) => {
    const v = String(fd.get(k) ?? '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  };
  const kind = fd.get('kind') === 'special' ? 'special' : 'department';
  const action = (k: string) => {
    const v = String(fd.get(k) ?? 'none');
    return ['none', 'HD', 'A', 'leave'].includes(v) ? v : 'none';
  };
  const typeId = (k: string) => (okId(String(fd.get(k) ?? '')) ? String(fd.get(k)) : null);
  const employeeIds = fd.getAll('employeeIds').map(String).filter(okId);
  const body = (department: string | null) => ({
    kind,
    department,
    employeeId:
      kind === 'special' && okId(String(fd.get('employeeId') ?? ''))
        ? String(fd.get('employeeId'))
        : null,
    ...(kind === 'special' && employeeIds.length ? { employeeIds } : {}),
    from: day('from'),
    to: day('to'),
    applyFrom: kind === 'department' ? day('applyFrom') : null,
    startsAt: String(fd.get('startsAt') ?? ''),
    endsAt: String(fd.get('endsAt') ?? ''),
    grace: num('grace') ?? 0,
    presentHours: num('presentHours') ?? 0,
    halfDayHours: num('halfDayHours') ?? 0,
    lateOver: num('lateOver'),
    lateAction: action('lateAction'),
    lateTypeId: typeId('lateTypeId'),
    earlyOver: num('earlyOver'),
    earlyAction: action('earlyAction'),
    earlyTypeId: typeId('earlyTypeId'),
    note: String(fd.get('note') ?? '').trim() || null,
  });
  const path =
    kind === 'special' ? '/leave/setup/timings?tab=special' : '/leave/setup/timings?tab=department';
  const worked = (n: number | undefined) =>
    n ? ` ${String(n)} past day${n === 1 ? '' : 's'} worked out again.` : '';
  const depts = kind === 'department' ? fd.getAll('department').map(String).filter(Boolean) : [];
  if (id && okId(id)) {
    let r: { id: string; worked?: number; from?: string } | null = null;
    try {
      r = await apiFetch(`/staff-attendance/timings/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body(kind === 'department' ? (depts[0] ?? null) : null)),
      });
    } catch (e) {
      if (e instanceof ApiError) back(`${path}&edit=${id}`, e);
      throw e;
    }
    revalidatePath('/leave/setup/timings');
    const when = r?.from
      ? ` The new hours apply from ${r.from.split('-').reverse().join('-')}; the days before keep the old ones.`
      : '';
    redirect(`${path}&ok=1&detail=${encodeURIComponent(`Saved.${when}${worked(r?.worked)}`)}`);
  }
  if (kind === 'special') {
    let r: {
      created: string[];
      skipped: Array<{ employee: string; reason: string }>;
      worked?: number;
    } | null = null;
    try {
      r = await apiFetch('/staff-attendance/timings', {
        method: 'POST',
        body: JSON.stringify(body(null)),
      });
    } catch (e) {
      if (e instanceof ApiError) back(`${path}&add=special`, e);
      throw e;
    }
    revalidatePath('/leave/setup/timings');
    const skipped = r?.skipped ?? [];
    redirect(
      `${path}&ok=1&detail=${encodeURIComponent(
        `Saved for ${String(r?.created.length ?? 0)} employee${r?.created.length === 1 ? '' : 's'}.${
          skipped.length
            ? ` Skipped ${String(skipped.length)}: ${skipped.map((x) => `${x.employee} (${x.reason})`).join('; ')}.`
            : ''
        }${worked(r?.worked)}`.slice(0, 600),
      )}`,
    );
  }
  const done: string[] = [];
  const refused: string[] = [];
  let n = 0;
  for (const t of depts) {
    try {
      const r = await apiFetch<{ worked?: number }>('/staff-attendance/timings', {
        method: 'POST',
        body: JSON.stringify(body(t)),
      });
      n += r.worked ?? 0;
      done.push(t);
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      refused.push(detailOf(e));
    }
  }
  revalidatePath('/leave/setup/timings');
  if (refused.length && !done.length)
    redirect(
      `${path}&add=department&error=validation-failed&detail=${encodeURIComponent(refused.join(' · ').slice(0, 300))}`,
    );
  redirect(
    `${path}&ok=1&detail=${encodeURIComponent(
      `Saved for ${done.join(', ')}.${refused.length ? ` Not saved — ${refused.join(' · ')}` : ''}${worked(n)}`.slice(
        0,
        500,
      ),
    )}`,
  );
}

export interface TimingBulkResult {
  change: number;
  create: number;
  current: Record<string, { value: string | null; mixed: boolean }>;
  problems: string[];
  people: Array<{ name: string; made: boolean }>;
  saved: number;
}
/** Bulk edit of special timings: check (dryRun) or apply the ticked fields. */
export async function bulkTimings(body: {
  scope: 'existing' | 'department';
  department: string | null;
  from: string;
  to: string;
  fields: Record<string, string | number | null>;
  dryRun: boolean;
}): Promise<{ ok: true; r: TimingBulkResult } | { ok: false; error: string }> {
  try {
    const r = await apiFetch<TimingBulkResult>('/staff-attendance/timings/bulk', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!body.dryRun) revalidatePath('/leave/setup/timings');
    return { ok: true, r };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: detailOf(e) };
    throw e;
  }
}

export type SpecialImportResult =
  | {
      ok: true;
      rows: Array<{
        row: number;
        employee: string;
        dates: string;
        what: 'new' | 'change' | 'same' | null;
        ok: boolean;
        error?: string;
      }>;
      saved: number;
    }
  | { ok: false; error: string };
/** Special timings from Excel: check (dryRun), then save the good rows. */
export async function importSpecialTimings(
  file: string,
  dryRun: boolean,
): Promise<SpecialImportResult> {
  try {
    const r = await apiFetch<Omit<Extract<SpecialImportResult, { ok: true }>, 'ok'>>(
      '/staff-attendance/timings/special-import',
      { method: 'POST', body: JSON.stringify({ file, dryRun }) },
    );
    if (!dryRun) revalidatePath('/leave/setup/timings');
    return { ok: true, ...r };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: detailOf(e) };
    throw e;
  }
}

export async function retireTiming(id: string, fd?: FormData) {
  if (!okId(id)) return;
  const back_ = String(fd?.get('back') ?? '');
  const path = back_.startsWith('/leave/setup/timings') ? back_ : '/leave/setup/timings';
  let r: { status: string; on?: string } | null = null;
  try {
    r = await apiFetch(`/staff-attendance/timings/${id}/retire`, { method: 'POST', body: '{}' });
  } catch (e) {
    if (e instanceof ApiError) back(path, e);
    throw e;
  }
  revalidatePath('/leave/setup/timings');
  const said =
    r?.status === 'ended'
      ? `It already applied to past days, so it ends on ${(r.on ?? '').split('-').reverse().join('-')} (those days keep it); from today the next timing or the shift applies.`
      : 'Removed: it had not started.';
  redirect(`${path}${path.includes('?') ? '&' : '?'}ok=1&detail=${encodeURIComponent(said)}`);
}

export type SheetResult =
  | {
      ok: true;
      rows: Array<{ row: number; employee: string; day: string; ok: boolean; error?: string }>;
      saved: number;
    }
  | { ok: false; error: string };
export async function importAttendanceSheet(
  what: 'days' | 'punches',
  file: string,
  dryRun: boolean,
  /** the days sheet's Default Reason: used for every row whose Reason is blank */
  reason?: string,
): Promise<SheetResult> {
  try {
    const r = await apiFetch<Omit<Extract<SheetResult, { ok: true }>, 'ok'>>(
      `/staff-attendance/sheets/${what}/import`,
      {
        method: 'POST',
        body: JSON.stringify({ file, dryRun, ...(reason ? { reason } : {}) }),
      },
    );
    if (!dryRun) revalidatePath('/leave/attendance');
    return { ok: true, ...r };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: detailOf(e) };
    throw e;
  }
}

// ---- phase D: the reports ------------------------------------------------------------------------------
/** Give a report to these people (and nobody else). */
export async function setReportAccess(report: string, fd: FormData) {
  if (!/^[a-z_]{3,40}$/.test(report)) return;
  const safe = '/leave/setup/report-access';
  try {
    await apiFetch(`/leave-reports/access/${report}`, {
      method: 'PUT',
      body: JSON.stringify({ userIds: fd.getAll('people').map(String).filter(okId) }),
    });
  } catch (e) {
    if (e instanceof ApiError) back(safe, e);
    throw e;
  }
  revalidatePath(safe);
  redirect(`${safe}?ok=1&detail=${encodeURIComponent('Saved.')}#r-${report}`);
}

// ---- phase E: moving from the old module ---------------------------------------------------------------
const CUT = '/leave/setup/cutover';
async function cutCall(path: string, body: unknown, ok: string) {
  try {
    await apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
  } catch (e) {
    if (e instanceof ApiError) back(CUT, e);
    throw e;
  }
  revalidatePath(CUT);
  redirect(`${CUT}?ok=1&detail=${encodeURIComponent(ok)}`);
}
export async function saveCutoverSettings(fd: FormData) {
  const freeze = String(fd.get('freezeOn') ?? '');
  await cutCall(
    '/staff-cutover/settings',
    {
      parallelMonth: String(fd.get('parallelMonth') ?? ''),
      freezeOn: /^\d{4}-\d{2}-\d{2}$/.test(freeze) ? freeze : null,
    },
    'Saved.',
  );
}
export async function requestCutoverRead() {
  await cutCall(
    '/staff-cutover/read',
    {},
    'Asked: the workers read the old database in a minute or two.',
  );
}
export async function runCutoverStep(step: string) {
  if (!['setup', 'balances', 'history'].includes(step)) return;
  await cutCall(
    `/staff-cutover/steps/${step}`,
    {},
    'Brought in: see what came and what could not.',
  );
}
export async function switchCutover() {
  await cutCall(
    '/staff-cutover/switch',
    {},
    'Switched: EduPro is the record now; what waited starts at the first level.',
  );
}

// ---- the shift calendar -----------------------------------------------------------------------------
type Got<T> = { ok: true; r: T } | { ok: false; error: string };
async function shiftCall<T>(path: string, body: unknown, write: boolean): Promise<Got<T>> {
  try {
    const r = await apiFetch<T>(`/staff-attendance/shift-calendar/${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (write) revalidatePath('/leave/setup/shift-calendar');
    return { ok: true, r };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: detailOf(e) };
    throw e;
  }
}
/** Post a shift to employees for days (one day: that day only); dryRun shows what would change. */
export async function assignShifts(body: {
  employeeIds: string[];
  shiftId: string;
  from: string;
  to: string | null;
  dryRun: boolean;
}) {
  return shiftCall<ShiftAssignResult>('assign', body, !body.dryRun);
}
/** Take a day back to the shift around it. */
export async function clearShiftDay(body: { employeeId: string; day: string }) {
  return shiftCall<{ cleared: number; worked: number }>('clear-day', body, true);
}
/** Copy a month's posted shifts onto another month; dryRun shows what it does. */
export async function copyShiftMonth(body: {
  source: string;
  target: string;
  q?: string;
  department?: string;
  dryRun: boolean;
}) {
  return shiftCall<ShiftCopyResult>('copy', body, !body.dryRun);
}
