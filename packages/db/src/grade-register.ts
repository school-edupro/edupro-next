/**
 * Grade registers (docs/design/69, parts 2–3): the school's legacy Grade Register — the indicator grades
 * of some classes for some exams — as a class sheet (a row per student, a column per indicator and exam,
 * an Overall per area) or student-wise (a block per student). Pure: the API runs it on the entries, the
 * builder's preview on sample students (copied to packages/ui by scripts/sync-mark-register.mjs).
 *
 * The tree comes from the indicator sets the classes use in the exams: an area (the areas master) holds
 * items; an item is a heading with sub-items, or rated itself. The register's columns are the rated
 * ones (leaves) not left out, in the register's own order, then the master's.
 */
import type { Sheet, SheetCell } from './mark-register';

export type GradeStudentCol = 'sr' | 'name' | 'roll' | 'adm';

export interface GradeRegisterDef {
  v: 1;
  /** the assessments in print order, each with its short header (T1, PT1 …) */
  exams: Array<{ examId: string; label: string }>;
  /** areas left out (their key: the name in small letters; '' = no area) */
  exAreas: string[];
  /** indicators left out (ids); one added to a set later shows by itself */
  exLeaves: string[];
  /** a short header for an indicator (id → label) */
  labels: Record<string, string>;
  /** the register's own order: areas; per area its items; per heading its sub-items */
  order: { areas: string[]; items: Record<string, string[]>; leaves: Record<string, string[]> };
  orderBy: 'roll' | 'alpha';
  /** the indicator's header: its text (or short label), or D1, D2 … with a legend */
  descHeader: 'full' | 'number';
  showLegend: boolean;
  properCase: boolean;
  /** printed for a grade not given */
  blankText: string;
  /** an Overall per area: off, the most frequent grade, or by the points of the scale */
  overall: 'off' | 'mode' | 'points';
  /** the grade scale, best first (points for the points rule) */
  scale: Array<{ g: string; p: number | null }>;
  studentCols: Array<{ key: GradeStudentCol; show: boolean }>;
}

/** a rated indicator, with where it sits */
export interface GradeLeaf {
  id: string;
  name: string;
  description: string | null;
  /** the area's name ('' when it has none) */
  area: string;
  /** its heading (a sub-item), or null when the item is rated itself */
  itemId: string | null;
  itemName: string | null;
  setName: string;
}
export interface GradeTree {
  /** the areas in the master's order */
  areas: Array<{ key: string; name: string }>;
  /** in the master's order (area, item, sub-item) */
  leaves: GradeLeaf[];
}

export interface ArrangedItem {
  /** the heading's id, or the leaf's own when rated itself */
  key: string;
  name: string;
  /** rated itself: the item is its own column */
  single: boolean;
  leaves: GradeLeaf[];
}
export interface ArrangedArea {
  key: string;
  name: string;
  items: ArrangedItem[];
}

export interface GradeStudent {
  id: string;
  name: string;
  adm: string;
  roll: number | null;
}

export const areaKey = (name: string) => name.trim().toLowerCase();

export function newGradeDef(): GradeRegisterDef {
  return {
    v: 1,
    exams: [],
    exAreas: [],
    exLeaves: [],
    labels: {},
    order: { areas: [], items: {}, leaves: {} },
    orderBy: 'roll',
    descHeader: 'full',
    showLegend: true,
    properCase: true,
    blankText: '',
    overall: 'off',
    scale: [],
    studentCols: [
      { key: 'sr', show: true },
      { key: 'adm', show: true },
      { key: 'roll', show: true },
      { key: 'name', show: true },
    ],
  };
}

/**
 * A scale from indicator levels: letter grades (A, B+, …) are written best first, word levels
 * (Beginner, Progressing, Proficient) lowest first; points count down from the best.
 */
export function scaleFromLevels(levels: string[]): GradeRegisterDef['scale'] {
  const uniq = [...new Set(levels.map((x) => x.trim()).filter(Boolean))];
  const letters = uniq.every((x) => /^[A-Ea-e][+-]?[0-9]?$/.test(x));
  const best = letters ? uniq : [...uniq].reverse();
  return best.map((g, i) => ({ g, p: best.length - i }));
}

