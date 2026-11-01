import {
  cutFixed,
  properCase,
  type RegCell,
  type RegColumn,
  type RegisterDef,
  type RegStudentResult,
  type RegSubject,
  type RegSubjectResult,
} from '@edupro/db';

/**
 * A register as it prints (docs/design/68): the screen, the PDF and the Excel all lay out this one
 * sheet. Two heading rows (the subject over its columns, then each column with its maximum), a row per
 * student (Sr, name, roll, admission no as the register shows them; the section in a merit list), each
 * subject's printed columns (a part breakup in one stacked cell, a grade after a column that asks for
 * one), the subject's total, % and grade, then the final; a class-average row when asked.
 */
export interface SheetCell {
  t: string;
  /** calc: worked out · final: the final result · code: a code in place of marks · star: the value a code gave · none: not taken */
  tone?: 'calc' | 'final' | 'code' | 'star' | 'none' | 'warn';
  title?: string;
  /** a breakup cell: a line per part, the foot last */
  lines?: string[];
  span?: number;
  rows?: number;
  /** text, not a number (left aligned) */
  text?: boolean;
}
export interface Sheet {
  /** the section or class it is for */
  place: string;
  head: SheetCell[][];
  body: Array<{ studentId: string; cells: SheetCell[] }>;
  foot: SheetCell[] | null;
  /** the student's columns (kept in view while scrolling) */
  frozen: number;
  /** each column's share of the width */
  widths: number[];
}
export interface SheetOptions {
  place: string;
  /** every section of a class together, ranked across it */
  merit: boolean;
  /** the merit list grouped by division */
  division: boolean;
  /** one subject's own sheet: its register key */
  subject?: string;
  /** register subject keys, in the order printed */
  order: string[];
  /** a register subject's heading (its subject's name, or the slot's) */
  titles: Record<string, string>;
}

const RESULT: Record<RegStudentResult['result'], string> = {
  pass: 'Pass',
  compartment: 'Compartment',
  fail: 'Fail',
  absent: 'Absent',
  incomplete: 'Incomplete',
};
const SUBJECT_STATUS: Record<RegSubjectResult['status'], string> = {
  pass: 'Pass',
  fail: 'Fail',
  absent: 'Absent',
  incomplete: 'Incomplete',
};

type Printed =
  | { kind: 'member' }
  | { kind: 'col'; col: RegColumn }
  | { kind: 'grade'; col: RegColumn }
  | { kind: 'group'; key: string; label: string; cols: RegColumn[]; foot: 'sum' | 'avg' | 'both' }
  | { kind: 'total' }
  | { kind: 'pct' }
  | { kind: 'sgrade' };

/** what a subject prints, left to right */
function printedOf(s: RegSubject): Printed[] {
  const out: Printed[] = [];
  if (s.slot) out.push({ kind: 'member' });
  const seen = new Set<string>();
  for (const c of s.columns) {
    if (c.hidden) continue;
    if (c.kind === 'part' && c.group && !s.childInColumns) {
      if (seen.has(c.group)) continue;
      seen.add(c.group);
      const cols = s.columns.filter((x) => x.group === c.group && !x.hidden);
      out.push({
        kind: 'group',
        key: c.group,
        label: c.groupLabel ?? 'Parts',
        cols,
        foot: c.groupFoot ?? 'sum',
      });
      continue;
    }
    out.push({ kind: 'col', col: c });
    if (c.grade) out.push({ kind: 'grade', col: c });
  }
  if (s.showTotal !== false) {
    out.push({ kind: 'total' });
    if (s.pct !== false) out.push({ kind: 'pct' });
    if (s.grade !== false) out.push({ kind: 'sgrade' });
  }
  return out;
}

const numDec = (d: 'auto' | 0 | 1 | 2) => d;

/** the maximum a column has for the students shown: one number, or the lowest–highest */
function maxText(vals: number[], dec: 'auto' | 0 | 1 | 2): string {
  const live = [...new Set(vals.filter((v) => v > 0).map((v) => Math.round(v * 100) / 100))];
  if (!live.length) return '';
  const lo = Math.min(...live);
  const hi = Math.max(...live);
  return lo === hi ? cutFixed(lo, dec) : `${cutFixed(lo, dec)}–${cutFixed(hi, dec)}`;
}

function cellText(c: RegCell | undefined, dec: 'auto' | 1 | 2): SheetCell {
  if (!c) return { t: '' };
  if (c.star && c.v !== null) return { t: `${cutFixed(c.v, dec)}*`, tone: 'star' };
  if (c.code) return { t: c.code, tone: 'code' };
  if (c.v === null) return { t: '' };
  return { t: cutFixed(c.v, dec) };
}

