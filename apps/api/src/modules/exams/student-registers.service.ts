import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { STORAGE_DRIVER } from '../files/storage';
import { EXAMS } from './exams.dto';
import { registerPdf, registerXlsx } from './mark-register-file';
import type { Sheet, SheetCell } from './mark-register-sheet';
import { registerGeneratedOn, registerLetterhead, registerLogo } from './register-head';
import type { StudentRegisterQueryDto, StudentRegisterType } from './student-registers.dto';

const TITLE: Record<StudentRegisterType, string> = {
  remark: 'Remark Register',
  attendance: 'Attendance Register',
  health: 'Height & Weight Register',
};

/** the year's exams that have entries of the register's kind for students of the sections ($1) */
const EXAMS_WITH_DATA: Record<StudentRegisterType, string> = {
  remark: `SELECT e.id::text, e.code, e.name FROM exams e
            WHERE e.academic_year_id = app.current_academic_year_id() AND e.deleted_at IS NULL
              AND (EXISTS (SELECT 1 FROM exam_remarks x JOIN enrolments en ON en.student_id = x.student_id
                            AND en.academic_year_id = e.academic_year_id AND en.class_section_id = ANY($1::bigint[])
                           WHERE x.exam_id = e.id)
                OR EXISTS (SELECT 1 FROM exam_remark_items x JOIN enrolments en ON en.student_id = x.student_id
                            AND en.academic_year_id = e.academic_year_id AND en.class_section_id = ANY($1::bigint[])
                           WHERE x.exam_id = e.id))
            ORDER BY e.starts_on NULLS LAST, e.code`,
  attendance: `SELECT e.id::text, e.code, e.name FROM exams e
                WHERE e.academic_year_id = app.current_academic_year_id() AND e.deleted_at IS NULL
                  AND EXISTS (SELECT 1 FROM exam_attendance x JOIN enrolments en ON en.student_id = x.student_id
                               AND en.academic_year_id = e.academic_year_id AND en.class_section_id = ANY($1::bigint[])
                              WHERE x.exam_id = e.id)
                ORDER BY e.starts_on NULLS LAST, e.code`,
  health: `SELECT e.id::text, e.code, e.name FROM exams e
            WHERE e.academic_year_id = app.current_academic_year_id() AND e.deleted_at IS NULL
              AND EXISTS (SELECT 1 FROM health_records x JOIN enrolments en ON en.student_id = x.student_id
                           AND en.academic_year_id = e.academic_year_id AND en.class_section_id = ANY($1::bigint[])
                          WHERE x.exam_id = e.id)
            ORDER BY e.starts_on NULLS LAST, e.code`,
};

/** students who left a section ($1) this year but have entries in the exams picked ($2) */
const LEFT_WITH_DATA: Record<StudentRegisterType, string> = {
  remark: `SELECT en.class_section_id::text AS section, count(DISTINCT en.student_id)::int AS n
             FROM enrolments en
            WHERE en.class_section_id = ANY($1::bigint[]) AND en.academic_year_id = app.current_academic_year_id()
              AND en.status <> 'active'
              AND NOT EXISTS (SELECT 1 FROM enrolments a WHERE a.student_id = en.student_id AND a.class_section_id = en.class_section_id
                                AND a.academic_year_id = en.academic_year_id AND a.status = 'active')
              AND (EXISTS (SELECT 1 FROM exam_remarks x WHERE x.student_id = en.student_id AND x.exam_id = ANY($2::bigint[]))
                OR EXISTS (SELECT 1 FROM exam_remark_items x WHERE x.student_id = en.student_id AND x.exam_id = ANY($2::bigint[])))
            GROUP BY 1`,
  attendance: `SELECT en.class_section_id::text AS section, count(DISTINCT en.student_id)::int AS n
                 FROM enrolments en
                WHERE en.class_section_id = ANY($1::bigint[]) AND en.academic_year_id = app.current_academic_year_id()
                  AND en.status <> 'active'
                  AND NOT EXISTS (SELECT 1 FROM enrolments a WHERE a.student_id = en.student_id AND a.class_section_id = en.class_section_id
                                    AND a.academic_year_id = en.academic_year_id AND a.status = 'active')
                  AND EXISTS (SELECT 1 FROM exam_attendance x WHERE x.student_id = en.student_id AND x.exam_id = ANY($2::bigint[]))
                GROUP BY 1`,
  health: `SELECT en.class_section_id::text AS section, count(DISTINCT en.student_id)::int AS n
             FROM enrolments en
            WHERE en.class_section_id = ANY($1::bigint[]) AND en.academic_year_id = app.current_academic_year_id()
              AND en.status <> 'active'
              AND NOT EXISTS (SELECT 1 FROM enrolments a WHERE a.student_id = en.student_id AND a.class_section_id = en.class_section_id
                                AND a.academic_year_id = en.academic_year_id AND a.status = 'active')
              AND EXISTS (SELECT 1 FROM health_records x WHERE x.student_id = en.student_id AND x.exam_id = ANY($2::bigint[]))
            GROUP BY 1`,
};

