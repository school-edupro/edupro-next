/**
 * The statutory files (docs/design/86, phase C step 2; PAYROLL_PAYMENT_SPEC.md §3–4): the PF ECR member lines (the
 * EPFO's 11-field UAN line, and the 8-field arrear line when arrears go separately), their checks, the PF challan's
 * accounts, and the rows of the ESIC monthly upload. Pure: amounts in, lines out.
 */

/** rupees with two places → paise */
export const paise = (v: string | null | undefined) => BigInt((v ?? '0').replace('.', '') || '0');
/** paise → whole rupees, half up (the ECR is in whole rupees) */
export const whole = (p: bigint) => (p >= 0n ? (p + 50n) / 100n : -((-p + 50n) / 100n));
export const rupees = (p: bigint) => {
  const neg = p < 0n;
  const s = (neg ? -p : p).toString().padStart(3, '0');
  return `${neg ? '-' : ''}${s.slice(0, -2)}.${s.slice(-2)}`;
};

/** One payroll record's PF figures (a member may have a regular record and top-ups in the month). */
export interface PfRecord {
  recordId: string;
  employeeId: string;
  code: string;
  name: string;
  uan: string | null;
  isTopUp: boolean;
  gross: string;
  monthDays: string;
  ncpDays: string;
  pfWage: string;
  epsWage: string;
  edliWage: string;
  eePf: string;
  vpf: string;
  erEps: string;
  erEpf: string;
  edli: string;
  admin: string;
  /** arrears this record paid that count for PF, and all its arrears */
  arrearPf: string;
  arrearGross: string;
}
export interface PfRates {
  ee: number;
  er: number;
  eps: number;
  epsCeiling: number;
  edliCeiling: number;
}
export interface EcrLine {
  gross: bigint;
  epf: bigint;
  eps: bigint;
  edli: bigint;
  ee: bigint;
  epsShare: bigint;
  diff: bigint;
  ncp: bigint;
}
export interface EcrMember {
  employeeId: string;
  code: string;
  name: string;
  uan: string;
  recordIds: string[];
  line: EcrLine;
  /** the arrear part, when arrears go in their own file */
  arrear: Omit<EcrLine, 'gross' | 'ncp'> | null;
  problems: string[];
  warnings: string[];
}

