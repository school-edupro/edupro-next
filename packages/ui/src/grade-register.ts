// GENERATED from packages/db/src/grade-register.ts by scripts/sync-mark-register.mjs — do not edit.
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

// ---- Run: student-wise, Grade summary, Analysis (docs/design/69, part 3) ----------------------------

const stuCell = (def: GradeRegisterDef, g: string | undefined): SheetCell =>
  g?.trim() ? { t: g.trim(), center: true } : { t: def.blankText, tone: 'none', center: true };

/**
 * Student-wise: a table per student — area, indicator, its rated item, a column per term — with an
 * Overall row after each area when asked. `place` names each student's table in a PDF (a page each).
 */
export function buildStudentWise(
  input: GradeSheetInput,
  placeOf: (s: GradeStudent) => string = () => input.place,
): Sheet[] {
  const { def, areas, exams } = input;
  const withOverall = def.overall !== 'off';
  return orderGradeStudents(input.students, def).map((s, n) => {
    const body: Sheet['body'] = [];
    for (const a of areas) {
      let firstArea = true;
      for (const it of a.items) {
        let firstItem = true;
        for (const l of it.leaves) {
          body.push({
            studentId: `${s.id}-${l.id}`,
            cells: [
              { t: firstArea ? a.name || 'Indicators' : '', text: true, strong: firstArea },
              { t: firstItem ? (it.single ? l.name : it.name) : '', text: true, wrap: true },
              {
                t: it.single
                  ? (def.labels[l.id] ?? l.description ?? '')
                  : def.labels[l.id] || l.name,
                text: true,
                wrap: true,
              },
              ...exams.map((e) => stuCell(def, input.grade(l.id, e.examId, s.id))),
            ],
          });
          firstArea = false;
          firstItem = false;
        }
      }
      if (withOverall)
        body.push({
          studentId: `${s.id}-overall-${a.key}`,
          cells: [
            { t: '', text: true },
            { t: `Overall — ${a.name || 'Indicators'}`, text: true, strong: true, span: 2 },
            ...exams.map((e): SheetCell => {
              const o = overallOf(
                a.items.flatMap((it) =>
                  it.leaves.map((l) => input.grade(l.id, e.examId, s.id) ?? ''),
                ),
                def,
              );
              return o
                ? { t: o, tone: 'calc', center: true, strong: true }
                : { t: def.blankText, tone: 'none', center: true };
            }),
          ],
        });
    }
    return {
      place: placeOf(s),
      title: `${String(n + 1)}. ${s.name} · Adm ${s.adm} · Roll ${s.roll === null ? '—' : String(s.roll)}`,
      head: [
        [
          { t: 'Area' },
          { t: 'Indicator' },
          { t: 'Description' },
          ...exams.map((e) => ({ t: e.label, title: e.name, center: true })),
        ],
      ],
      body,
      foot: null,
      frozen: 0,
      widths: [10, 16, 24, ...exams.map(() => 4)],
    };
  });
}

/** the grades a summary counts: the scale's (in its order), then any other given, A→Z */
function gradeColumns(def: GradeRegisterDef, given: string[]) {
  const scale = def.scale.map((x) => x.g.trim()).filter(Boolean);
  const inScale = new Set(scale.map(norm));
  const others = [...new Set(given.map((g) => g.trim()).filter((g) => g && !inScale.has(norm(g))))]
    .map(norm)
    .filter((g, i, all) => all.indexOf(g) === i)
    .sort((a, b) => a.localeCompare(b));
  return [
    ...scale.map((g) => ({ key: norm(g), label: g })),
    ...others.map((g) => ({ key: g, label: scale.length ? `${g} (other)` : g })),
  ];
}

const studentRows = (list: GradeStudent[]) =>
  list.map((s, i) => [String(i + 1), s.name, s.adm, s.roll === null ? '—' : String(s.roll)]);

/**
 * Grade summary: for each indicator (and the Overall of each area) and term, how many students got
 * each grade, how many are blank, and of how many; a count opens its students.
 */
