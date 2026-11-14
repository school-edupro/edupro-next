'use server';
/** Payment and statutory (docs/design/86, phase C): the forms, posted to the payroll API. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

const okId = (id: string) => /^\d{1,18}$/.test(id);
const okMonth = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
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

// ---- bank files -------------------------------------------------------------------------------------------------
export async function makeBankFile(runId: string, fd: FormData) {
  if (!okId(runId)) return;
  const here = `/payroll/runs/${runId}/bank`;
  const code = text(fd, 'bankCode');
  const r = await attempt(here, () =>
    send<{ id: string; message: string }>(`/payroll/runs/${runId}/bank`, 'POST', {
      bankCode: code && code !== 'ALL' ? code : null,
      valueDate: text(fd, 'valueDate'),
    }),
  );
  done(`/payroll/bank/${r.id}`, r.message);
}

export async function batchAction(
  batchId: string,
  action: 'uploaded' | 'confirm' | 'cancel',
  fd: FormData,
) {
  if (!okId(batchId)) return;
  const here = `/payroll/bank/${batchId}`;
  const body =
    action === 'confirm'
      ? { utr: text(fd, 'utr') }
      : action === 'cancel'
        ? { reason: text(fd, 'reason') }
        : undefined;
  const r = await attempt(here, () =>
    send<{ message?: string }>(`/payroll/bank/batches/${batchId}/${action}`, 'POST', body),
  );
  done(
    here,
    r.message ??
      (action === 'uploaded' ? 'Marked uploaded to the bank.' : 'The bank file is cancelled.'),
  );
}

export async function returnLine(batchId: string, lineId: string, fd: FormData) {
  if (!okId(batchId) || !okId(lineId)) return;
  const here = `/payroll/bank/${batchId}`;
  const r = await attempt(here, () =>
    send<{ message: string }>(`/payroll/bank/lines/${lineId}/reject`, 'POST', {
      reason: text(fd, 'reason'),
    }),
  );
  done(here, r.message);
}

export async function markPaid(runId: string, recordId: string, mode: string, fd: FormData) {
  if (!okId(runId) || !okId(recordId)) return;
  const here = `/payroll/runs/${runId}/bank`;
  const r = await attempt(here, () =>
    send<{ runPaid: boolean }>(`/payroll/runs/${runId}/records/${recordId}/paid`, 'POST', {
      mode,
      reference: text(fd, 'reference'),
    }),
  );
  done(here, `Marked paid.${r.runPaid ? ' Everything in the run is paid.' : ''}`);
}

// ---- the school's bank accounts ---------------------------------------------------------------------------------------
export async function saveBankAccount(id: string | null, fd: FormData) {
  if (id && !okId(id)) return;
  const here = '/payroll/setup/bank';
  const format = String(fd.get('fileFormat') ?? 'GENERIC_CSV');
  await attempt(here, () =>
    send(id ? `/payroll/bank/accounts/${id}` : '/payroll/bank/accounts', id ? 'PUT' : 'POST', {
      bankCode: text(fd, 'bankCode'),
      bankName: text(fd, 'bankName'),
      branch: text(fd, 'branch'),
      accountNo: text(fd, 'accountNo'),
      fileFormat: format,
      layout: format === 'CUSTOM_CSV' ? layoutOf(fd) : null,
      active: id ? fd.get('active') === 'on' : true,
    }),
  );
  done(here, id ? 'The bank account is saved.' : 'The bank account is added.');
}

function layoutOf(fd: FormData) {
  const columns: Array<Record<string, string>> = [];
  for (let i = 0; i < 16; i += 1) {
    const field = text(fd, `col${String(i)}.field`);
    if (!field) continue;
    const value = text(fd, `col${String(i)}.value`);
    const header = text(fd, `col${String(i)}.header`);
    const fmt = text(fd, `col${String(i)}.format`);
    columns.push({
      ...(field === 'value' ? { value: value ?? '' } : { field }),
      ...(header ? { header } : {}),
      ...(fmt && (field === 'date' || field === 'amount') ? { format: fmt } : {}),
    });
  }
  return {
    columns,
    header: fd.get('header') === 'on',
    delimiter: String(fd.get('delimiter') ?? ','),
    extension: String(fd.get('extension') ?? 'csv'),
  };
}

/** A layout tried on two made-up payments (the form's "Try it"). */
export async function tryLayout(
  _prev: { text?: string; error?: string } | null,
  fd: FormData,
): Promise<{ text?: string; error?: string }> {
  try {
    return await send<{ text: string }>('/payroll/bank/layout/check', 'POST', {
      layout: layoutOf(fd),
    });
  } catch (e) {
    if (e instanceof ApiError) return { error: detailOf(e) };
    throw e;
  }
}