/** A name as the ECR takes it: letters, spaces and dots only. */
export function ecrName(name: string): string {
  return name
    .replace(/[^A-Za-z .]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The month's ECR members: each employee's records added together (a regular record and its top-ups), staff
 * without PF left out, every line checked as the EPFO checks it. With `separate`, the arrears paid in the month
 * leave the regular line for an arrear line (the legacy's SEPARATE mode).
 */
export function ecrMembers(records: PfRecord[], rates: PfRates, separate: boolean): EcrMember[] {
  const by = new Map<string, PfRecord[]>();
  for (const r of records) by.set(r.employeeId, [...(by.get(r.employeeId) ?? []), r]);
  const out: EcrMember[] = [];
  for (const recs of by.values()) {
    const sum = (k: keyof PfRecord) => recs.reduce((s, r) => s + paise(r[k] as string), 0n);
    if (sum('pfWage') === 0n && sum('eePf') === 0n && sum('vpf') === 0n) continue;
    const first = recs.find((r) => !r.isTopUp) ?? recs[0]!;
    const monthDays = Number(first.isTopUp ? '0' : first.monthDays);
    const ncpRaw = first.isTopUp ? 0 : Number(first.ncpDays);
    const ncp = BigInt(Math.floor(Math.min(Math.max(ncpRaw, 0), monthDays) + 0.5));
    const vpf = whole(sum('vpf'));
    const line: EcrLine = {
      gross: whole(sum('gross')),
      epf: whole(sum('pfWage')),
      eps: whole(sum('epsWage')),
      edli: whole(sum('edliWage')),
      ee: whole(sum('eePf')) + vpf,
      epsShare: whole(sum('erEps')),
      diff: whole(sum('erEpf')),
      ncp,
    };
    let arrear: EcrMember['arrear'] = null;
    const a = whole(sum('arrearPf'));
    if (separate && a > 0n) {
      const wReg = line.epf - a;
      const epsReg = wReg < line.eps ? wReg : line.eps;
      const edliReg = wReg < line.edli ? wReg : line.edli;
      const round = (w: bigint, rate: number) => BigInt(Math.round(Number(w) * rate));
      const eeReg = round(wReg, rates.ee) + vpf;
      const epsShareReg = line.epsShare === 0n ? 0n : round(epsReg, rates.eps);
      const diffReg = round(wReg, rates.er) - epsShareReg;
      const reg: EcrLine = {
        gross: line.gross - whole(sum('arrearGross')),
        epf: wReg,
        eps: epsReg,
        edli: edliReg,
        ee: eeReg,
        epsShare: epsShareReg,
        diff: diffReg,
        ncp,
      };
      arrear = {
        epf: line.epf - reg.epf,
        eps: line.eps - reg.eps,
        edli: line.edli - reg.edli,
        ee: line.ee - reg.ee,
        epsShare: line.epsShare - reg.epsShare,
        diff: line.diff - reg.diff,
      };
      Object.assign(line, reg);
    }
    const name = ecrName(first.name);
    const problems: string[] = [];
    const warnings: string[] = [];
    const uan = (first.uan ?? '').trim();
    if (name !== first.name.trim()) warnings.push(`the name is sent as "${name}"`);
    if (!/^\d{12}$/.test(uan)) problems.push(uan ? `the UAN ${uan} is not 12 digits` : 'no UAN');
    if (!name) problems.push('no name the ECR can take');
    if (line.epf < line.eps) problems.push('EPF wages are below EPS wages');
    if (line.eps > BigInt(rates.epsCeiling)) problems.push('EPS wages are above the ceiling');
    if (line.edli > BigInt(rates.edliCeiling)) problems.push('EDLI wages are above the ceiling');
    if (line.ncp < 0n || line.ncp > BigInt(Math.ceil(monthDays)))
      problems.push('NCP days out of range');
    if (
      monthDays > 0 &&
      Number(line.ncp) >= monthDays &&
      line.ee + line.epsShare + line.diff !== 0n
    )
      problems.push('no paid day, yet contributions');
    if (arrear) {
      if (arrear.epf < arrear.eps) problems.push('arrear EPF wages are below arrear EPS wages');
      if (arrear.eps > BigInt(rates.epsCeiling))
        problems.push('arrear EPS wages are above the ceiling');
    }
    out.push({
      employeeId: first.employeeId,
      code: first.code,
      name,
      uan,
      recordIds: recs.map((r) => r.recordId),
      line,
      arrear,
      problems,
      warnings,
    });
  }
  return out.sort((x, y) => x.name.localeCompare(y.name) || x.code.localeCompare(y.code));
}

/** The ECR text: one member a line, `#~#` between the 11 fields, no header; LF, none after the last. */
export function ecrText(members: EcrMember[]): string {
  return members
    .map((m) =>
      [
        m.uan,
        m.name,
        m.line.gross,
        m.line.epf,
        m.line.eps,
        m.line.edli,
        m.line.ee,
        m.line.epsShare,
        m.line.diff,
        m.line.ncp,
        0,
      ].join('#~#'),
    )
    .join('\n');
}

/** The arrear ECR: UAN, name, arrear EPF / EPS / EDLI wages, EE share, ER share (the difference), EPS share. */
export function ecrArrearText(members: EcrMember[]): string {
  return members
    .filter((m) => m.arrear && (m.arrear.epf || m.arrear.ee || m.arrear.diff || m.arrear.epsShare))
    .map((m) =>
      [
        m.uan,
        m.name,
        m.arrear!.epf,
        m.arrear!.eps,
        m.arrear!.edli,
        m.arrear!.ee,
        m.arrear!.diff,
        m.arrear!.epsShare,
      ].join('#~#'),
    )
    .join('\n');
}

export interface EcrTotals {
  members: number;
  gross: string;
  epf: string;
  eps: string;
  edli: string;
  ee: string;
  epsShare: string;
  diff: string;
}
export function ecrTotals(members: EcrMember[]): EcrTotals {
  const t = (k: keyof EcrLine) =>
    String(
      members.reduce(
        (s, m) => s + m.line[k] + (m.arrear && k in m.arrear ? m.arrear[k as 'epf'] : 0n),
        0n,
      ),
    );
  return {
    members: members.length,
    gross: t('gross'),
    epf: t('epf'),
    eps: t('eps'),
    edli: t('edli'),
    ee: t('ee'),
    epsShare: t('epsShare'),
    diff: t('diff'),
  };
}

/**
 * The PF challan's accounts over the records: A/c 1 the employee's share, VPF and the employer's EPF difference;
 * A/c 2 the admin charges (at least the minimum); A/c 10 the pension; A/c 21 EDLI (at least the minimum); A/c 22 nil.
 */
export function pfChallan(records: PfRecord[], mins: { admin: string; edli: string }) {
  const sum = (k: keyof PfRecord) => records.reduce((s, r) => s + paise(r[k] as string), 0n);
  const ac1 = sum('eePf') + sum('vpf') + sum('erEpf');
  const adminRaw = sum('admin');
  const edliRaw = sum('edli');
  const any = records.some((r) => paise(r.pfWage) > 0n);
  const ac2 = any && adminRaw < paise(mins.admin) ? paise(mins.admin) : adminRaw;
  const ac21 = any && edliRaw < paise(mins.edli) ? paise(mins.edli) : edliRaw;
  const ac10 = sum('erEps');
  return {
    ac1: rupees(ac1),
    ac2: rupees(ac2),
    ac10: rupees(ac10),
    ac21: rupees(ac21),
    ac22: '0.00',
    total: rupees(ac1 + ac2 + ac10 + ac21),
    adminMinApplied: ac2 !== adminRaw,
    edliMinApplied: ac21 !== edliRaw,
  };
}

/** One record's ESI figures. */
export interface EsiRecord {
  employeeId: string;
  code: string;
  name: string;
  ipNumber: string | null;
  isTopUp: boolean;
  covered: boolean | null;
  esiWage: string;
  esiEe: string;
  esiEr: string;
  paidDays: string;
  leftOn: string | null;
}
export interface EsicRow {
  employeeId: string;
  code: string;
  ip: string;
  name: string;
  days: number;
  wages: string;
  ee: string;
  er: string;
  /** 0 = worked; 1 = on leave all month; 2 = left service (with the last working day) */
  reason: number;
  lastDay: string | null;
  problems: string[];
}
/**
 * The ESIC monthly upload: the covered staff only, each with the days paid, the month's ESI wages (whole rupees),
 * and — when no day was paid — why: left service (with the last working day) or on leave.
 */
export function esicRows(records: EsiRecord[], monthEnd: string): EsicRow[] {
  const by = new Map<string, EsiRecord[]>();
  for (const r of records)
    if (r.covered) by.set(r.employeeId, [...(by.get(r.employeeId) ?? []), r]);
  const out: EsicRow[] = [];
  for (const recs of by.values()) {
    const first = recs.find((r) => !r.isTopUp) ?? recs[0]!;
    const sum = (k: keyof EsiRecord) => recs.reduce((s, r) => s + paise(r[k] as string), 0n);
    const days = first.isTopUp ? 0 : Math.ceil(Number(first.paidDays));
    const left = first.leftOn && first.leftOn <= monthEnd ? first.leftOn : null;
    const reason = days > 0 ? 0 : left ? 2 : 1;
    const ip = (first.ipNumber ?? '').trim();
    const name = ecrName(first.name).replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
    const problems: string[] = [];
    if (!/^\d{10}$/.test(ip))
      problems.push(ip ? `the IP number ${ip} is not 10 digits` : 'no IP number');
    out.push({
      employeeId: first.employeeId,
      code: first.code,
      ip,
      name,
      days,
      wages: String(whole(sum('esiWage'))),
      ee: rupees(sum('esiEe')),
      er: rupees(sum('esiEr')),
      reason,
      lastDay:
        reason === 2 && left
          ? `${left.slice(8, 10)}/${left.slice(5, 7)}/${left.slice(0, 4)}`
          : null,
      problems,
    });
  }
  return out.sort((x, y) => x.name.localeCompare(y.name) || x.code.localeCompare(y.code));
}
