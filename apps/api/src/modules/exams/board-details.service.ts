import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import ExcelJS from 'exceljs';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { CBSE_SUBJECTS, likelySubject, type BoardSubjectKind } from './board-subjects';

type BoardClass = 'X' | 'XII';

export interface TeacherOf {
  employeeId: string | null;
  name: string;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/^(mr|mrs|ms|dr|shri|smt)\.?\s+/i, '')
    .replace(/[^a-z]+/g, ' ')
    .trim();

/**
 * What the annexures need besides the file (docs/design/88, phase B): each candidate's student and details
 * (section, stream, category, religion, EWS, CWSN, boarder, staff ward — from the record when saved, or from the
 * school's old details sheet), the CBSE subject codes linked to the school's subjects, and the teacher of each
 * section's subject (the year's teacher assignment, or an override — a section split by roll number).
 */
@Injectable()
export class BoardDetailsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  // ---- CBSE subjects -----------------------------------------------------------------------------------------------

  /** The school's list for a class: seeded on first use, codes a file printed added unnamed, linked to its subjects. */
  async ensureSubjects(c: PoolClient, board: string, classLabel: BoardClass, seen: string[] = []) {
    const have = new Set(
      (
        await c.query<{ code: string }>(
          `SELECT code FROM board_subjects WHERE board = $1 AND class_label = $2`,
          [board, classLabel],
        )
      ).rows.map((r) => r.code),
    );
    const seed = board === 'CBSE' ? CBSE_SUBJECTS[classLabel] : [];
    const add: Array<[string, string | null, BoardSubjectKind]> = [
      ...seed.filter(([code]) => !have.has(code)),
      ...[...new Set(seen)]
        .filter((code) => !have.has(code) && !seed.some(([s]) => s === code))
        .map((code): [string, null, BoardSubjectKind] => [code, null, 'main']),
    ];
    if (!add.length) return;
    const subjects = (
      await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM subjects WHERE status = 'active' ORDER BY display_order, id`,
      )
    ).rows;
    for (const [code, name, kind] of add)
      await c.query(
        `INSERT INTO board_subjects (school_id, board, class_label, code, name, kind, subject_id)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6)
         ON CONFLICT (school_id, board, class_label, code) DO NOTHING`,
        [
          board,
          classLabel,
          code,
          name,
          kind,
          name ? (likelySubject(name, subjects)?.id ?? null) : null,
        ],
      );
  }

  async subjects(ctx: RequestContext, classLabel: BoardClass) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.ensureSubjects(c, 'CBSE', classLabel);
      const rows = await c.query<{
        id: string;
        code: string;
        name: string | null;
        kind: BoardSubjectKind;
        subject_id: string | null;
        subject: string | null;
        candidates: number;
      }>(
        `SELECT b.id::text, b.code, b.name, b.kind, b.subject_id::text, s.name AS subject,
                (SELECT count(*)::int FROM board_results r WHERE r.board = b.board AND r.class_label = b.class_label
                    AND r.subject_code = b.code
                    AND r.exam_year = (SELECT max(exam_year) FROM board_candidates WHERE class_label = b.class_label)) AS candidates
           FROM board_subjects b LEFT JOIN subjects s ON s.id = b.subject_id
          WHERE b.board = 'CBSE' AND b.class_label = $1 ORDER BY (b.name IS NULL) DESC, b.code`,
        [classLabel],
      );
      const options = await c.query<{ id: string; name: string; code: string }>(
        `SELECT id::text, name, code FROM subjects WHERE status = 'active' ORDER BY display_order, name`,
      );
      return {
        rows: rows.rows.map((r) => ({
          id: r.id,
          code: r.code,
          name: r.name,
          kind: r.kind,
          subject: r.subject_id ? { id: r.subject_id, name: r.subject! } : null,
          candidates: r.candidates,
        })),
        options: options.rows,
      };
    });
  }

  async saveSubject(
    ctx: RequestContext,
    id: string,
    dto: { name: string; kind: BoardSubjectKind; subjectId: string | null },
  ) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `UPDATE board_subjects SET name = $2, kind = $3, subject_id = $4, updated_by = app.current_user_id(), updated_at = now()
          WHERE id = $1`,
        [id, dto.name, dto.kind, dto.subjectId],
      );
      if (!r.rowCount)
        throw new DomainError('not-found', 'Subject code not found', { status: 404 });
      // the saved results carry the name too (the Results list, the exports)
      await c.query(
        `UPDATE board_results r SET subject_name = b.name FROM board_subjects b
          WHERE b.id = $1 AND r.board = b.board AND r.class_label = b.class_label AND r.subject_code = b.code`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.board_result.subject',
        entityType: 'board_subjects',
        entityId: id,
        after: dto,
      });
      return { id };
    });
  }

  async addSubject(
    ctx: RequestContext,
    dto: {
      classLabel: BoardClass;
      code: string;
      name: string;
      kind: BoardSubjectKind;
      subjectId: string | null;
    },
  ) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO board_subjects (school_id, board, class_label, code, name, kind, subject_id, updated_by)
         VALUES (app.current_school_id(), 'CBSE', $1, $2, $3, $4, $5, app.current_user_id())
         ON CONFLICT (school_id, board, class_label, code) DO NOTHING RETURNING id::text`,
        [dto.classLabel, dto.code, dto.name, dto.kind, dto.subjectId],
      );
      if (!r.rows[0])
        throw new DomainError('conflict', `Code ${dto.code} is on the list already`, {
          status: 409,
        });
      await this.audit.stage(ctx, c, {
        action: 'exams.board_result.subject',
        entityType: 'board_subjects',
        entityId: r.rows[0].id,
        after: dto,
      });
      return { id: r.rows[0].id };
    });
  }

  // ---- candidates: details and students ---------------------------------------------------------------------------

  /** The saved results of an upload named from the school's list. */
  async nameResults(c: PoolClient, importId: string) {
    await c.query(
      `UPDATE board_results r SET subject_name = b.name FROM board_subjects b
        WHERE r.import_id = $1 AND b.board = r.board AND b.class_label = r.class_label AND b.code = r.subject_code`,
      [importId],
    );
  }

  /** Names of a class's codes (for an upload's preview). */
  async names(
    c: PoolClient,
    board: string,
    classLabel: BoardClass,
  ): Promise<Record<string, string>> {
    await this.ensureSubjects(c, board, classLabel);
    const r = await c.query<{ code: string; name: string | null }>(
      `SELECT code, name FROM board_subjects WHERE board = $1 AND class_label = $2`,
      [board, classLabel],
    );
    return Object.fromEntries(r.rows.filter((x) => x.name).map((x) => [x.code, x.name!]));
  }

  /** Each found candidate's details from the student record (of that academic year). */
  async snapshot(c: PoolClient, where: { importId: string } | { candidateId: string }) {
    const [field, value] =
      'importId' in where ? ['import_id', where.importId] : ['id', where.candidateId];
    await c.query(
      // eslint-disable-next-line no-restricted-syntax -- field is one of two column names
      `UPDATE board_candidates bc SET section = x.section, stream = x.stream, category = x.category, religion = x.religion,
              ews = x.ews, cwsn = x.cwsn, boarder = x.boarder, staff_ward = x.staff_ward, details_from = 'record', details_at = now()
         FROM (SELECT b.id,
                      (SELECT cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id
                        WHERE e.student_id = b.student_id AND e.academic_year_id = b.academic_year_id ORDER BY e.id DESC LIMIT 1) AS section,
                      NULLIF(s.profile->>'stream', '') AS stream, NULLIF(s.category::text, '') AS category,
                      NULLIF(s.profile->>'religion', '') AS religion,
                      COALESCE(s.profile->>'ews', '') = 'Yes' AS ews, COALESCE(s.profile->>'cwsn', '') = 'Yes' AS cwsn,
                      EXISTS (SELECT 1 FROM hostel_allotments a JOIN academic_years y ON y.id = b.academic_year_id
                               WHERE a.student_id = s.id AND a.from_date <= y.end_date AND (a.to_date IS NULL OR a.to_date >= y.start_date)) AS boarder,
                      EXISTS (SELECT 1 FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                               WHERE sg.student_id = s.id AND COALESCE(g.profile->>'school_staff', '') = 'Yes') AS staff_ward
                 FROM board_candidates b JOIN students s ON s.id = b.student_id
                WHERE b.${field} = $1) x
        WHERE bc.id = x.id`,
      [value],
    );
  }

  /** The board roll number written to a found student's enrolment that year (only where none is set). */
  async writeRolls(c: PoolClient, where: { importId: string } | { candidateId: string }) {
    const [field, value] =
      'importId' in where ? ['import_id', where.importId] : ['id', where.candidateId];
    await c.query(
      // eslint-disable-next-line no-restricted-syntax -- field is one of two column names
      `UPDATE enrolments e SET board_roll_no = bc.roll_no
         FROM board_candidates bc
        WHERE bc.${field} = $1 AND bc.student_id = e.student_id AND e.academic_year_id = bc.academic_year_id
          AND COALESCE(e.board_roll_no, '') = ''`,
      [value],
    );
  }

  private async savedImport(c: PoolClient, importId: string) {
    const r = await c.query<{
      board: string;
      class_label: BoardClass;
      exam_year: number;
      academic_year_id: string | null;
      ok: boolean;
    }>(
      `SELECT board, class_label, exam_year, academic_year_id::text,
              (kind = 'gazette' AND status = 'committed' AND replaced_at IS NULL) AS ok
         FROM board_result_imports WHERE id = $1`,
      [importId],
    );
    const i = r.rows[0];
    if (!i) throw new DomainError('not-found', 'Upload not found', { status: 404 });
    if (!i.ok)
      throw new DomainError(
        'conflict',
        'Only a saved result file (not replaced) can be completed',
        {
          status: 409,
        },
      );
    return i;
  }

  /** The candidates not found among the students, and the students of the class that year no candidate is linked to. */
  async review(ctx: RequestContext, importId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const i = await this.savedImport(c, importId);
      const cands = await c.query<{
        id: string;
        roll_no: string;
        name: string | null;
        sex: string | null;
        match: string;
        student_id: string | null;
        student: string | null;
        admission_no: string | null;
      }>(
        `SELECT bc.id::text, bc.roll_no, bc.name, bc.sex, bc.match, bc.student_id::text, s.display_name AS student, s.admission_no
           FROM board_candidates bc LEFT JOIN students s ON s.id = bc.student_id
          WHERE bc.import_id = $1 ORDER BY (bc.match IN ('none', 'not_ours')) DESC, bc.roll_no`,
        [importId],
      );
      const free = i.academic_year_id
        ? (
            await c.query<{
              id: string;
              name: string;
              admission_no: string;
              section: string;
              gender: string | null;
            }>(
              `SELECT DISTINCT s.id::text, s.display_name AS name, s.admission_no, cs.name AS section, s.gender::text AS gender
                 FROM enrolments e JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
                 JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
                WHERE e.academic_year_id = $1 AND k.code = $2
                  AND NOT EXISTS (SELECT 1 FROM board_candidates bc WHERE bc.student_id = s.id AND bc.board = $3
                                    AND bc.class_label = $2 AND bc.exam_year = $4)
                ORDER BY s.display_name`,
              [i.academic_year_id, i.class_label, i.board, i.exam_year],
            )
          ).rows
        : [];
      const sexOf = (g: string | null) => (g === 'male' ? 'M' : g === 'female' ? 'F' : '');
      const sim = (a: string, b: string) => {
        const x = norm(a).split(' ');
        const y = norm(b).split(' ');
        return x.filter((w) => w.length > 1 && y.includes(w)).length;
      };
      return {
        classLabel: i.class_label,
        examYear: i.exam_year,
        candidates: cands.rows.map((r) => {
          const open = r.match === 'none';
          const best = open
            ? [...free]
                .map((s) => ({
                  s,
                  score:
                    sim(r.name ?? '', s.name) * 2 +
                    (sexOf(s.gender) && sexOf(s.gender) === r.sex ? 1 : 0),
                }))
                .filter((x) => x.score > 1)
                .sort((a, b) => b.score - a.score)
                .slice(0, 3)
                .map((x) => x.s.id)
            : [];
          return {
            id: r.id,
            roll: r.roll_no,
            name: r.name,
            sex: r.sex,
            match: r.match,
            student: r.student_id
              ? { id: r.student_id, name: r.student!, admissionNo: r.admission_no }
              : null,
            suggested: best,
          };
        }),
        students: free.map((s) => ({
          id: s.id,
          name: s.name,
          admissionNo: s.admission_no,
          section: s.section,
          sex: sexOf(s.gender),
        })),
      };
    });
  }

  /** A candidate linked to a student (or marked not ours, or unlinked); the details and the roll number follow. */
  async pick(
    ctx: RequestContext,
    candidateId: string,
    dto: { studentId?: string | null; notOurs?: boolean },
  ) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        import_id: string;
        class_label: BoardClass;
        exam_year: number;
        board: string;
        academic_year_id: string | null;
      }>(
        `SELECT import_id::text, class_label, exam_year, board, academic_year_id::text FROM board_candidates WHERE id = $1 FOR UPDATE`,
        [candidateId],
      );
      const cand = r.rows[0];
      if (!cand) throw new DomainError('not-found', 'Candidate not found', { status: 404 });
      await this.savedImport(c, cand.import_id);
      let match: string = 'none';
      if (dto.studentId) {
        const ok = await c.query(
          `SELECT 1 FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
            WHERE e.student_id = $1 AND e.academic_year_id = $2 AND k.code = $3`,
          [dto.studentId, cand.academic_year_id, cand.class_label],
        );
        if (!ok.rowCount)
          throw new DomainError(
            'validation-failed',
            `That student was not in Class ${cand.class_label} that year`,
            {
              status: 400,
            },
          );
        const taken = await c.query(
          `SELECT 1 FROM board_candidates WHERE student_id = $1 AND board = $2 AND class_label = $3 AND exam_year = $4 AND id <> $5`,
          [dto.studentId, cand.board, cand.class_label, cand.exam_year, candidateId],
        );
        if (taken.rowCount)
          throw new DomainError('conflict', 'That student is linked to another candidate already', {
            status: 409,
          });
        match = 'picked';
      } else if (dto.notOurs) match = 'not_ours';
      await c.query(`UPDATE board_candidates SET student_id = $2, match = $3 WHERE id = $1`, [
        candidateId,
        dto.studentId ?? null,
        match,
      ]);
      if (!dto.studentId)
        await c.query(
          `UPDATE board_candidates SET section = NULL, stream = NULL, category = NULL, religion = NULL, ews = NULL,
                  cwsn = NULL, boarder = NULL, staff_ward = NULL, details_from = 'none', details_at = NULL
            WHERE id = $1`,
          [candidateId],
        );
      await c.query(`UPDATE board_results SET student_id = $2 WHERE candidate_id = $1`, [
        candidateId,
        dto.studentId ?? null,
      ]);
      if (dto.studentId) {
        await this.snapshot(c, { candidateId });
        await this.writeRolls(c, { candidateId });
      }
      await this.audit.stage(ctx, c, {
        action: 'exams.board_result.candidate',
        entityType: 'board_candidates',
        entityId: candidateId,
        after: { studentId: dto.studentId ?? null, match },
      });
      return { id: candidateId, match };
    });
  }

  /** Every found candidate's details taken again from the records (after a record was put right). */
  async refresh(ctx: RequestContext, importId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.savedImport(c, importId);
      await this.snapshot(c, { importId });
      await this.audit.stage(ctx, c, {
        action: 'exams.board_result.details',
        entityType: 'board_result_imports',
        entityId: importId,
        after: { from: 'record' },
      });
      const n = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM board_candidates WHERE import_id = $1 AND details_from = 'record'`,
        [importId],
      );
      return { refreshed: n.rows[0]!.n };
    });
  }

  // ---- teachers ------------------------------------------------------------------------------------------------------

  /** Who taught a section's subject: an override (for that roll, else the whole section), else the year's assignment. */
  async teacherResolver(c: PoolClient, board: string, classLabel: BoardClass, examYear: number) {
    const overrides = (
      await c.query<{
        section: string;
        code: string;
        rolls: string[];
        employee_id: string | null;
        name: string;
      }>(
        `SELECT o.section, o.code, o.rolls, o.employee_id::text, COALESCE(e.display_name, o.teacher_name) AS name
           FROM board_teacher_overrides o LEFT JOIN employees e ON e.id = o.employee_id
          WHERE o.board = $1 AND o.class_label = $2 AND o.exam_year = $3 ORDER BY o.id`,
        [board, classLabel, examYear],
      )
    ).rows;
    const assigned = (
      await c.query<{ section: string; code: string; employee_id: string; name: string }>(
        `SELECT DISTINCT cs.name AS section, bs.code, e.id::text AS employee_id, e.display_name AS name
           FROM teacher_assignments ta
           JOIN class_sections cs ON cs.id = ta.class_section_id JOIN classes k ON k.id = cs.class_id AND k.code = $2
           JOIN board_subjects bs ON bs.subject_id = ta.subject_id AND bs.board = $1 AND bs.class_label = $2
           JOIN employees e ON e.id = ta.employee_id
          WHERE ta.kind = 'subject_teacher'
            AND ta.academic_year_id = (SELECT academic_year_id FROM board_candidates
                                        WHERE board = $1 AND class_label = $2 AND exam_year = $3 AND academic_year_id IS NOT NULL LIMIT 1)
          ORDER BY e.display_name`,
        [board, classLabel, examYear],
      )
    ).rows;
    return (section: string | null, code: string, roll: string): TeacherOf | null => {
      if (!section) return null;
      const o =
        overrides.find((x) => x.section === section && x.code === code && x.rolls.includes(roll)) ??
        overrides.find((x) => x.section === section && x.code === code && x.rolls.length === 0);
      if (o) return { employeeId: o.employee_id, name: o.name };
      const a = assigned.find((x) => x.section === section && x.code === code);
      return a ? { employeeId: a.employee_id, name: a.name } : null;
    };
  }

  /** The Teachers tab: each section × subject of a saved year, its teacher(s) and the overrides. */
  async teachers(ctx: RequestContext, classLabel: BoardClass, examYear?: number) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const years = (
        await c.query<{ y: number }>(
          `SELECT DISTINCT exam_year AS y FROM board_candidates WHERE class_label = $1 ORDER BY 1 DESC`,
          [classLabel],
        )
      ).rows.map((r) => r.y);
      const year = examYear ?? years[0];
      if (!year) return { classLabel, examYear: null, years, rows: [], options: [] };
      await this.ensureSubjects(c, 'CBSE', classLabel);
      const cells = await c.query<{
        section: string | null;
        code: string;
        name: string | null;
        n: number;
        rolls: string[];
      }>(
        `SELECT bc.section, r.subject_code AS code, bs.name, count(*)::int AS n, array_agg(bc.roll_no ORDER BY bc.roll_no) AS rolls
           FROM board_results r JOIN board_candidates bc ON bc.id = r.candidate_id
           LEFT JOIN board_subjects bs ON bs.board = r.board AND bs.class_label = r.class_label AND bs.code = r.subject_code
          WHERE r.board = 'CBSE' AND r.class_label = $1 AND r.exam_year = $2
          GROUP BY bc.section, r.subject_code, bs.name ORDER BY r.subject_code, bc.section NULLS LAST`,
        [classLabel, year],
      );
      const who = await this.teacherResolver(c, 'CBSE', classLabel, year);
      const overrides = (
        await c.query<{
          id: string;
          section: string;
          code: string;
          rolls: string[];
          employee_id: string | null;
          name: string;
        }>(
          `SELECT o.id::text, o.section, o.code, o.rolls, o.employee_id::text, COALESCE(e.display_name, o.teacher_name) AS name
             FROM board_teacher_overrides o LEFT JOIN employees e ON e.id = o.employee_id
            WHERE o.board = 'CBSE' AND o.class_label = $1 AND o.exam_year = $2 ORDER BY o.id`,
          [classLabel, year],
        )
      ).rows;
      const options = await c.query<{ id: string; name: string; code: string }>(
        `SELECT id::text, display_name AS name, employee_code AS code FROM employees
          WHERE deleted_at IS NULL AND status::text = 'active' ORDER BY display_name LIMIT 2000`,
      );
      return {
        classLabel,
        examYear: year,
        years,
        rows: cells.rows.map((x) => {
          const teachers = new Map<string, number>();
          for (const roll of x.rolls) {
            const t = who(x.section, x.code, roll);
            const k = t?.name ?? '';
            teachers.set(k, (teachers.get(k) ?? 0) + 1);
          }
          return {
            section: x.section,
            code: x.code,
            name: x.name,
            candidates: x.n,
            teachers: [...teachers.entries()].map(([name, n]) => ({
              name: name || null,
              candidates: n,
            })),
            overrides: overrides
              .filter((o) => o.section === x.section && o.code === x.code)
              .map((o) => ({ id: o.id, name: o.name, employeeId: o.employee_id, rolls: o.rolls })),
          };
        }),
        options: options.rows,
      };
    });
  }

  async setTeacher(
    ctx: RequestContext,
    dto: {
      classLabel: BoardClass;
      examYear: number;
      section: string;
      code: string;
      employeeId?: string | null;
      teacherName?: string | null;
      rolls?: string[];
    },
  ) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO board_teacher_overrides (school_id, board, class_label, exam_year, section, code, employee_id, teacher_name, rolls, created_by)
         VALUES (app.current_school_id(), 'CBSE', $1, $2, $3, $4, $5, $6, $7, app.current_user_id()) RETURNING id::text`,
        [
          dto.classLabel,
          dto.examYear,
          dto.section,
          dto.code,
          dto.employeeId ?? null,
          dto.employeeId ? null : (dto.teacherName ?? null),
          dto.rolls ?? [],
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.board_result.teacher',
        entityType: 'board_teacher_overrides',
        entityId: r.rows[0]!.id,
        after: dto,
      });
      return { id: r.rows[0]!.id };
    });
  }

  async removeTeacher(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(`DELETE FROM board_teacher_overrides WHERE id = $1`, [id]);
      if (!r.rowCount) throw new DomainError('not-found', 'Not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'exams.board_result.teacher_remove',
        entityType: 'board_teacher_overrides',
        entityId: id,
      });
      return { id };
    });
  }

  // ---- the school's old details sheet ---------------------------------------------------------------------------------

  /**
   * The details sheet the school filled by hand before (two sheets): roll no → admission no, stream, section, category
   * (boarder / staff / other), SC/ST/OBC/GEN, religion, EWS, CWSN; section × subject code → teacher (optionally for some
   * roll numbers). Its values override the record's for those candidates; an admission number links a candidate not
   * found; a teacher is matched to an employee by name, else kept as written.
   */
  async detailsSheet(ctx: RequestContext, importId: string, fileBase64: string) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(Buffer.from(fileBase64, 'base64') as unknown as ArrayBuffer);
    } catch {
      throw new DomainError('validation-failed', 'Not a readable .xlsx file', { status: 400 });
    }
    const text = (v: unknown): string =>
      v == null
        ? ''
        : typeof v === 'object'
          ? String(
              (v as { result?: unknown; text?: unknown }).result ??
                (v as { text?: unknown }).text ??
                '',
            )
          : String(v);
    const rowsOf = (ws: ExcelJS.Worksheet | undefined) => {
      if (!ws) return { header: [] as string[], rows: [] as string[][] };
      const header: string[] = [];
      const rows: string[][] = [];
      ws.eachRow((row, n) => {
        const cells: string[] = [];
        for (let i = 1; i <= Math.max(row.cellCount, header.length); i += 1)
          cells.push(text(row.getCell(i).value).trim());
        if (n === 1) header.push(...cells.map((h) => h.toLowerCase().replace(/[^a-z]+/g, '')));
        else if (cells.some(Boolean)) rows.push(cells);
      });
      return { header, rows };
    };
    const col = (header: string[], ...starts: string[]) =>
      header.findIndex((h) => starts.some((s) => h.startsWith(s)));
    const [first, second] = [wb.worksheets[0], wb.worksheets[1]];
    const s1 = rowsOf(first);
    const s2 = rowsOf(second);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const i = await this.savedImport(c, importId);
      const yes = (v: string) => /^(y|yes|true|1)$/i.test(v.trim());
      let updated = 0;
      let linked = 0;
      const unknown: string[] = [];
      const h = s1.header;
      const at = {
        roll: col(h, 'boardroll', 'rollno', 'roll'),
        adm: col(h, 'schoolnumber', 'admission'),
        stream: col(h, 'stream'),
        section: col(h, 'section'),
        kind: col(h, 'category'),
        caste: col(h, 'scstobcgen', 'caste', 'social'),
        religion: col(h, 'religion'),
        ews: col(h, 'ews'),
        cwsn: col(h, 'cwsn'),
      };
      if (s1.rows.length && at.roll < 0)
        throw new DomainError('validation-failed', 'The first sheet needs a BoardRollNo column', {
          status: 400,
        });
      const v = (r: string[], k: number) => (k >= 0 ? (r[k] ?? '').trim() : '');
      for (const r of s1.rows) {
        const roll = v(r, at.roll);
        if (!roll) continue;
        const cand = await c.query<{ id: string; student_id: string | null }>(
          `SELECT id::text, student_id::text FROM board_candidates WHERE import_id = $1 AND roll_no = $2`,
          [importId, roll],
        );
        if (!cand.rows[0]) {
          unknown.push(roll);
          continue;
        }
        const id = cand.rows[0].id;
        // a candidate not found: linked by the admission number the sheet gives
        if (!cand.rows[0].student_id && v(r, at.adm)) {
          const st = await c.query<{ id: string }>(
            `SELECT s.id::text FROM students s JOIN enrolments e ON e.student_id = s.id AND e.academic_year_id = $2
              WHERE s.admission_no = $1 AND s.deleted_at IS NULL
                AND NOT EXISTS (SELECT 1 FROM board_candidates bc WHERE bc.student_id = s.id AND bc.class_label = $3 AND bc.exam_year = $4)
              LIMIT 1`,
            [v(r, at.adm), i.academic_year_id, i.class_label, i.exam_year],
          );
          if (st.rows[0]) {
            await c.query(
              `UPDATE board_candidates SET student_id = $2, match = 'picked' WHERE id = $1`,
              [id, st.rows[0].id],
            );
            await c.query(`UPDATE board_results SET student_id = $2 WHERE candidate_id = $1`, [
              id,
              st.rows[0].id,
            ]);
            await this.writeRolls(c, { candidateId: id });
            linked += 1;
          }
        }
        const kind = v(r, at.kind);
        await c.query(
          `UPDATE board_candidates SET
              section = COALESCE(NULLIF($2, ''), section), stream = COALESCE(NULLIF($3, ''), stream),
              category = COALESCE(NULLIF($4, ''), category), religion = COALESCE(NULLIF($5, ''), religion),
              ews = CASE WHEN $6 = '' THEN ews ELSE $6 = 'Y' END, cwsn = CASE WHEN $7 = '' THEN cwsn ELSE $7 = 'Y' END,
              boarder = CASE WHEN $8 = '' THEN boarder ELSE $8 ILIKE '%board%' END,
              staff_ward = CASE WHEN $8 = '' THEN staff_ward ELSE $8 ILIKE '%staff%' END,
              details_from = 'sheet', details_at = now()
            WHERE id = $1`,
          [
            id,
            v(r, at.section),
            v(r, at.stream),
            v(r, at.caste),
            v(r, at.religion),
            at.ews >= 0 && v(r, at.ews) ? (yes(v(r, at.ews)) ? 'Y' : 'N') : '',
            at.cwsn >= 0 && v(r, at.cwsn) ? (yes(v(r, at.cwsn)) ? 'Y' : 'N') : '',
            kind,
          ],
        );
        updated += 1;
      }
      // the second sheet: section × subject code → teacher
      let teachers = 0;
      let matched = 0;
      const h2 = s2.header;
      const t = {
        section: col(h2, 'section'),
        code: col(h2, 'subjectcode', 'code'),
        teacher: col(h2, 'teacher'),
        rolls: col(h2, 'board', 'roll'),
      };
      if (s2.rows.length && (t.section < 0 || t.code < 0 || t.teacher < 0))
        throw new DomainError(
          'validation-failed',
          'The second sheet needs Section, SubjectCode and Teacher columns',
          {
            status: 400,
          },
        );
      if (s2.rows.length) {
        const staff = (
          await c.query<{ id: string; name: string }>(
            `SELECT id::text, display_name AS name FROM employees WHERE deleted_at IS NULL`,
          )
        ).rows;
        await c.query(
          `DELETE FROM board_teacher_overrides WHERE board = $1 AND class_label = $2 AND exam_year = $3`,
          [i.board, i.class_label, i.exam_year],
        );
        for (const r of s2.rows) {
          const section = v(r, t.section);
          const code = v(r, t.code).padStart(3, '0');
          const name = v(r, t.teacher).replace(/\s+/g, ' ');
          if (!section || !/^\d{3}$/.test(code) || name.length < 2) continue;
          const emp = staff.filter((e) => norm(e.name) === norm(name));
          const rolls = (t.rolls >= 0 ? v(r, t.rolls) : '')
            .split(/[\s,;]+/)
            .filter((x) => /^\d{6,10}$/.test(x));
          await c.query(
            `INSERT INTO board_teacher_overrides (school_id, board, class_label, exam_year, section, code, employee_id, teacher_name, rolls, created_by)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, app.current_user_id())`,
            [
              i.board,
              i.class_label,
              i.exam_year,
              section,
              code,
              emp.length === 1 ? emp[0]!.id : null,
              emp.length === 1 ? null : name.slice(0, 120),
              rolls,
            ],
          );
          teachers += 1;
          if (emp.length === 1) matched += 1;
        }
      }
      await this.audit.stage(ctx, c, {
        action: 'exams.board_result.details_sheet',
        entityType: 'board_result_imports',
        entityId: importId,
        after: { updated, linked, unknown: unknown.length, teachers, matched },
      });
      return {
        updated,
        linked,
        unknownRolls: unknown.slice(0, 50),
        teachers,
        teachersMatched: matched,
      };
    });
  }
}
