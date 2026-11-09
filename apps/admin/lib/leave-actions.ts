'use server';
/** Staff leave and attendance set-up (docs/design/85): who approves and the settings. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
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