/** What keeps a register from being saved or locked, in the user's words. */
export function gradeProblems(def: GradeRegisterDef, tree?: GradeTree): string[] {
  const out: string[] = [];
  if (!def.exams.length) out.push('Choose at least one assessment');
  if (def.exams.some((e) => e.label.length > 20)) out.push('A header label is over 20 letters');
  if (new Set(def.exams.map((e) => e.examId)).size !== def.exams.length)
    out.push('An assessment is there twice');
  if (def.blankText.length > 5) out.push('The text for a blank grade is over 5 letters');
  if (Object.values(def.labels).some((x) => x.length > 60))
    out.push('A short label is over 60 letters');
  if (def.scale.length > 15) out.push('The grade scale has more than 15 grades');
  if (def.overall === 'points' && def.scale.filter((x) => x.p !== null).length < 2)
    out.push('The points rule needs two or more grades with points');
  if (!def.studentCols.some((x) => x.key === 'name' && x.show))
    out.push('The student name is always shown');
  if (tree && !arrange(tree, def).some((a) => a.items.length))
    out.push('Tick at least one indicator');
  return out;
}

/** a list in the register's order first, then in the master's */
function byOrder<T>(list: T[], key: (x: T) => string, order: string[] | undefined): T[] {
  if (!order?.length) return list;
  const at = new Map(order.map((k, i) => [k, i]));
  return list
    .map((x, i) => ({ x, i, o: at.get(key(x)) }))
    .sort((a, b) => (a.o ?? 1e6 + a.i) - (b.o ?? 1e6 + b.i))
    .map((y) => y.x);
}

/** The register's columns: areas → items → leaves, in its order, without what is left out. */
export function arrange(tree: GradeTree, def: GradeRegisterDef, keep?: (l: GradeLeaf) => boolean) {
  const outAreas = new Set(def.exAreas);
  const outLeaves = new Set(def.exLeaves);
  const areas: ArrangedArea[] = [];
  const names = new Map(tree.areas.map((a) => [a.key, a.name]));
  const areaKeys = [...new Set(tree.leaves.map((l) => areaKey(l.area)))].sort(
    (a, b) =>
      tree.areas.findIndex((x) => x.key === a) - tree.areas.findIndex((x) => x.key === b) ||
      a.localeCompare(b),
  );
  for (const ak of byOrder(areaKeys, (k) => k, def.order.areas)) {
    if (outAreas.has(ak)) continue;
    const leaves = tree.leaves.filter(
      (l) => areaKey(l.area) === ak && !outLeaves.has(l.id) && (!keep || keep(l)),
    );
    const items: ArrangedItem[] = [];
    for (const l of leaves) {
      const key = l.itemId ?? l.id;
      let it = items.find((x) => x.key === key);
      if (!it) {
        it = { key, name: l.itemName ?? l.name, single: !l.itemId, leaves: [] };
        items.push(it);
      }
      it.leaves.push(l);
    }
    for (const it of items) it.leaves = byOrder(it.leaves, (l) => l.id, def.order.leaves[it.key]);
    const sorted = byOrder(items, (x) => x.key, def.order.items[ak]);
    if (sorted.length)
      areas.push({
        key: ak,
        name: names.get(ak) ?? leaves[0]?.area ?? ak,
        items: sorted,
      });
  }
  return areas;
}

const norm = (g: string) => g.trim().toUpperCase();

/**
 * The Overall of a student's grades in an area and exam: blanks are left out; the most frequent
 * grade (a tie goes to the grade higher in the scale, then A→Z), or the scale grade whose points are
 * nearest the average of the points (grades not in the scale left out; a tie goes to the higher points).
 */
export function overallOf(grades: string[], def: GradeRegisterDef): string | null {
  const got = grades.map((g) => g.trim()).filter(Boolean);
  if (!got.length || def.overall === 'off') return null;
  const scaleAt = new Map(def.scale.map((x, i) => [norm(x.g), i]));
  if (def.overall === 'mode') {
    const count = new Map<string, { n: number; label: string }>();
    for (const g of got) {
      const k = norm(g);
      const c = count.get(k);
      if (c) c.n += 1;
      else count.set(k, { n: 1, label: g });
    }
    const best = [...count.entries()].sort(
      (a, b) =>
        b[1].n - a[1].n ||
        (scaleAt.get(a[0]) ?? 1e6) - (scaleAt.get(b[0]) ?? 1e6) ||
        a[0].localeCompare(b[0]),
    )[0]!;
    return best[1].label;
  }
  const pts = new Map(
    def.scale.filter((x) => x.p !== null).map((x) => [norm(x.g), { g: x.g, p: x.p! }]),
  );
  if (pts.size < 2) return null;
  const vals = got.map((g) => pts.get(norm(g))?.p).filter((p): p is number => p !== undefined);
  if (!vals.length) return null;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const near = [...pts.values()].sort(
    (a, b) => Math.abs(a.p - avg) - Math.abs(b.p - avg) || b.p - a.p,
  )[0]!;
  return near.g;
}