export function gradeSummary(input: GradeSheetInput): Sheet {
  const { def, areas, exams } = input;
  const students = orderGradeStudents(input.students, def);
  const T = exams.length;
  type Line = {
    area: string;
    item: string;
    leaf: string;
    exam: (typeof exams)[number];
    got: Map<string, string>;
  };
  const lines: Line[] = [];
  for (const a of areas) {
    for (const it of a.items)
      for (const l of it.leaves)
        for (const e of exams)
          lines.push({
            area: a.name,
            item: it.single ? l.name : it.name,
            leaf: it.single ? (def.labels[l.id] ?? '') : def.labels[l.id] || l.name,
            exam: e,
            got: new Map(
              students.map((s) => [s.id, input.grade(l.id, e.examId, s.id)?.trim() ?? '']),
            ),
          });
    if (def.overall !== 'off')
      for (const e of exams)
        lines.push({
          area: a.name,
          item: 'Overall',
          leaf: '',
          exam: e,
          got: new Map(
            students.map((s) => [
              s.id,
              overallOf(
                a.items.flatMap((it) =>
                  it.leaves.map((l) => input.grade(l.id, e.examId, s.id) ?? ''),
                ),
                def,
              ) ?? '',
            ]),
          ),
        });
  }
  const cols = gradeColumns(
    def,
    lines.flatMap((x) => [...x.got.values()]),
  );
  const drill = (title: string, ids: string[]): SheetCell['drill'] => ({
    title,
    cols: ['#', 'Student', 'Adm No', 'Roll No'],
    rows: studentRows(students.filter((s) => ids.includes(s.id))),
  });
  const body = lines.map((x, i) => {
    const of = (key: string | null) =>
      students.filter((s) => {
        const g = x.got.get(s.id) ?? '';
        return key === null ? !g : g && norm(g) === key;
      });
    const what = `${x.item}${x.leaf ? ` · ${x.leaf}` : ''}${T > 1 ? ` · ${x.exam.label}` : ''}`;
    const count = (list: GradeStudent[], label: string): SheetCell =>
      list.length
        ? {
            t: String(list.length),
            center: true,
            drill: drill(
              `${what}: ${label}`,
              list.map((s) => s.id),
            ),
          }
        : { t: '0', center: true, tone: 'none' };
    return {
      studentId: `line-${String(i)}`,
      cells: [
        { t: x.area, text: true },
        { t: x.item, text: true, strong: x.item === 'Overall', wrap: true },
        { t: x.leaf, text: true, wrap: true },
        ...(T > 1 ? [{ t: x.exam.label, center: true, title: x.exam.name }] : []),
        ...cols.map((c) => count(of(c.key), c.label)),
        count(of(null), 'blank'),
        { t: String(students.length), center: true },
      ],
    };
  });
  return {
    place: input.place,
    title: 'Grade summary',
    head: [
      [
        { t: 'Area' },
        { t: 'Indicator' },
        { t: 'Description' },
        ...(T > 1 ? [{ t: 'Term' }] : []),
        ...cols.map((c) => ({ t: c.label, center: true })),
        { t: 'Blank', center: true },
        { t: 'Students', center: true },
      ],
    ],
    body,
    foot: null,
    frozen: 0,
    widths: [10, 14, 18, ...(T > 1 ? [4] : []), ...cols.map(() => 4), 4, 5],
  };
}

/** one row of an analysis: what it counts, and the grades given (blanks apart) */
export interface GradeStat {
  area: string;
  /** the area's line, an indicator under it, or the area's Overall */
  line: string;
  kind: 'area' | 'item' | 'overall';
  exam: string;
  counts: Map<string, { label: string; n: number }>;
  graded: number;
  blank: number;
}

/** The analysis's rows: per area (all its indicators × students), per indicator, and the Overall. */
export function gradeStats(input: GradeSheetInput): GradeStat[] {
  const { def, areas, exams } = input;
  const out: GradeStat[] = [];
  const tally = (grades: string[]) => {
    const counts = new Map<string, { label: string; n: number }>();
    let blank = 0;
    for (const g0 of grades) {
      const g = g0.trim();
      if (!g) {
        blank += 1;
        continue;
      }
      const c = counts.get(norm(g));
      if (c) c.n += 1;
      else counts.set(norm(g), { label: g, n: 1 });
    }
    return { counts, graded: grades.length - blank, blank };
  };
  for (const e of exams)
    for (const a of areas) {
      const of = (leaves: GradeLeaf[]) =>
        leaves.flatMap((l) => input.students.map((s) => input.grade(l.id, e.examId, s.id) ?? ''));
      out.push({
        area: a.name,
        line: a.name || 'Indicators',
        kind: 'area',
        exam: e.label,
        ...tally(of(a.items.flatMap((it) => it.leaves))),
      });
      for (const it of a.items)
        out.push({
          area: a.name,
          line: it.name,
          kind: 'item',
          exam: e.label,
          ...tally(of(it.leaves)),
        });
      if (def.overall !== 'off')
        out.push({
          area: a.name,
          line: `Overall — ${a.name || 'Indicators'}`,
          kind: 'overall',
          exam: e.label,
          ...tally(
            input.students.map(
              (s) =>
                overallOf(
                  a.items.flatMap((it) =>
                    it.leaves.map((l) => input.grade(l.id, e.examId, s.id) ?? ''),
                  ),
                  def,
                ) ?? '',
            ),
          ),
        });
    }
  return out;
}

