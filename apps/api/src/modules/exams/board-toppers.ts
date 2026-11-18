import {
  round2,
  yearLabel,
  type AnCandidate,
  type AnSubject,
  type BoardRules,
} from './board-analysis';
import { marksRows, type MarksMethod, type MarksRow } from './board-marks';

/**
 * The Topper Report of the Reports tab (docs/design/88), the school's old "Topper Report": the class's toppers by
 * the aggregate (best five, first five or all subjects) and each subject's toppers by its marks, with the lowest
 * scorers and a percentage list when asked. Ranks are dense (equal marks share a rank: 1, 1, 2, 3, 3, 4), so "top 5"
 * is the top five ranks and may hold more than five students — the lists say both. A section or gender filter
 * ranks within that group; the class rank is kept beside it. The old report's faults are put right: one subject a
 * code (CBSE's own list), a fixed 0–100 scale for the bars, the count of students beside the ranks.
 */

export type ToppersShow = 'overall' | 'subjects' | 'both';

export interface ToppersOptions {
  method: MarksMethod;
  gender: 'all' | 'M' | 'F';
  section?: string | undefined;
  show: ToppersShow;
  /** the subjects shown (none: every subject with marks) */
  codes?: string[] | undefined;
  /** the top ranks listed (0: none) */
  top: number;
  /** the lowest ranks listed (0: none) */
  low: number;
  /** a list of everyone at or above / at or below a percentage */
  pctOp?: 'gte' | 'lte' | undefined;
  pct?: number | undefined;
}

export interface TopperRow {
  /** the rank in the group shown (the class, or the section / gender chosen) */
  rank: number;
  /** the rank in the whole class (the overall list only) */
  classRank: number | null;
  roll: string;
  name: string | null;
  sex: string | null;
  section: string | null;
  marks: number;
  max: number;
  pct: number;
  grade: string | null;
}

export interface TopperList {
  kind: 'top' | 'low' | 'pct';
  /** the ranks asked for (top / low); the list may hold more students than ranks */
  ranks: number | null;
  rows: TopperRow[];
}

export interface ToppersBlock {
  /** null: the class's aggregate */
  code: string | null;
  name: string;
  /** those ranked (with marks) */
  appeared: number;
  max: number;
  lists: TopperList[];
}

export interface ToppersYear {
  examYear: number;
  label: string;
  appeared: number;
  highest: number | null;
  /** students at the first rank */
  atFirst: number;
  /** the lowest percentage inside the top ranks asked */
  cutoff: number | null;
  /** students inside the top ranks asked */
  inTop: number;
  pct95: number;
  pct90: number;
}

export interface ToppersReport {
  overall: ToppersBlock | null;
  subjects: ToppersBlock[];
  /** the year and the saved years compared, oldest first (the overall aggregate) */
  years: ToppersYear[];
}

interface Scored {
  key: MarksRow;
  marks: number;
  max: number;
  pct: number;
  grade: string | null;
  classRank: number | null;
}

/** Dense ranks over the scores given, the highest first. */
function denseRanks<T extends { pct: number }>(xs: T[]): Array<T & { rank: number }> {
  const sorted = [...xs].sort((a, b) => b.pct - a.pct);
  let rank = 0;
  let last: number | null = null;
  return sorted.map((x) => {
    if (x.pct !== last) {
      rank += 1;
      last = x.pct;
    }
    return { ...x, rank };
  });
}

function listsOf(scored: Scored[], o: ToppersOptions, withClassRank: boolean): TopperList[] {
  const ranked = denseRanks(scored);
  const row = (s: Scored & { rank: number }): TopperRow => ({
    rank: s.rank,
    classRank: withClassRank ? s.classRank : null,
    roll: s.key.roll,
    name: s.key.name,
    sex: s.key.sex,
    section: s.key.section,
    marks: s.marks,
    max: s.max,
    pct: s.pct,
    grade: s.grade,
  });
  const byRoll = (a: { key: MarksRow }, b: { key: MarksRow }) =>
    a.key.roll.localeCompare(b.key.roll);
  const lists: TopperList[] = [];
  if (o.top > 0)
    lists.push({
      kind: 'top',
      ranks: o.top,
      rows: ranked
        .filter((s) => s.rank <= o.top)
        .sort((a, b) => a.rank - b.rank || byRoll(a, b))
        .map(row),
    });
  if (o.low > 0) {
    const last = ranked.length ? ranked[ranked.length - 1]!.rank : 0;
    lists.push({
      kind: 'low',
      ranks: o.low,
      // the lowest first
      rows: ranked
        .filter((s) => s.rank > last - o.low)
        .sort((a, b) => b.rank - a.rank || byRoll(a, b))
        .map(row),
    });
  }
  if (o.pctOp && o.pct !== undefined) {
    const cut = o.pct;
    lists.push({
      kind: 'pct',
      ranks: null,
      rows: ranked
        .filter((s) => (o.pctOp === 'gte' ? s.pct >= cut : s.pct <= cut))
        .sort((a, b) => a.rank - b.rank || byRoll(a, b))
        .map(row),
    });
  }
  return lists;
}