/** The voucher's ledger names: one "name = ledger" a line for the staff types and the deduction heads. */
export async function saveLedgers(fd: FormData) {
  const here = '/payroll/setup/bank';
  const pairs = (k: string) =>
    Object.fromEntries(
      String(fd.get(k) ?? '')
        .split(/\r?\n/)
        .map((l) => l.split('='))
        .filter((p) => p.length === 2 && p[0]!.trim() && p[1]!.trim())
        .map((p) => [p[0]!.trim(), p[1]!.trim()]),
    );
  const side = (prefix: string) =>
    Object.fromEntries(
      ['PF', 'ESI', 'NPS', 'LWF'].map((k) => [k, text(fd, `${prefix}.${k}`)]).filter((p) => p[1]),
    );
  const settings = await attempt(here, () =>
    send<{ settings: Record<string, unknown> }>('/payroll/settings', 'GET'),
  );
  const body = { ...settings.settings };
  delete body.updatedAt;
  await attempt(here, () =>
    send('/payroll/settings', 'PUT', {
      ...body,
      ecrArrearMode: String(fd.get('ecrArrearMode') ?? 'FOLDED'),
      jvLedgers: {
        salary: pairs('salary'),
        heads: Object.fromEntries(
          Object.entries(pairs('heads')).map(([k, v]) => [k.toUpperCase(), v]),
        ),
        employer: side('employer'),
        payable: side('payable'),
        ...(text(fd, 'net') ? { net: text(fd, 'net') } : {}),
      },
    }),
  );
  done(here, 'The ECR arrears and the voucher’s ledger names are saved.');
}

// ---- statutory ---------------------------------------------------------------------------------------------------
export async function ecrFiled(month: string, fd: FormData) {
  if (!okMonth(month)) return;
  const here = `/payroll/statutory?month=${month}&tab=pf`;
  const r = await attempt(here, () =>
    send<{ seq: number; members: number }>('/payroll/statutory/pf/ecr/filed', 'POST', {
      month,
      ackNo: text(fd, 'ackNo'),
      filedOn: text(fd, 'filedOn'),
    }),
  );
  done(here, `ECR ${String(r.seq)} recorded as filed: ${String(r.members)} member(s).`);
}

export async function withdrawReturn(month: string, id: string, fd: FormData) {
  if (!okMonth(month) || !okId(id)) return;
  const here = `/payroll/statutory?month=${month}&tab=pf`;
  await attempt(here, () =>
    send(`/payroll/statutory/returns/${id}/withdraw`, 'POST', { reason: text(fd, 'reason') }),
  );
  done(here, 'The filing is withdrawn.');
}

export async function seedCalendar(fy: number) {
  if (!Number.isInteger(fy)) return;
  const here = `/payroll/statutory?tab=calendar&fy=${String(fy)}`;
  const r = await attempt(here, () =>
    send<{ message: string }>('/payroll/compliance/seed', 'POST', { fy }),
  );
  done(here, r.message);
}

export async function dueDone(fy: number, id: string, fd: FormData) {
  if (!okId(id)) return;
  const here = `/payroll/statutory?tab=calendar&fy=${String(fy)}`;
  const amount = text(fd, 'amountPaid')?.replace(/,/g, '') ?? null;
  const r = await attempt(here, () =>
    send<{ message: string }>(`/payroll/compliance/${id}/done`, 'POST', {
      ackNo: text(fd, 'ackNo'),
      ackDate: text(fd, 'ackDate'),
      amountPaid: amount,
    }),
  );
  done(here, r.message);
}

export async function dueReopen(fy: number, id: string, fd: FormData) {
  if (!okId(id)) return;
  const here = `/payroll/statutory?tab=calendar&fy=${String(fy)}`;
  await attempt(here, () =>
    send(`/payroll/compliance/${id}/reopen`, 'POST', { reason: text(fd, 'reason') }),
  );
  done(here, 'Reopened.');
}
