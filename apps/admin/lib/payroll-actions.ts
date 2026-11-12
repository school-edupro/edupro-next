'use server';
/** Payroll set-up (docs/design/86, phase A): the forms of the set-up screens, posted to the /payroll API. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import type { ConfigKind, FormulaCheck } from './payroll';

const okId = (id: string) => /^\d{1,18}$/.test(id);
const KINDS: ConfigKind[] = ['rates', 'pf', 'esi', 'pt', 'lwf', 'ot'];
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
  revalidatePath('/payroll/setup');
  redirect(
    `${path}${join(path)}ok=1&detail=${encodeURIComponent(detail)}&r=${Date.now().toString(36)}`,
  );
};
/** a path of this app to return to, never elsewhere */
const safe = (v: FormDataEntryValue | null, dflt: string) => {
  const p = String(v ?? '');
  return p.startsWith('/payroll/') && !p.startsWith('//') ? p : dflt;
};
const text = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? '').trim();
  return v === '' ? null : v;
};
async function send(path: string, method: string, body?: unknown) {
  return apiFetch(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

// ---- settings ------------------------------------------------------------------------------------------
export async function savePayrollSettings(fd: FormData) {
  const here = '/payroll/setup/settings';
  const attrs = String(fd.get('formulaAttributes') ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [code, field, value] = l.split('|').map((x) => x.trim());
      return { code: code ?? '', field: field ?? '', value: value ?? '' };
    });
  try {
    await send('/payroll/settings', 'PUT', {
      stateCode: text(fd, 'stateCode')?.toUpperCase() ?? null,
      pfEstablishmentCode: text(fd, 'pfEstablishmentCode'),
      tan: text(fd, 'tan'),
      ptrcNo: text(fd, 'ptrcNo'),
      esiCode: text(fd, 'esiCode'),
      lwfEnabled: fd.get('lwfEnabled') === 'on',
      epsStopAge: Number(fd.get('epsStopAge') ?? 58),
      pfCeilingProrate: fd.get('pfCeilingProrate') === 'on',
      matrixCode: String(fd.get('matrixCode') ?? 'PM_2016'),
      payCycleFromDay: text(fd, 'payCycleFromDay') ? Number(fd.get('payCycleFromDay')) : null,
      otHoursLimit: Number(fd.get('otHoursLimit') ?? 744),
      payslipPassword: text(fd, 'payslipPassword'),
      bankFileFormat: String(fd.get('bankFileFormat') ?? 'GENERIC_CSV'),
      confidentialEmployeeIds: fd.getAll('confidentialEmployeeIds').map(String).filter(okId),
      formulaAttributes: attrs,
      regimeCutoffMonth: Number(fd.get('regimeCutoffMonth') ?? 12),
    });
  } catch (e) {
    if (e instanceof ApiError) back(here, e);
    throw e;
  }
  done(here, 'The payroll settings are saved.');
}

// ---- the dated rate registry ---------------------------------------------------------------------------
const FIELDS: Record<ConfigKind, string[]> = {
  rates: ['rateCode', 'rateValue', 'notifiedOn', 'source'],
  pf: [
    'eeRate',
    'erRate',
    'epsRate',
    'epsWageCeiling',
    'edliRate',
    'edliWageCeiling',
    'edliMin',
    'adminRate',
    'adminMin',
  ],
  esi: ['eeRate', 'erRate', 'wageLimit', 'wageLimitPwd'],
  pt: ['stateCode', 'gender', 'wageFrom', 'wageTo', 'monthlyAmount'],
  lwf: ['stateCode', 'eeRate', 'eeCap', 'eeFlat', 'erFlat', 'erMultiplier', 'frequency'],
  ot: ['employeeType', 'dailyAmount', 'hourlyAmount'],
};
/** The draft's fields from its form: rates given in per cent on the form are sent as decimals. */
function configBody(kind: ConfigKind, fd: FormData) {
  const body: Record<string, unknown> = {
    effectiveFrom: text(fd, 'effectiveFrom'),
    referenceNo: text(fd, 'referenceNo'),
    changeReason: text(fd, 'changeReason'),
  };
  for (const f of FIELDS[kind]) {
    const v = text(fd, f);
    if (v === null) continue;
    // a field named …Rate is typed as a per cent (12 → 0.12), except the generic rate value
    body[f] = /Rate$/.test(f)
      ? String(Number((Number(v) / 100).toFixed(6)))
      : f === 'stateCode' || f === 'rateCode'
        ? v.toUpperCase()
        : v;
  }
  if (kind === 'lwf')
    body.months = fd
      .getAll('months')
      .map(Number)
      .filter((n) => n >= 1 && n <= 12);
  if (kind === 'pt') {
    const m = text(fd, 'overrideMonth');
    const a = text(fd, 'overrideAmount');
    body.monthOverrides = m && a ? { [m]: a } : null;
  }
  return body;
}

export async function addPayrollConfig(kind: ConfigKind, fd: FormData) {
  if (!KINDS.includes(kind)) return;
  const here = `/payroll/setup/rates?tab=${kind}`;
  try {
    await send(`/payroll/config/${kind}`, 'POST', configBody(kind, fd));
  } catch (e) {
    if (e instanceof ApiError) back(here, e);
    throw e;
  }
  done(here, 'Saved as a draft: a payroll checker approves it.');
}

/** `returnTo`: the page to come back to (the drafts list); a form bound without it passes its FormData there. */
export async function approvePayrollConfig(kind: ConfigKind, id: string, returnTo?: unknown) {
  if (!KINDS.includes(kind) || !okId(id)) return;
  const dflt = `/payroll/setup/rates?tab=${kind}`;
  const here = typeof returnTo === 'string' ? safe(returnTo, dflt) : dflt;
  let message = 'Approved.';
  try {
    message = ((await send(`/payroll/config/${kind}/${id}/approve`, 'POST')) as { message: string })
      .message;
  } catch (e) {
    if (e instanceof ApiError) back(here, e);
    throw e;
  }
  done(here, message);
}

export async function endPayrollConfig(kind: ConfigKind, id: string, fd: FormData) {
  if (!KINDS.includes(kind) || !okId(id)) return;
  const here = `/payroll/setup/rates?tab=${kind}`;
  try {
    await send(`/payroll/config/${kind}/${id}/end`, 'POST', {
      effectiveTo: text(fd, 'effectiveTo'),
      reason: text(fd, 'reason'),
    });
  } catch (e) {
    if (e instanceof ApiError) back(here, e);
    throw e;
  }
  done(here, 'Ended: no month after that date reads it.');
}

export async function deletePayrollConfig(kind: ConfigKind, id: string) {
  if (!KINDS.includes(kind) || !okId(id)) return;
  const here = `/payroll/setup/rates?tab=${kind}`;
  try {
    await send(`/payroll/config/${kind}/${id}`, 'DELETE');
  } catch (e) {
    if (e instanceof ApiError) back(here, e);
    throw e;
  }
  done(here, 'The draft is deleted.');
}

export async function addTaxYear(fd: FormData) {
  const fy = text(fd, 'fy') ?? '';
  const here = `/payroll/setup/tax?fy=${encodeURIComponent(fy)}`;
  try {
    await send('/payroll/tax/years', 'POST', { fy, copyFrom: text(fd, 'copyFrom') });
  } catch (e) {
    if (e instanceof ApiError) back('/payroll/setup/tax', e);
    throw e;
  }
  done(here, `${fy} is added from the earlier year: check its slabs and limits.`);
}

// ---- pay heads -----------------------------------------------------------------------------------------
function versionBody(fd: FormData) {
  return {
    calcType: String(fd.get('calcType') ?? 'FIXED'),
    formula: text(fd, 'formula'),
    dependsOn: text(fd, 'dependsOn')?.toUpperCase() ?? null,
    isTaxable: fd.get('isTaxable') === 'on',
    pfWage: fd.get('pfWage') === 'on',
    esiWage: fd.get('esiWage') === 'on',
    ptWage: fd.get('ptWage') === 'on',
    prorateOnLop: fd.get('prorateOnLop') === 'on',
    rounding: String(fd.get('rounding') ?? 'NEAREST_1'),
    effectiveFrom: text(fd, 'effectiveFrom'),
    referenceNo: text(fd, 'referenceNo'),
    changeReason: text(fd, 'changeReason'),
    slabs: slabsOf(fd),
  };
}
/** Slab lines "from | to | amount" or "from | to | 12%" (to empty: and above), on one basis. */
function slabsOf(fd: FormData) {
  if (String(fd.get('calcType') ?? '') !== 'SLAB') return [];
  const basis = String(fd.get('slabBasis') ?? 'BASIC');
  return String(fd.get('slabs') ?? '')
    .split('\n')
    .map((l) => l.split('|').map((x) => x.trim().replace(/,/g, '')))
    .filter((p) => p.length >= 3 && p[0] !== '')
    .map(([from, to, v]) => {
      const percent = v?.endsWith('%') ? v.slice(0, -1).trim() : null; // a per cent figure (12.5), as stored
      return {
        basis,
        rangeFrom: from,
        rangeTo: to || null,
        flatAmount: percent ? null : (v ?? null),
        percent,
      };
    });
}

export async function addPayHead(fd: FormData) {
  const here = '/payroll/setup/heads';
  let id = '';
  try {
    id = (
      (await send('/payroll/heads', 'POST', {
        code: String(fd.get('code') ?? '').toUpperCase(),
        name: text(fd, 'name'),
        headType: String(fd.get('headType') ?? 'EARNING'),
        category: String(fd.get('category') ?? 'ALLOWANCE'),
        printOrder: Number(fd.get('printOrder') ?? 100),
        showIfZero: fd.get('showIfZero') === 'on',
        version: versionBody(fd),
      })) as { id: string }
    ).id;
  } catch (e) {
    if (e instanceof ApiError) back(here, e);
    throw e;
  }
  done(`/payroll/setup/heads/${id}`, 'The head is added with its first version as a draft.');
}

export async function updatePayHead(id: string, fd: FormData) {
  if (!okId(id)) return;
  const here = `/payroll/setup/heads/${id}`;
  try {
    await send(`/payroll/heads/${id}`, 'PUT', {
      name: text(fd, 'name'),
      category: String(fd.get('category') ?? 'ALLOWANCE'),
      printOrder: Number(fd.get('printOrder') ?? 100),
      status: String(fd.get('status') ?? 'active'),
    });
  } catch (e) {
    if (e instanceof ApiError) back(here, e);
    throw e;
  }
  done(here, 'Saved.');
}

export async function addHeadVersion(headId: string, fd: FormData) {
  if (!okId(headId)) return;
  const here = `/payroll/setup/heads/${headId}`;
  try {
    await send(`/payroll/heads/${headId}/versions`, 'POST', versionBody(fd));
  } catch (e) {
    if (e instanceof ApiError) back(here, e);
    throw e;
  }
  done(here, 'The new version is a draft: a payroll checker approves it.');
}

export async function versionAction(
  headId: string,
  versionId: string,
  action: 'approve' | 'delete',
) {
  if (!okId(headId) || !okId(versionId)) return;
  const here = `/payroll/setup/heads/${headId}`;
  let message = action === 'approve' ? 'Approved.' : 'The draft is deleted.';
  try {
    if (action === 'approve')
      message = (
        (await send(`/payroll/head-versions/${versionId}/approve`, 'POST')) as { message: string }
      ).message;
    else await send(`/payroll/head-versions/${versionId}`, 'DELETE');
  } catch (e) {
    if (e instanceof ApiError) back(here, e);
    throw e;
  }
  done(here, message);
}

export async function endHeadVersion(headId: string, versionId: string, fd: FormData) {
  if (!okId(headId) || !okId(versionId)) return;
  const here = `/payroll/setup/heads/${headId}`;
  try {
    await send(`/payroll/head-versions/${versionId}/end`, 'POST', {
      effectiveTo: text(fd, 'effectiveTo'),
      reason: text(fd, 'reason'),
    });
  } catch (e) {
    if (e instanceof ApiError) back(here, e);
    throw e;
  }
  done(here, 'The version is ended.');
}

export async function addFormulaTest(headId: string, fd: FormData) {
  if (!okId(headId)) return;
  const here = `/payroll/setup/heads/${headId}`;
  const inputs: Record<string, string> = {};
  for (const line of String(fd.get('inputs') ?? '').split(/[\n,]/)) {
    const [k, v] = line.split('=').map((x) => x.trim());
    if (k && v) inputs[k.toUpperCase()] = v;
  }
  try {
    await send(`/payroll/heads/${headId}/tests`, 'POST', {
      name: text(fd, 'name'),
      inputs,
      expected: text(fd, 'expected'),
    });
  } catch (e) {
    if (e instanceof ApiError) back(here, e);
    throw e;
  }
  done(here, 'The test is saved: it runs each time a version of this head is saved or approved.');
}

export async function testAction(headId: string, testId: string | null) {
  if (!okId(headId) || (testId !== null && !okId(testId))) return;
  const here = `/payroll/setup/heads/${headId}`;
  let message = 'The test is deleted.';
  try {
    if (testId) await send(`/payroll/formula-tests/${testId}`, 'DELETE');
    else {
      const r = (await send(`/payroll/heads/${headId}/tests/run`, 'POST')) as { failing: string[] };
      message = r.failing.length ? `Failing: ${r.failing.join(', ')}` : 'Every saved test passes.';
    }
  } catch (e) {
    if (e instanceof ApiError) back(here, e);
    throw e;
  }
  done(here, message);
}

/** The formula box: errors and unknown names as typed, and a value from the values given. */
export async function checkFormula(formula: string, pass: 1 | 2, inputs: Record<string, string>) {
  try {
    return (await send('/payroll/formula/check', 'POST', {
      formula,
      pass,
      ...(Object.keys(inputs).length ? { inputs } : {}),
    })) as FormulaCheck;
  } catch (e) {
    if (e instanceof ApiError)
      return {
        ok: false,
        errors: [detailOf(e)],
        headsUsed: [],
        varsUsed: [],
        warnings: [],
        result: null,
        names: { heads: [], rates: [], attributes: [], system: [] },
      } satisfies FormulaCheck;
    throw e;
  }
}

// ---- the pay matrix ------------------------------------------------------------------------------------
export async function saveMatrixCell(fd: FormData) {
  const code = String(fd.get('matrixCode') ?? '');
  const here = `/payroll/setup/matrix?code=${encodeURIComponent(code)}`;
  try {
    await send('/payroll/matrix/cell', 'PUT', {
      matrixCode: code,
      payLevel: text(fd, 'payLevel'),
      levelOrder: Number(fd.get('levelOrder') ?? 0),
      cellNo: Number(fd.get('cellNo') ?? 0),
      basic: text(fd, 'basic'),
      effectiveFrom: text(fd, 'effectiveFrom'),
    });
  } catch (e) {
    if (e instanceof ApiError) back(here, e);
    throw e;
  }
  done(here, 'The cell is saved.');
}

export async function deleteMatrixCell(code: string, level: string, cell: number | null) {
  const here = `/payroll/setup/matrix?code=${encodeURIComponent(code)}`;
  try {
    await send(
      `/payroll/matrix/${encodeURIComponent(code)}/${encodeURIComponent(level)}${cell ? `?cell=${String(cell)}` : ''}`,
      'DELETE',
    );
  } catch (e) {
    if (e instanceof ApiError) back(here, e);
    throw e;
  }
  done(here, cell ? 'The cell is removed.' : 'The level is removed.');
}

/** The remove form: a whole level (cell empty) or one cell. */
export async function removeMatrixCell(fd: FormData) {
  const cell = text(fd, 'cellNo');
  await deleteMatrixCell(
    String(fd.get('matrixCode') ?? ''),
    String(fd.get('payLevel') ?? ''),
    cell ? Number(cell) : null,
  );
}

// ---- profiles ------------------------------------------------------------------------------------------
export async function syncProfiles() {
  const here = '/payroll/setup/profiles';
  let added = 0;
  try {
    added = ((await send('/payroll/profiles/sync', 'POST', { dryRun: false })) as { added: number })
      .added;
  } catch (e) {
    if (e instanceof ApiError) back(here, e);
    throw e;
  }
  done(here, `${String(added)} profile(s) added with the defaults: check each one.`);
}

export async function savePayrollProfile(employeeId: string, fd: FormData) {
  if (!okId(employeeId)) return;
  const here = `/payroll/setup/profiles/${employeeId}`;
  const level = text(fd, 'payLevel');
  try {
    await send(`/payroll/profiles/${employeeId}`, 'PUT', {
      pfApplicable: fd.get('pfApplicable') === 'on',
      pfWageBasis: String(fd.get('pfWageBasis') ?? 'ACTUAL'),
      epsApplicable: fd.get('epsApplicable') === 'on',
      vpfType: String(fd.get('vpfType') ?? 'NONE'),
      vpfValue: text(fd, 'vpfValue') ?? '0',
      npsApplicable: fd.get('npsApplicable') === 'on',
      npsEeRate: String(Number(text(fd, 'npsEeRate') ?? '10') / 100),
      npsErRate: String(Number(text(fd, 'npsErRate') ?? '14') / 100),
      esiApplicable: fd.get('esiApplicable') === 'on',
      pwd: fd.get('pwd') === 'on',
      ptApplicable: fd.get('ptApplicable') === 'on',
      ptExemptReason: text(fd, 'ptExemptReason'),
      taxRegime: String(fd.get('taxRegime') ?? 'NEW'),
      tdsMode: String(fd.get('tdsMode') ?? 'PROJECTION'),
      category: text(fd, 'category'),
      payLevel: level,
      payCell: level && text(fd, 'payCell') ? Number(fd.get('payCell')) : null,
      contractStart: text(fd, 'contractStart'),
      contractEnd: text(fd, 'contractEnd'),
      incrementMonth: text(fd, 'incrementMonth') ? Number(fd.get('incrementMonth')) : null,
      payrollStatus: String(fd.get('payrollStatus') ?? 'ACTIVE'),
      payMode: String(fd.get('payMode') ?? 'BANK'),
      changesFrom: text(fd, 'changesFrom'),
    });
  } catch (e) {
    if (e instanceof ApiError) back(here, e);
    throw e;
  }
  done(here, 'The payroll profile is saved; the changes are in its history.');
}

export async function savePayrollNominees(employeeId: string, fd: FormData) {
  if (!okId(employeeId)) return;
  const here = `/payroll/setup/profiles/${employeeId}`;
  const names = fd.getAll('nName').map(String);
  const nominees = names
    .map((name, i) => ({
      name: name.trim(),
      relation: String(fd.getAll('nRelation')[i] ?? '').trim(),
      dob: String(fd.getAll('nDob')[i] ?? '') || null,
      sharePercent: String(fd.getAll('nShare')[i] ?? '').trim(),
      purpose: String(fd.getAll('nPurpose')[i] ?? 'GENERAL'),
    }))
    .filter((n) => n.name);
  try {
    await send(`/payroll/profiles/${employeeId}/nominees`, 'PUT', { nominees });
  } catch (e) {
    if (e instanceof ApiError) back(here, e);
    throw e;
  }
  done(here, 'The nominees are saved.');
}

/** The full value for a checker, with a reason (the API logs the reveal, never the value). */
export async function revealPayrollValue(employeeId: string, field: string, reason: string) {
  if (!okId(employeeId)) return { value: null, error: 'Not an employee' };
  try {
    const r = (await send(`/payroll/profiles/${employeeId}/reveal`, 'POST', { field, reason })) as {
      value: string | null;
    };
    return { value: r.value, error: null };
  } catch (e) {
    if (e instanceof ApiError) return { value: null, error: detailOf(e) };
    throw e;
  }
}

// ---- structures and templates --------------------------------------------------------------------------
export async function savePayrollStructure(employeeId: string, fd: FormData) {
  if (!okId(employeeId)) return;
  const here = `/payroll/setup/structures/${employeeId}`;
  const lines = fd
    .getAll('headId')
    .map(String)
    .map((id) => ({
      payHeadId: id,
      amount: String(fd.get(`amount_${id}`) ?? '')
        .trim()
        .replace(/,/g, ''),
    }))
    .filter((l) => okId(l.payHeadId) && l.amount !== '');
  try {
    await send(`/payroll/structures/${employeeId}`, 'POST', {
      effectiveFrom: text(fd, 'effectiveFrom'),
      changeReason: text(fd, 'changeReason'),
      lines,
    });
  } catch (e) {
    if (e instanceof ApiError) back(here, e);
    throw e;
  }
  done(here, 'Saved as drafts: a payroll checker approves them.');
}

export async function structureDrafts(fd: FormData) {
  const here = safe(fd.get('back'), '/payroll/setup/approvals');
  const employeeIds = fd.getAll('employeeIds').map(String).filter(okId);
  const action = String(fd.get('do') ?? 'approve');
  let message = '';
  try {
    if (!employeeIds.length) throw new Error('none');
    if (action === 'delete') {
      const r = (await send('/payroll/structures/drafts/delete', 'POST', { employeeIds })) as {
        deleted: number;
      };
      message = `${String(r.deleted)} draft row(s) deleted.`;
    } else {
      const r = (await send('/payroll/structures/approve', 'POST', { employeeIds })) as {
        approved: number;
        refused: Array<{ employeeId: string; reason: string }>;
      };
      message = `${String(r.approved)} employee(s) approved.${r.refused.length ? ` Not approved: ${r.refused.map((x) => x.reason).join('; ')}` : ''}`;
    }
  } catch (e) {
    if (e instanceof ApiError) back(here, e);
    if (e instanceof Error && e.message === 'none')
      redirect(
        `${here}${join(here)}error=validation-failed&detail=${encodeURIComponent('Tick the staff first')}`,
      );
    throw e;
  }
  done(here, message);
}

export async function savePayrollTemplate(id: string | null, fd: FormData) {
  if (id !== null && !okId(id)) return;
  const here = '/payroll/setup/structures?tab=templates';
  const lines: Record<string, string> = {};
  for (const line of String(fd.get('lines') ?? '').split(/[\n,]/)) {
    const [k, v] = line.split('=').map((x) => x.trim());
    if (k && v) lines[k.toUpperCase()] = v.replace(/,/g, '');
  }
  try {
    await send(id ? `/payroll/templates/${id}` : '/payroll/templates', id ? 'PUT' : 'POST', {
      name: text(fd, 'name'),
      description: text(fd, 'description'),
      staffTypes: String(fd.get('staffTypes') ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
      lines,
    });
  } catch (e) {
    if (e instanceof ApiError) back(here, e);
    throw e;
  }
  done(here, 'The template is saved.');
}

export async function deletePayrollTemplate(id: string) {
  if (!okId(id)) return;
  const here = '/payroll/setup/structures?tab=templates';
  try {
    await send(`/payroll/templates/${id}`, 'DELETE');
  } catch (e) {
    if (e instanceof ApiError) back(here, e);
    throw e;
  }
  done(here, 'The template is deleted.');
}

/** The structure sheet, checked (dryRun) or saved: the rows and what is wrong with each. */
export async function importStructureSheet(file: string, dryRun: boolean) {
  try {
    return {
      result: (await send('/payroll/structures/import', 'POST', { file, dryRun })) as {
        rows: Array<{
          row: number;
          code: string;
          head: string;
          amount: string;
          from: string | null;
          status: string;
          error: string | null;
        }>;
        counts: { ok: number; error: number };
        saved: number;
      },
      error: null,
    };
  } catch (e) {
    if (e instanceof ApiError) return { result: null, error: detailOf(e) };
    throw e;
  }
}