const inGroup = (r: MarksRow, o: ToppersOptions) =>
  (o.gender === 'all' || r.sex === o.gender) && (!o.section || r.section === o.section);

/** The overall aggregates of a year's candidates in the group, with the class rank. */
function overallScored(rows: MarksRow[], o: ToppersOptions): Scored[] {
  return rows
    .filter((r) => inGroup(r, o) && r.percent !== null && r.total !== null && r.max !== null)
    .map((r) => ({
      key: r,
      marks: r.total!,
      max: r.max!,
      pct: r.percent!,
      grade: null,
      classRank: r.rank,
    }));
}

export function toppersReport(
  years: Array<{ examYear: number; candidates: AnCandidate[] }>,
  subjects: AnSubject[],
  rules: BoardRules,
  o: ToppersOptions,
): ToppersReport {
  const asked = years[0];
  if (!asked) return { overall: null, subjects: [], years: [] };
  const narrowed = o.gender !== 'all' || Boolean(o.section);
  const rows = marksRows(asked.candidates, subjects, rules, o.method);
  const overallRows = overallScored(rows, o);
  const overall: ToppersBlock | null =
    o.show === 'subjects'
      ? null
      : {
          code: null,
          name: 'Overall',
          appeared: overallRows.length,
          max: overallRows[0]?.max ?? (o.method === 'all' ? 0 : 500),
          lists: listsOf(overallRows, o, narrowed),
        };

  // each subject (in CBSE's printed order), internal subjects left out
  const order = new Map(subjects.map((s, i) => [s.code, i]));
  const kind = new Map(subjects.map((s) => [s.code, s.kind]));
  const blocks: ToppersBlock[] = [];
  if (o.show !== 'overall') {
    const by = new Map<string, Scored[]>();
    for (const r of rows) {
      if (!inGroup(r, o)) continue;
      for (const m of r.subjects) {
        if (m.marks === null || kind.get(m.code) === 'internal') continue;
        if (o.codes?.length && !o.codes.includes(m.code)) continue;
        const list = by.get(m.code) ?? [];
        list.push({
          key: r,
          marks: m.marks,
          max: 100,
          pct: m.marks,
          grade: m.grade,
          classRank: null,
        });
        by.set(m.code, list);
      }
    }
    const codes = [...by.keys()].sort(
      (a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999) || a.localeCompare(b),
    );
    for (const code of codes) {
      const scored = by.get(code)!;
      blocks.push({
        code,
        name: subjects.find((s) => s.code === code)?.name ?? `Subject ${code}`,
        appeared: scored.length,
        max: 100,
        lists: listsOf(scored, o, false),
      });
    }
  }

  // the years compared: the class's (or group's) toppers in figures, oldest first
  const trend = [...years]
    .sort((a, b) => a.examYear - b.examYear)
    .map((y) => {
      const scored = denseRanks(
        overallScored(marksRows(y.candidates, subjects, rules, o.method), o),
      );
      const top = Math.max(1, o.top);
      const inTop = scored.filter((s) => s.rank <= top);
      return {
        examYear: y.examYear,
        label: yearLabel(y.examYear),
        appeared: scored.length,
        highest: scored.length ? round2(scored[0]!.pct) : null,
        atFirst: scored.filter((s) => s.rank === 1).length,
        cutoff: inTop.length ? round2(Math.min(...inTop.map((s) => s.pct))) : null,
        inTop: inTop.length,
        pct95: scored.filter((s) => s.pct >= 95).length,
        pct90: scored.filter((s) => s.pct >= 90).length,
      };
    });

  return { overall, subjects: blocks, years: trend };
}