const pct = (n: number, of: number) => (of ? `${((n / of) * 100).toFixed(1)}%` : '—');

/** Analysis of a section: % of each grade (of the grades given) per area, indicator and Overall. */
export function gradeAnalysis(input: GradeSheetInput): Sheet {
  const { def, exams } = input;
  const stats = gradeStats(input);
  const T = exams.length;
  const cols = gradeColumns(
    def,
    stats.flatMap((x) => [...x.counts.values()].map((c) => c.label)),
  );
  return {
    place: input.place,
    title: 'Analysis',
    note: 'A grade’s % is of the grades given (blanks left out); an area counts all its indicators for every student.',
    head: [
      [
        { t: 'Area / indicator' },
        ...(T > 1 ? [{ t: 'Term' }] : []),
        ...cols.map((c) => ({ t: c.label, center: true })),
        { t: 'Graded', center: true },
        { t: 'Blank', center: true },
      ],
    ],
    body: stats.map((x, i) => ({
      studentId: `stat-${String(i)}`,
      cells: [
        {
          t: x.kind === 'item' ? `   ${x.line}` : x.line,
          text: true,
          strong: x.kind !== 'item',
          ...(x.kind === 'overall' ? { tone: 'calc' as const } : {}),
        },
        ...(T > 1 ? [{ t: x.exam, center: true }] : []),
        ...cols.map((c) => {
          const n = x.counts.get(c.key)?.n ?? 0;
          return { t: n ? `${pct(n, x.graded)} (${String(n)})` : '—', center: true };
        }),
        { t: String(x.graded), center: true },
        { t: String(x.blank), center: true },
      ],
    })),
    foot: null,
    frozen: 0,
    widths: [22, ...(T > 1 ? [4] : []), ...cols.map(() => 7), 5, 5],
  };
}

/** Analysis of every section side by side: per area and Overall (and term), a column per section. */
export function gradeAnalysisAll(
  place: string,
  sections: Array<{ place: string; stats: GradeStat[] | null }>,
  exams: Array<{ label: string }>,
): Sheet {
  const T = exams.length;
  const keys: Array<{ line: string; exam: string; kind: GradeStat['kind'] }> = [];
  for (const s of sections)
    for (const x of s.stats ?? [])
      if (x.kind !== 'item' && !keys.some((k) => k.line === x.line && k.exam === x.exam))
        keys.push({ line: x.line, exam: x.exam, kind: x.kind });
  const text = (x: GradeStat | undefined) => {
    if (!x || !x.graded) return 'no grades';
    const parts = [...x.counts.values()]
      .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
      .map((c) => `${c.label} ${pct(c.n, x.graded)}`);
    return `${parts.join(' · ')} (${String(x.graded)})`;
  };
  return {
    place,
    title: 'Analysis — all sections',
    note: 'Each grade’s % of the grades given in the section, most given first; (n) = grades given.',
    head: [
      [
        { t: 'Area' },
        ...(T > 1 ? [{ t: 'Term' }] : []),
        ...sections.map((s) => ({ t: s.place, center: true })),
      ],
    ],
    body: keys.map((k, i) => ({
      studentId: `all-${String(i)}`,
      cells: [
        {
          t: k.line,
          text: true,
          strong: true,
          ...(k.kind === 'overall' ? { tone: 'calc' as const } : {}),
        },
        ...(T > 1 ? [{ t: k.exam, center: true }] : []),
        ...sections.map((s) => ({
          t: s.stats
            ? text(s.stats.find((x) => x.line === k.line && x.exam === k.exam))
            : 'could not be read',
          text: true,
          wrap: true,
        })),
      ],
    })),
    foot: null,
    frozen: 0,
    widths: [16, ...(T > 1 ? [4] : []), ...sections.map(() => 14)],
  };
}