/** names typed all in capitals (or all small) in proper case */
export function properName(name: string) {
  return name === name.toUpperCase() || name === name.toLowerCase()
    ? name
        .toLowerCase()
        .replace(/(^|[\s'.-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase())
    : name;
}

const ID_COL: Record<GradeStudentCol, { t: string; w: number }> = {
  sr: { t: 'Sr', w: 3 },
  adm: { t: 'Adm No', w: 7 },
  roll: { t: 'Roll No', w: 4 },
  name: { t: 'Student', w: 16 },
};

export interface GradeSheetInput {
  place: string;
  areas: ArrangedArea[];
  def: GradeRegisterDef;
  /** the assessments shown, in order, each with its header */
  exams: Array<{ examId: string; label: string; name: string }>;
  students: GradeStudent[];
  /** a student's grade for an indicator in an exam: `${leafId}|${examId}` → studentId → grade */
  grade: (leafId: string, examId: string, studentId: string) => string | undefined;
}

/** the leaves' numbers (D1, D2 …) across the sheet, for the numbered header and the legend */
function numbered(areas: ArrangedArea[]) {
  const n = new Map<string, number>();
  for (const a of areas)
    for (const it of a.items) for (const l of it.leaves) n.set(l.id, n.size + 1);
  return n;
}

export function orderGradeStudents(students: GradeStudent[], def: GradeRegisterDef) {
  const list = def.properCase
    ? students.map((s) => ({ ...s, name: properName(s.name) }))
    : [...students];
  if (def.orderBy === 'alpha') list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

/** what the term header says (T1 = PT1 · Periodic Test 1 …), when there are two or more */
export function gradeLegendNote(exams: GradeSheetInput['exams']) {
  return exams.length > 1 ? exams.map((e) => `${e.label} = ${e.name}`).join(' · ') : undefined;
}

/**
 * The class sheet: header rows area, indicator, its rated items (D-numbers or text), the terms (two or
 * more); a row per student; an Overall block after each area when asked. With the numbered header and
 * the legend on, a legend table follows.
 */
export function buildGradeSheet(input: GradeSheetInput): Sheet[] {
  const { def, areas, exams, place } = input;
  const T = exams.length;
  const cols = def.studentCols.filter((c) => c.show || c.key === 'name');
  const nums = numbered(areas);
  const headRows = 3 + (T > 1 ? 1 : 0);
  const withOverall = def.overall !== 'off';
  const row1: SheetCell[] = cols.map((c) => ({
    t: ID_COL[c.key].t,
    rows: headRows,
    center: c.key !== 'name',
  }));
  const row2: SheetCell[] = [];
  const row3: SheetCell[] = [];
  const row4: SheetCell[] = [];
  const widths = cols.map((c) => ID_COL[c.key].w);
  const header = (l: GradeLeaf) =>
    def.descHeader === 'number' ? `D${String(nums.get(l.id))}` : def.labels[l.id] || l.name;
  for (const a of areas) {
    const leafCount = a.items.reduce((n, it) => n + it.leaves.length, 0);
    row1.push({ t: a.name || 'Indicators', span: (leafCount + (withOverall ? 1 : 0)) * T });
    for (const it of a.items) {
      if (it.single) {
        const l = it.leaves[0]!;
        row2.push({ t: header(l), span: T, rows: 2, title: l.description ?? l.name });
      } else {
        row2.push({ t: it.name, span: it.leaves.length * T });
        for (const l of it.leaves)
          row3.push({ t: header(l), span: T, title: l.description ?? l.name });
      }
      for (let k = 0; k < it.leaves.length; k += 1) {
        if (T > 1) for (const e of exams) row4.push({ t: e.label, title: e.name });
        for (let i = 0; i < T; i += 1) widths.push(3);
      }
    }
    if (withOverall) {
      row2.push({ t: 'Overall', span: T, rows: 2, title: overallTitle(def) });
      if (T > 1) for (const e of exams) row4.push({ t: e.label, title: e.name });
      for (let i = 0; i < T; i += 1) widths.push(3);
    }
  }
  const head = [row1, row2, row3, ...(T > 1 ? [row4] : [])];
  const blank = (): SheetCell => ({ t: def.blankText, tone: 'none', center: true });
  const students = orderGradeStudents(input.students, def);
  const body = students.map((s, n) => {
    const cells: SheetCell[] = cols.map((c) =>
      c.key === 'sr'
        ? { t: String(n + 1), center: true }
        : c.key === 'adm'
          ? { t: s.adm, text: true, center: true }
          : c.key === 'roll'
            ? { t: s.roll === null ? '—' : String(s.roll), center: true }
            : { t: s.name, text: true },
    );
    for (const a of areas) {
      for (const it of a.items)
        for (const l of it.leaves)
          for (const e of exams) {
            const g = input.grade(l.id, e.examId, s.id)?.trim();
            cells.push(g ? { t: g, center: true } : blank());
          }
      if (withOverall)
        for (const e of exams) {
          const all = a.items.flatMap((it) =>
            it.leaves.map((l) => input.grade(l.id, e.examId, s.id) ?? ''),
          );
          const o = overallOf(all, def);
          cells.push(o ? { t: o, tone: 'calc', center: true, strong: true } : blank());
        }
    }
    return { studentId: s.id, cells };
  });
  const sheet: Sheet = {
    place,
    note: def.showLegend ? gradeLegendNote(exams) : undefined,
    head,
    body,
    foot: null,
    frozen: cols.length,
    widths,
  };
  const out = [sheet];
  if (def.descHeader === 'number' && def.showLegend) out.push(legendSheet(place, areas, nums));
  return out;
}

function overallTitle(def: GradeRegisterDef) {
  return def.overall === 'mode'
    ? 'The grade given most often in the area (a tie: the better grade)'
    : 'The grade nearest the average points of the area’s grades';
}

function legendSheet(place: string, areas: ArrangedArea[], nums: Map<string, number>): Sheet {
  const body: Sheet['body'] = [];
  for (const a of areas)
    for (const it of a.items)
      for (const l of it.leaves)
        body.push({
          studentId: `legend-${l.id}`,
          cells: [
            { t: `D${String(nums.get(l.id))}`, center: true },
            { t: a.name, text: true },
            // an item rated itself is the indicator; under a heading, the item is the description
            { t: it.single ? l.name : it.name, text: true, wrap: true },
            {
              t: it.single
                ? (l.description ?? '')
                : l.description
                  ? `${l.name} — ${l.description}`
                  : l.name,
              text: true,
              wrap: true,
            },
          ],
        });
  return {
    place,
    title: 'Legend',
    head: [[{ t: '#' }, { t: 'Area' }, { t: 'Indicator' }, { t: 'Description' }]],
    body,
    foot: null,
    frozen: 0,
    widths: [3, 12, 16, 30],
  };
}

/** Sample students for the builder's preview: grades from the scale (or A, B, C), some left blank. */
export function sampleGradeData(areas: ArrangedArea[], def: GradeRegisterDef) {
  const grades = def.scale.length ? def.scale.map((x) => x.g) : ['A', 'B', 'C'];
  const students: GradeStudent[] = [
    { id: 's1', name: 'Asha Verma', adm: 'A101', roll: 1 },
    { id: 's2', name: 'BHANU PRATAP', adm: 'A102', roll: 2 },
    { id: 's3', name: 'Chitra Nair', adm: 'A103', roll: 3 },
  ];
  const leaves = areas.flatMap((a) => a.items.flatMap((it) => it.leaves));
  const grade = (leafId: string, examId: string, studentId: string) => {
    const i = leaves.findIndex((l) => l.id === leafId);
    const s = Number(studentId.slice(1));
    const e = def.exams.findIndex((x) => x.examId === examId);
    if ((i + s + e) % 7 === 6) return undefined;
    return grades[(i + s * 2 + e) % grades.length];
  };
  return { students, grade };
}