const calcKinds = new Set(['avg', 'conv', 'attendance']);

/** Lays a register out for some students (already worked out and in order). */
export function buildSheet(def: RegisterDef, rows: RegStudentResult[], o: SheetOptions): Sheet {
  const d = def.display;
  const dec = numDec(d.decimals) as 'auto' | 1 | 2;
  const fdec = d.finalDecimals === 'auto' ? dec : d.finalDecimals;
  const pdec = d.pctDecimals === 'auto' ? fdec : d.pctDecimals;
  const subjects = o.order
    .map((k) => def.subjects.find((s) => s.key === k))
    .filter((s): s is RegSubject => !!s)
    .filter((s) => !o.subject || s.key === o.subject)
    // a subject nobody here takes is left out (the note on the screen says so)
    .filter((s) => rows.some((r) => r.subjects[s.key]));
  const shown = o.subject ? rows.filter((r) => r.subjects[o.subject!]) : rows;
  const name = (n: string) => (d.properCase ? properCase(n) : n);
  const head1: SheetCell[] = [];
  const head2: SheetCell[] = [];
  const widths: number[] = [];
  const studentCols = d.studentCols.filter((c) => c.show || c.key === 'name');
  const STUDENT: Record<string, [string, number]> = {
    sr: ['Sr', 0.8],
    name: ['Student', 4],
    roll: ['Roll', 1],
    adm: ['Adm no', 1.6],
  };
  for (const c of studentCols) {
    head1.push({ t: STUDENT[c.key]![0], rows: 2, text: true });
    widths.push(STUDENT[c.key]![1]);
  }
  if (o.merit) {
    head1.push({ t: 'Section', rows: 2, text: true });
    widths.push(1.2);
  }
  const frozen = head1.length;

  // the takers' cells of a subject, for the maximum in the heading
  const takers = (key: string) =>
    shown.map((r) => r.subjects[key]).filter((x): x is RegSubjectResult => !!x);

  const vertical = def.layout === 'vertical' && !o.subject;
  type Plan = { title: string; subject: RegSubject | null; printed: Printed[]; position?: number };
  const plans: Plan[] = [];
  if (vertical) {
    // Subject-1, Subject-2 …: each student's own subjects in order; the columns as the first subject's
    const n = Math.max(0, ...shown.map((r) => subjects.filter((s) => r.subjects[s.key]).length));
    const model = subjects[0];
    const printed: Printed[] = [
      { kind: 'member' },
      ...(model ? printedOf(model).filter((p) => p.kind !== 'member') : []),
    ];
    for (let i = 0; i < n; i += 1)
      plans.push({ title: `Subject-${String(i + 1)}`, subject: null, printed, position: i });
  } else
    for (const s of subjects)
      plans.push({ title: o.titles[s.key] ?? s.key, subject: s, printed: printedOf(s) });

  for (const p of plans) {
    const span = p.printed.length;
    if (!span) continue;
    head1.push({ t: p.title, span, text: true });
    for (const x of p.printed) {
      const key = p.subject?.key;
      const list = key ? takers(key) : [];
      const mx = (k: string) =>
        d.showMax && key
          ? maxText(
              list
                .map((r) => r.values[k])
                .filter((c) => c && !c.out)
                .map((c) => c!.max),
              dec,
            )
          : '';
      // a name that already shows its maximum ("Periodic test (15)") is not given it twice
      const withMax = (label: string, m: string) =>
        m && !label.includes(`(${m})`) ? `${label} (${m})` : label;
      switch (x.kind) {
        case 'member':
          head2.push({ t: 'Subject', text: true });
          widths.push(1.1);
          break;
        case 'col':
          head2.push({ t: withMax(x.col.name, mx(x.col.key)) });
          widths.push(1.1);
          break;
        case 'grade':
          head2.push({ t: 'Gr' });
          widths.push(0.8);
          break;
        case 'group':
          head2.push({ t: x.label, text: true });
          widths.push(1.9);
          break;
        case 'total':
          head2.push({
            t: withMax(
              p.subject?.totalLabel ?? 'Total',
              d.showMax && key
                ? maxText(
                    list.map((r) => r.max),
                    dec,
                  )
                : '',
            ),
          });
          widths.push(1.1);
          break;
        case 'pct':
          head2.push({ t: '%' });
          widths.push(1);
          break;
        default:
          head2.push({ t: 'Grade' });
          widths.push(0.9);
      }
    }
  }

  // the final, or the subject's own rank and result
  const f = def.final;
  const finalHeads: Array<[string, number]> = [];
  if (o.subject) finalHeads.push(['Rank', 0.9], ['Result', 1.5]);
  else {
    if (f.total) finalHeads.push(['Total', 1.6]);
    if (f.pct) finalHeads.push(['%', 1]);
    if (f.grade) finalHeads.push(['Grade', 0.9]);
    if (f.rank) finalHeads.push(['Rank', 0.9]);
    if (d.divisionLabel) finalHeads.push(['Division', 1.2]);
    if (f.result) finalHeads.push(['Result', 1.5]);
  }
  if (finalHeads.length) {
    head1.push({ t: o.subject ? 'RESULT' : 'FINAL RESULT', span: finalHeads.length, text: true });
    for (const [t, w] of finalHeads) {
      head2.push({ t, tone: 'final' });
      widths.push(w);
    }
  }

  // a subject's own competition rank (its sheet)
  const subjectRank = new Map<string, number>();
  if (o.subject) {
    const list = shown
      .map((r) => ({ id: r.studentId, x: r.subjects[o.subject!]! }))
      .filter((y) => y.x.total !== null && !y.x.missing && !y.x.withheld)
      .sort((a, b) => b.x.total! - a.x.total!);
    let rank = 0;
    let prev: number | null = null;
    list.forEach((y, i) => {
      if (prev === null || Math.abs(y.x.total! - prev) > 1e-9) rank = i + 1;
      prev = y.x.total!;
      subjectRank.set(y.id, rank);
    });
  }

  const subjectCells = (
    x: RegSubjectResult | undefined,
    s: RegSubject | undefined,
    printed: Printed[],
  ): SheetCell[] => {
    if (!x || !s)
      return printed.map(() => ({ t: d.blankNotTaken ? '' : '—', tone: 'none' as const }));
    const own = printedOf(s);
    // a vertical register prints each student's subject by position under the first subject's columns
    const list =
      printed[0]?.kind === 'member' && !s.slot ? [{ kind: 'member' } as Printed, ...own] : own;
    return printed.map((_, i) => {
      const p = list[i];
      if (!p) return { t: '' };
      switch (p.kind) {
        case 'member':
          return {
            t: x.code,
            text: true,
            ...(x.twoMembers
              ? {
                  tone: 'warn' as const,
                  title: 'Has two of the slot’s subjects: check the subject choices',
                }
              : {}),
          };
        case 'col': {
          const c = cellText(x.values[p.col.key], dec);
          return calcKinds.has(p.col.kind) && !c.tone ? { ...c, tone: 'calc' } : c;
        }
        case 'grade':
          return { t: x.values[p.col.key]?.grade ?? '', tone: 'calc' };
        case 'group': {
          const lines = p.cols.map((c) => {
            const v = x.values[c.key];
            const short = c.name.slice(0, 4).toUpperCase();
            const t = cellText(v, dec).t;
            return `${short} ${t}${d.childMax && v && v.max > 0 && t ? ` / ${cutFixed(v.max, dec)}` : ''}`;
          });
          const vals = p.cols
            .map((c) => x.values[c.key])
            .filter((v): v is RegCell => !!v && !v.out);
          const got = vals.reduce((a, v) => a + (v.v ?? 0), 0);
          const of = vals.reduce((a, v) => a + v.max, 0);
          const sum = `Sum ${cutFixed(got, dec)}${d.childMax ? ` / ${cutFixed(of, dec)}` : ''}`;
          const avg = `Avg ${vals.length ? cutFixed(got / vals.length, dec) : ''}`;
          const foot = p.foot === 'both' ? [sum, avg] : p.foot === 'avg' ? [avg] : [sum];
          return { t: [...lines, ...foot].join('\n'), lines: [...lines, ...foot], text: true };
        }
        case 'total':
          return x.withheld
            ? { t: '–', tone: 'warn', title: 'Withheld: a code that holds the total' }
            : { t: x.total === null ? '' : cutFixed(x.total, dec), tone: 'calc' };
        case 'pct':
          return { t: x.pct === null ? '' : cutFixed(x.pct, pdec), tone: 'calc' };
        default:
          return { t: x.grade ?? '', tone: 'calc' };
      }
    });
  };

  const body = shown.map((r, i) => {
    const cells: SheetCell[] = [];
    for (const c of studentCols)
      cells.push(
        c.key === 'sr'
          ? { t: String(i + 1) }
          : c.key === 'name'
            ? { t: name(r.name), text: true }
            : c.key === 'roll'
              ? { t: r.rollNo === null ? '' : String(r.rollNo) }
              : { t: r.admissionNo, text: true },
      );
    if (o.merit) cells.push({ t: r.section, text: true });
    for (const p of plans) {
      if (p.position !== undefined) {
        const mine = subjects.filter((s) => r.subjects[s.key]);
        const s = mine[p.position];
        cells.push(...subjectCells(s ? r.subjects[s.key] : undefined, s, p.printed));
      } else cells.push(...subjectCells(r.subjects[p.subject!.key], p.subject!, p.printed));
    }
    if (o.subject) {
      const x = r.subjects[o.subject]!;
      const rank = subjectRank.get(r.studentId);
      cells.push(
        { t: rank === undefined ? '' : String(rank), tone: 'final' },
        { t: SUBJECT_STATUS[x.status], tone: 'final', text: true },
      );
    } else {
      const withheld = r.withheldBy.length > 0;
      const why = withheld ? `Withheld: ${r.withheldBy.join(', ')}` : undefined;
      if (f.total)
        cells.push({
          t: withheld
            ? '–'
            : r.total === null
              ? ''
              : `${cutFixed(r.total, fdec)}${d.showMax ? ` / ${cutFixed(r.max, fdec)}` : ''}`,
          tone: 'final',
          ...(why ? { title: why } : {}),
        });
      if (f.pct) cells.push({ t: r.pct === null ? '' : cutFixed(r.pct, pdec), tone: 'final' });
      if (f.grade) cells.push({ t: r.grade ?? '', tone: 'final' });
      if (f.rank) {
        const rank = o.merit ? r.rankInClass : r.rankInSection;
        cells.push({ t: rank === null ? '–' : String(rank), tone: 'final' });
      }
      if (d.divisionLabel) cells.push({ t: r.division ?? '', tone: 'final', text: true });
      if (f.result)
        cells.push({
          t: RESULT[r.result],
          tone: 'final',
          text: true,
          ...(why ? { title: why } : {}),
        });
    }
    return { studentId: r.studentId, cells };
  });

  // the class average: each numeric column over the students who have a value
  let foot: SheetCell[] | null = null;
  if (d.averages && !vertical && body.length) {
    foot = [];
    for (const c of studentCols)
      foot.push({ t: c.key === 'name' ? 'Class average' : '', text: true });
    if (o.merit) foot.push({ t: '' });
    const avg = (vals: Array<number | null | undefined>, dd: 'auto' | 0 | 1 | 2) => {
      const live = vals.filter((v): v is number => typeof v === 'number');
      return live.length ? cutFixed(live.reduce((a, b) => a + b, 0) / live.length, dd) : '';
    };
    for (const p of plans) {
      const key = p.subject!.key;
      const list = takers(key);
      for (const x of p.printed)
        foot.push(
          x.kind === 'col'
            ? {
                t: avg(
                  list.map((s) => (s.values[x.col.key]?.out ? null : s.values[x.col.key]?.v)),
                  fdec,
                ),
                tone: 'calc',
              }
            : x.kind === 'total'
              ? {
                  t: avg(
                    list.map((s) => s.total),
                    fdec,
                  ),
                  tone: 'calc',
                }
              : x.kind === 'pct'
                ? {
                    t: avg(
                      list.map((s) => s.pct),
                      pdec,
                    ),
                    tone: 'calc',
                  }
                : { t: '' },
        );
    }
    if (o.subject) foot.push({ t: '' }, { t: '' });
    else {
      if (f.total)
        foot.push({
          t: avg(
            shown.map((r) => r.total),
            fdec,
          ),
          tone: 'final',
        });
      if (f.pct)
        foot.push({
          t: avg(
            shown.map((r) => r.pct),
            pdec,
          ),
          tone: 'final',
        });
      for (const on of [f.grade, f.rank, d.divisionLabel, f.result]) if (on) foot.push({ t: '' });
    }
  }
  return { place: o.place, head: [head1, head2], body, foot, frozen, widths };
}

/** the merit list by division: 1st Div, 2nd Div, Pass, then compartment, fail, absent, incomplete */
export function byDivision(def: RegisterDef, rows: RegStudentResult[]): RegStudentResult[] {
  const divs = [...def.divisions].sort((a, b) => b.minPct - a.minPct).map((x) => x.name);
  const rest = ['compartment', 'fail', 'absent', 'incomplete'];
  const at = (r: RegStudentResult) =>
    r.result === 'pass'
      ? r.division
        ? divs.indexOf(r.division)
        : divs.length
      : divs.length + 1 + rest.indexOf(r.result);
  return [...rows].sort(
    (a, b) =>
      at(a) - at(b) ||
      (a.rankInClass ?? Infinity) - (b.rankInClass ?? Infinity) ||
      a.name.localeCompare(b.name),
  );
}