export interface Student {
  id: string;
  section: string;
  name: string;
  adm: string;
  roll: number | null;
}
export interface Exam {
  id: string;
  code: string;
  name: string;
}
export interface Place {
  id: string;
  place: string;
  sheets: Sheet[];
  notes: string[];
}

const ID_HEAD: SheetCell[] = [
  { t: 'Sr', rows: 2, center: true },
  { t: 'Adm No', rows: 2, center: true },
  { t: 'Roll No', rows: 2, center: true },
  { t: 'Student', rows: 2 },
];
const ID_WIDTHS = [3, 7, 4, 16];
const idCells = (s: Student, n: number): SheetCell[] => [
  { t: String(n), center: true },
  { t: s.adm, text: true, center: true },
  { t: s.roll === null ? '—' : String(s.roll), center: true },
  { t: s.name, text: true },
];
const none = (): SheetCell => ({ t: '—', tone: 'none', center: true });
/** names typed all in capitals (or all small) print in proper case, as the legacy registers do */
const properCase = (name: string) =>
  name === name.toUpperCase() || name === name.toLowerCase()
    ? name
        .toLowerCase()
        .replace(/(^|[\s'.-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase())
    : name;
/** a weight as kept (two decimals) without a trailing zero: 33.0, 27.25 */
const kg = (n: number) => {
  const two = n.toFixed(2);
  return two.endsWith('0') ? n.toFixed(1) : two;
};
const fixed = (n: number, d: number) => n.toFixed(d);
const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`;

/**
 * The legacy's Student Registers (docs/design/69, part 1; `EANDE/dynamic_student_register.php`): the
 * Remark, Attendance and Height & Weight registers of a class — a section or every section — for one or
 * more exams, as a sheet on screen or a PDF / Excel at once. Nothing is saved. Whoever may manage or
 * assign mark registers sees every section; anyone else the sections they teach this year (class or
 * subject teacher, indicator teacher; a coordinator every section of the class).
 */
@Injectable()
export class StudentRegistersService {
  constructor(
    private readonly db: DbService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  async run(ctx: RequestContext, type: StudentRegisterType, q: StudentRegisterQueryDto) {
    const perms = ctx.permissions ?? new Set<string>();
    if (!perms.has(EXAMS.marksView))
      throw new DomainError('permission-denied', 'The registers need exams.marks.view', {
        status: 403,
      });
    // heights and weights are health data
    if (type === 'health' && !perms.has(EXAMS.healthView))
      throw new DomainError(
        'permission-denied',
        'The Height & Weight Register needs exams.health.view',
        { status: 403 },
      );
    const tenant = requireTenant(ctx);
    if (!tenant.academicYearId)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    const all = perms.has('exams.registers.manage') || perms.has('exams.registers.assign');
    const out = await this.db.tenant(tenant, async (c) => {
      const open = await this.sectionsOpen(c, all);
      const classes = [...new Map(open.map((x) => [x.class_id, x])).values()].map((x) => ({
        id: x.class_id,
        code: x.class_code,
        name: x.class_name,
      }));
      const classId = classes.some((k) => k.id === q.classId)
        ? q.classId!
        : (classes[0]?.id ?? null);
      const sections = open
        .filter((x) => x.class_id === classId)
        .map((x) => ({ id: x.id, code: x.code }));
      const section =
        q.section === 'all' && sections.length > 1
          ? 'all'
          : (sections.find((x) => x.id === q.section)?.id ?? sections[0]?.id ?? null);
      const exams = sections.length
        ? (await c.query<Exam>(EXAMS_WITH_DATA[type], [sections.map((x) => x.id)])).rows
        : [];
      const asked = new Set((q.exams ?? '').split(',').filter(Boolean));
      let picked = exams.filter((e) => asked.has(e.id));
      if (!picked.length && exams[0]) picked = [exams[0]];
      const shown = section === 'all' ? sections : sections.filter((x) => x.id === section);
      const places =
        shown.length && picked.length ? await this.places(c, type, q, shown, picked) : [];
      const head = q.format === 'json' ? null : await registerLetterhead(c);
      return {
        classes,
        classId,
        sections,
        section,
        exams,
        picked,
        places,
        head,
        className: classes.find((k) => k.id === classId)?.name ?? '',
      };
    });
    const title = TITLE[type];
    if (q.format === 'json')
      return {
        type,
        title,
        /** every section of the school (a manager), else the sections the person teaches */
        all,
        classes: out.classes,
        classId: out.classId,
        sections: out.sections,
        section: out.section,
        exams: out.exams,
        picked: out.picked.map((e) => e.id),
        cutoff: q.cutoff,
        bmi: q.bmi,
        places: out.places,
      };
    if (!out.places.length)
      throw new DomainError('exams.register_empty', 'Nothing to print for the class chosen', {
        status: 409,
      });
    const meta = {
      school: out.head?.school ?? '',
      address: out.head?.address ?? '',
      logo: await registerLogo(this.storage, out.head?.file),
      label: `${title} · ${out.picked.map((e) => e.code).join(', ')}`,
      generatedOn: registerGeneratedOn(),
    };
    const sheets = out.places.flatMap((p) => p.sheets);
    const stamp = `${type}-register-${
      out.section === 'all' ? `${out.className}-all` : (out.places[0]?.place ?? '')
    }`
      .toLowerCase()
      .replace(/[^\w.-]+/g, '-');
    if (q.format === 'xlsx')
      return {
        filename: `${stamp}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: (await registerXlsx(sheets, meta)).toString('base64'),
      };
    return {
      filename: `${stamp}.pdf`,
      contentType: 'application/pdf',
      base64: (
        await registerPdf(sheets, meta, {
          paper: q.paper,
          orientation: q.orientation,
          fit: q.fit,
        })
      ).toString('base64'),
    };
  }

  /** The year's sections with students the person may open, class by class in the school's order. */
  private async sectionsOpen(c: PoolClient, all: boolean) {
    const r = await c.query<{
      id: string;
      class_id: string;
      code: string;
      class_code: string;
      class_name: string;
    }>(
      `SELECT cs.id::text, cs.class_id::text, k.code || '-' || cs.name AS code, k.code AS class_code, k.name AS class_name
         FROM class_sections cs JOIN classes k ON k.id = cs.class_id AND k.deleted_at IS NULL
        WHERE cs.academic_year_id = app.current_academic_year_id() AND cs.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM enrolments en WHERE en.class_section_id = cs.id AND en.status = 'active')
          AND ($1::boolean OR EXISTS (
                SELECT 1 FROM teacher_assignments ta
                  JOIN employees e ON e.id = ta.employee_id AND e.user_id = app.current_user_id()
                  JOIN class_sections mine ON mine.id = ta.class_section_id
                 WHERE ta.academic_year_id = cs.academic_year_id AND ta.valid_to IS NULL
                   AND (mine.id = cs.id OR (ta.kind = 'coordinator' AND mine.class_id = cs.class_id))))
        ORDER BY k.display_order, k.code, cs.name`,
      [all],
    );
    return r.rows;
  }

  /** Each section's sheet (and a register's summary tables) with what to check above it. */
  private async places(
    c: PoolClient,
    type: StudentRegisterType,
    q: StudentRegisterQueryDto,
    shown: Array<{ id: string; code: string }>,
    picked: Exam[],
  ): Promise<Place[]> {
    const sectionIds = shown.map((x) => x.id);
    const examIds = picked.map((e) => e.id);
    const st = await c.query<{
      id: string;
      section: string;
      name: string;
      adm: string;
      roll: number | null;
    }>(
      `SELECT s.id::text, en.class_section_id::text AS section, s.display_name AS name, s.admission_no AS adm, en.roll_no AS roll
         FROM enrolments en JOIN students s ON s.id = en.student_id AND s.deleted_at IS NULL
        WHERE en.class_section_id = ANY($1::bigint[]) AND en.academic_year_id = app.current_academic_year_id()
          AND en.status = 'active'
        ORDER BY en.roll_no NULLS LAST, s.display_name`,
      [sectionIds],
    );
    const students: Student[] = st.rows.map((x) => ({ ...x, name: properCase(x.name) }));
    const ids = students.map((s) => s.id);
    const left = new Map(
      (
        await c.query<{ section: string; n: number }>(LEFT_WITH_DATA[type], [sectionIds, examIds])
      ).rows.map((x) => [x.section, x.n]),
    );
    const build =
      type === 'remark'
        ? await this.remarks(c, examIds, ids)
        : type === 'attendance'
          ? await this.attendance(c, examIds, ids, q.cutoff)
          : await this.health(c, examIds, ids, q.bmi);
    return shown
      .map((sec) => {
        const mine = students.filter((s) => s.section === sec.id);
        if (!mine.length) return null;
        const { sheets, notes } = build(sec.code, mine, picked);
        const gone = left.get(sec.id) ?? 0;
        if (gone)
          notes.push(
            `${String(gone)} student(s) who left the section have entries in these exams; they are not shown.`,
          );
        return { id: sec.id, place: sec.code, sheets, notes };
      })
      .filter((x): x is Place => x !== null);
  }

  // ---- Remark Register ----------------------------------------------------------------------------
  private async remarks(c: PoolClient, examIds: string[], ids: string[]) {
    const general = await c.query<{
      exam: string;
      student: string;
      remark: string | null;
      participation: string | null;
      promoted_to: string | null;
    }>(
      `SELECT exam_id::text AS exam, student_id::text AS student, remark, participation, promoted_to
         FROM exam_remarks WHERE exam_id = ANY($1::bigint[]) AND student_id = ANY($2::bigint[])`,
      [examIds, ids],
    );
    const items = await c.query<{ exam: string; student: string; category: string; text: string }>(
      `SELECT exam_id::text AS exam, student_id::text AS student, category_id::text AS category, text
         FROM exam_remark_items WHERE exam_id = ANY($1::bigint[]) AND student_id = ANY($2::bigint[])`,
      [examIds, ids],
    );
    const cats = await c.query<{ id: string; name: string }>(
      `SELECT id::text, name FROM remark_categories
        WHERE id IN (SELECT DISTINCT category_id FROM exam_remark_items WHERE exam_id = ANY($1::bigint[]) AND student_id = ANY($2::bigint[]))
        ORDER BY sort_order, name`,
      [examIds, ids],
    );
    const g = new Map(general.rows.map((x) => [`${x.exam}|${x.student}`, x]));
    const it = new Map(items.rows.map((x) => [`${x.exam}|${x.student}|${x.category}`, x.text]));
    return (place: string, students: Student[], exams: Exam[]) => {
      const mine = new Set(students.map((s) => s.id));
      // per exam: the general remark, each category used, participation (only what this section has)
      const cols = exams.map((e) => {
        const has = (pick: (x: (typeof general.rows)[number]) => string | null) =>
          general.rows.some((x) => x.exam === e.id && mine.has(x.student) && pick(x)?.trim());
        const list: Array<{ label: string; value: (s: Student) => string }> = [];
        if (has((x) => x.remark))
          list.push({
            label: 'General remark',
            value: (s) => g.get(`${e.id}|${s.id}`)?.remark ?? '',
          });
        for (const k of cats.rows)
          if (items.rows.some((x) => x.exam === e.id && x.category === k.id && mine.has(x.student)))
            list.push({ label: k.name, value: (s) => it.get(`${e.id}|${s.id}|${k.id}`) ?? '' });
        if (has((x) => x.participation))
          list.push({
            label: 'Participation',
            value: (s) => g.get(`${e.id}|${s.id}`)?.participation ?? '',
          });
        return { e, list };
      });
      // Promoted to: the last given across the exams picked
      const promoted = (s: Student) =>
        exams
          .map((e) => g.get(`${e.id}|${s.id}`)?.promoted_to?.trim() ?? '')
          .filter(Boolean)
          .pop() ?? '';
      const withPromoted = students.some((s) => promoted(s));
      const head: SheetCell[][] = [
        [
          ...ID_HEAD,
          ...cols.map(({ e, list }) => ({
            t: e.code,
            span: Math.max(1, list.length),
            title: e.name,
          })),
          ...(withPromoted ? [{ t: 'Promoted to', rows: 2 }] : []),
        ],
        cols.flatMap(({ list }) =>
          list.length ? list.map((x) => ({ t: x.label })) : [{ t: 'No remarks' }],
        ),
      ];
      const body = students.map((s, n) => ({
        studentId: s.id,
        cells: [
          ...idCells(s, n + 1),
          ...cols.flatMap(({ list }) =>
            list.length
              ? list.map((x): SheetCell => ({ t: x.value(s), text: true, wrap: true }))
              : [none()],
          ),
          ...(withPromoted ? [{ t: promoted(s), text: true }] : []),
        ],
      }));
      const notes: string[] = [];
      if (!cols.some((x) => x.list.length)) notes.push('No remarks for the exams picked.');
      const sheet: Sheet = {
        place,
        head,
        body,
        foot: null,
        frozen: 4,
        widths: [
          ...ID_WIDTHS,
          ...cols.flatMap(({ list }) => (list.length ? list.map(() => 22) : [6])),
          ...(withPromoted ? [8] : []),
        ],
      };
      return { sheets: [sheet], notes };
    };
  }

  // ---- Attendance Register ------------------------------------------------------------------------
  private async attendance(c: PoolClient, examIds: string[], ids: string[], cutoff: number) {
    const r = await c.query<{ exam: string; student: string; present: number; total: number }>(
      `SELECT exam_id::text AS exam, student_id::text AS student, days_present AS present, days_total AS total
         FROM exam_attendance WHERE exam_id = ANY($1::bigint[]) AND student_id = ANY($2::bigint[])`,
      [examIds, ids],
    );
    const at = new Map(r.rows.map((x) => [`${x.exam}|${x.student}`, x]));
    return (place: string, students: Student[], exams: Exam[]) => {
      const overall = exams.length >= 2;
      const pctCell = (present: number, total: number): SheetCell => {
        const p = (present / total) * 100;
        return p < cutoff
          ? { t: fixed(p, 2), tone: 'warn', title: `Below ${String(cutoff)}%`, strong: true }
          : { t: fixed(p, 2) };
      };
      const rows = students.map((s) => {
        const own = exams.map((e) => at.get(`${e.id}|${s.id}`) ?? null);
        const got = own.filter((x): x is NonNullable<typeof x> => x !== null);
        const sumP = got.reduce((a, x) => a + x.present, 0);
        const sumT = got.reduce((a, x) => a + x.total, 0);
        // the student's % for the summary: overall when several exams, else the one exam's
        const pct = sumT > 0 ? (sumP / sumT) * 100 : null;
        return { s, own, sumP, sumT, pct };
      });
      const head: SheetCell[][] = [
        [
          ...ID_HEAD,
          ...exams.map((e) => ({ t: e.code, span: 3, title: e.name })),
          ...(overall ? [{ t: 'Overall', span: 3 }] : []),
        ],
        [...exams, ...(overall ? [null] : [])].flatMap(() => [
          { t: 'Present' },
          { t: 'Total' },
          { t: '%' },
        ]),
      ];
      const body = rows.map(({ s, own, sumP, sumT }, n) => ({
        studentId: s.id,
        cells: [
          ...idCells(s, n + 1),
          ...own.flatMap((x): SheetCell[] =>
            x
              ? [{ t: String(x.present) }, { t: String(x.total) }, pctCell(x.present, x.total)]
              : [none(), none(), none()],
          ),
          ...(overall
            ? sumT > 0
              ? [{ t: String(sumP) }, { t: String(sumT) }, pctCell(sumP, sumT)]
              : [none(), none(), none()]
            : []),
        ],
      }));
      const withPct = rows.filter((x) => x.pct !== null);
      const below = withPct
        .filter((x) => x.pct! < cutoff)
        .sort((a, b) => a.pct! - b.pct! || a.s.name.localeCompare(b.s.name));
      const avg = withPct.length ? withPct.reduce((a, x) => a + x.pct!, 0) / withPct.length : null;
      const sheet: Sheet = {
        place,
        head,
        body,
        foot: null,
        frozen: 4,
        widths: [...ID_WIDTHS, ...Array<number>((exams.length + (overall ? 1 : 0)) * 3).fill(5)],
      };
      const summary: Sheet = {
        place,
        title: 'Summary',
        note: overall
          ? `A student's % is over all the exams picked (days present ÷ days in all of them).`
          : undefined,
        head: [
          [
            { t: 'Students' },
            { t: 'With attendance' },
            { t: 'Class average %' },
            { t: `Below ${String(cutoff)}%` },
          ],
        ],
        body: [
          {
            studentId: 'summary',
            cells: [
              { t: String(students.length), center: true },
              { t: String(withPct.length), center: true },
              { t: avg === null ? '—' : fixed(avg, 2), center: true },
              {
                t: String(below.length),
                center: true,
                ...(below.length ? { tone: 'warn' as const, strong: true } : {}),
              },
            ],
          },
        ],
        foot: null,
        frozen: 0,
        widths: [6, 6, 6, 6],
      };
      const sheets = [sheet, summary];
      if (below.length)
        sheets.push({
          place,
          title: `Below ${String(cutoff)}%`,
          head: [[{ t: '#' }, { t: 'Student' }, { t: 'Adm No' }, { t: 'Roll No' }, { t: '%' }]],
          body: below.map((x, n) => ({
            studentId: x.s.id,
            cells: [
              { t: String(n + 1), center: true },
              { t: x.s.name, text: true },
              { t: x.s.adm, text: true, center: true },
              { t: x.s.roll === null ? '—' : String(x.s.roll), center: true },
              { t: fixed(x.pct!, 2), tone: 'warn', strong: true },
            ],
          })),
          foot: null,
          frozen: 0,
          widths: [3, 16, 7, 4, 5],
        });
      const notes: string[] = [];
      if (!withPct.length) notes.push('No attendance for the exams picked.');
      return { sheets, notes };
    };
  }

  // ---- Height & Weight Register -------------------------------------------------------------------
  private async health(c: PoolClient, examIds: string[], ids: string[], bmi: boolean) {
    // the latest measurement of a student in an exam (several on different days: the last one)
    const r = await c.query<{
      exam: string;
      student: string;
      height: string | null;
      weight: string | null;
      n: number;
    }>(
      `SELECT DISTINCT ON (h.exam_id, h.student_id) h.exam_id::text AS exam, h.student_id::text AS student,
              h.height_cm::text AS height, h.weight_kg::text AS weight,
              (count(*) OVER (PARTITION BY h.exam_id, h.student_id))::int AS n
         FROM health_records h WHERE h.exam_id = ANY($1::bigint[]) AND h.student_id = ANY($2::bigint[])
        ORDER BY h.exam_id, h.student_id, h.recorded_on DESC, h.id DESC`,
      [examIds, ids],
    );
    const at = new Map(r.rows.map((x) => [`${x.exam}|${x.student}`, x]));
    const num = (v: string | null | undefined) =>
      v === null || v === undefined ? null : Number(v);
    const bmiOf = (h: number | null, w: number | null) =>
      h && w && h > 0 && w > 0 ? w / (h / 100) ** 2 : null;
    return (place: string, students: Student[], exams: Exam[]) => {
      const per = bmi ? 3 : 2;
      const change = exams.length >= 2;
      const measure = (s: Student, e: Exam) => {
        const x = at.get(`${e.id}|${s.id}`);
        const h = num(x?.height);
        const w = num(x?.weight);
        return { h, w, b: bmiOf(h, w), dup: (x?.n ?? 0) > 1 };
      };
      const diff = (vals: Array<number | null>) => {
        const got = vals.filter((v): v is number => v !== null && v > 0);
        return got.length >= 2 ? signed(got[got.length - 1]! - got[0]!) : '—';
      };
      const head: SheetCell[][] = [
        [
          ...ID_HEAD,
          ...exams.map((e) => ({ t: e.code, span: per, title: e.name })),
          ...(change ? [{ t: 'Change', span: 2 }] : []),
        ],
        [
          ...exams.flatMap(() => [
            { t: 'Height (cm)' },
            { t: 'Weight (kg)' },
            ...(bmi ? [{ t: 'BMI' }] : []),
          ]),
          ...(change ? [{ t: 'Height (cm)' }, { t: 'Weight (kg)' }] : []),
        ],
      ];
      let dups = 0;
      const body = students.map((s, n) => {
        const m = exams.map((e) => measure(s, e));
        dups += m.filter((x) => x.dup).length;
        return {
          studentId: s.id,
          cells: [
            ...idCells(s, n + 1),
            ...m.flatMap((x): SheetCell[] => [
              x.h === null ? none() : { t: fixed(x.h, 1) },
              x.w === null ? none() : { t: kg(x.w) },
              ...(bmi ? [x.b === null ? none() : { t: fixed(x.b, 1) }] : []),
            ]),
            ...(change ? [{ t: diff(m.map((x) => x.h)) }, { t: diff(m.map((x) => x.w)) }] : []),
          ],
        };
      });
      const sheet: Sheet = {
        place,
        head,
        body,
        foot: null,
        frozen: 4,
        widths: [...ID_WIDTHS, ...Array<number>(exams.length * per + (change ? 2 : 0)).fill(6)],
      };
      const avg = (v: Array<number | null>) => {
        const got = v.filter((x): x is number => x !== null && x > 0);
        return got.length ? fixed(got.reduce((a, x) => a + x, 0) / got.length, 1) : '—';
      };
      const averages: Sheet = {
        place,
        title: 'Class averages',
        head: [
          [
            { t: 'Exam' },
            { t: 'Measured' },
            { t: 'Height (cm)' },
            { t: 'Weight (kg)' },
            ...(bmi ? [{ t: 'BMI' }] : []),
          ],
        ],
        body: exams.map((e) => {
          const m = students.map((s) => measure(s, e));
          const measured = Math.max(
            m.filter((x) => x.h !== null).length,
            m.filter((x) => x.w !== null).length,
          );
          return {
            studentId: `exam-${e.id}`,
            cells: [
              { t: `${e.code} · ${e.name}`, text: true },
              { t: String(measured), center: true },
              { t: avg(m.map((x) => x.h)) },
              { t: avg(m.map((x) => x.w)) },
              ...(bmi ? [{ t: avg(m.map((x) => x.b)) }] : []),
            ],
          };
        }),
        foot: null,
        frozen: 0,
        widths: [14, 6, 6, 6, ...(bmi ? [6] : [])],
      };
      const notes: string[] = [];
      if (!r.rows.some((x) => students.some((s) => s.id === x.student)))
        notes.push('No heights or weights for the exams picked.');
      if (dups)
        notes.push(
          `${String(dups)} measurement(s) were taken more than once in an exam: the latest is shown.`,
        );
      return { sheets: [sheet, averages], notes };
    };
  }
}
