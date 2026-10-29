import { Injectable } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { ScopePolicy } from '../../common/access/scope.policy';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { readSheet, templateSheet } from '../../common/excel/sheet';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { EXAMS, type PutSubjectChoicesDto, type SubjectChoicesUploadDto } from './exams.dto';

type Kind = 'compulsory' | 'optional' | 'additional';
const LETTER: Record<Kind, string> = { compulsory: 'C', optional: 'O', additional: 'A' };
const FROM_LETTER: Record<string, Kind> = {
  C: 'compulsory',
  O: 'optional',
  A: 'additional',
  Y: 'compulsory',
};

export interface ClassSubject {
  id: string;
  code: string;
  name: string;
  elective: boolean;
}

/**
 * Each student's subjects for the year (docs/design/65, part 1): compulsory, optional and additional
 * (the sixth subject, AI, IFM: shown, out of the total), with a stream. A student without choices takes
 * every subject; "Fill the class's subjects" gives the compulsory ones to those without choices. Marks
 * open only for a student's own subjects; the results leave the others (and additional ones) out.
 */
@Injectable()
export class SubjectChoicesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scopes: ScopePolicy,
  ) {}

  private year(tenant: TenantContext): string {
    if (!tenant.academicYearId)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return tenant.academicYearId;
  }

  private async section(c: PoolClient, id: string, yearId: string) {
    const r = await c.query<{ id: string; class_id: string; code: string }>(
      `SELECT cs.id::text, cs.class_id::text, k.code || '-' || cs.name AS code
         FROM class_sections cs JOIN classes k ON k.id = cs.class_id
        WHERE cs.id = $1 AND cs.academic_year_id = $2 AND cs.deleted_at IS NULL`,
      [id, yearId],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Section not found in the working year');
    return r.rows[0];
  }

  /** The class's subjects this year (Academics); none set there: the subjects its exams have. */
  private async subjects(c: PoolClient, classId: string, yearId: string): Promise<ClassSubject[]> {
    const set = await c.query<ClassSubject>(
      `SELECT sub.id::text, sub.code, sub.name, cs.is_elective AS elective
         FROM class_subjects cs JOIN subjects sub ON sub.id = cs.subject_id AND sub.deleted_at IS NULL
        WHERE cs.class_id = $1 AND cs.academic_year_id = $2
        ORDER BY sub.display_order, sub.code`,
      [classId, yearId],
    );
    if (set.rows.length) return set.rows;
    return (
      await c.query<ClassSubject>(
        `SELECT sub.id::text, sub.code, sub.name, bool_or(es.is_elective) AS elective
           FROM exam_subjects es JOIN exams e ON e.id = es.exam_id AND e.academic_year_id = $2 AND e.deleted_at IS NULL
           JOIN subjects sub ON sub.id = es.subject_id
          WHERE es.class_id = $1
          GROUP BY sub.id, sub.code, sub.name, sub.display_order
          ORDER BY sub.display_order, sub.code`,
        [classId, yearId],
      )
    ).rows;
  }

  private async load(c: PoolClient, yearId: string, sectionId: string) {
    const section = await this.section(c, sectionId, yearId);
    const subjects = await this.subjects(c, section.class_id, yearId);
    const r = await c.query<{
      student_id: string;
      name: string;
      admission_no: string;
      roll_no: number | null;
      choices: Array<{ subjectId: string; kind: Kind; stream: string | null }> | null;
    }>(
      `SELECT s.id::text AS student_id, s.display_name AS name, s.admission_no, e.roll_no,
              (SELECT jsonb_agg(jsonb_build_object('subjectId', x.subject_id::text, 'kind', x.kind, 'stream', x.stream) ORDER BY x.id)
                 FROM student_subjects x WHERE x.student_id = s.id AND x.academic_year_id = $2) AS choices
         FROM enrolments e JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
        WHERE e.class_section_id = $1 AND e.academic_year_id = $2 AND e.status = 'active'
        ORDER BY e.roll_no NULLS LAST, s.display_name`,
      [section.id, yearId],
    );
    return {
      section: { id: section.id, code: section.code, classId: section.class_id },
      subjects,
      rows: r.rows.map((x) => ({
        studentId: x.student_id,
        name: x.name,
        admissionNo: x.admission_no,
        rollNo: x.roll_no,
        stream: x.choices?.find((k) => k.stream)?.stream ?? null,
        /** empty: no choices recorded (the student takes every subject) */
        subjects: (x.choices ?? []).map((k) => ({ subjectId: k.subjectId, kind: k.kind })),
      })),
    };
  }

  /** The year's sections the caller may see, for the picker. */
  async sections(ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    const allowed = await this.scopes.filter(tenant, EXAMS.marksView, 'class_section');
    return this.db.tenant(tenant, async (c) => ({
      data: (
        await c.query<{ id: string; code: string; students: number }>(
          `SELECT cs.id::text, k.code || '-' || cs.name AS code,
                  (SELECT count(*)::int FROM enrolments e WHERE e.class_section_id = cs.id AND e.status = 'active') AS students
             FROM class_sections cs JOIN classes k ON k.id = cs.class_id
            WHERE cs.academic_year_id = $1 AND cs.deleted_at IS NULL AND cs.status = 'active'
              AND ($2::bigint[] IS NULL OR cs.id = ANY($2::bigint[]))
            ORDER BY k.display_order, k.code, cs.name`,
          [yearId, allowed],
        )
      ).rows,
    }));
  }

  async list(ctx: RequestContext, sectionId: string) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    await this.scopes.assert(tenant, EXAMS.marksView, 'class_section', sectionId);
    return this.db.tenant(tenant, async (c) => {
      const out = await this.load(c, yearId, sectionId);
      return {
        ...out,
        withChoices: out.rows.filter((r) => r.subjects.length).length,
      };
    });
  }

  private async write(
    c: PoolClient,
    yearId: string,
    rows: PutSubjectChoicesDto['rows'],
    allowed: Set<string>,
    roster: Set<string>,
  ) {
    for (const r of rows) {
      if (!roster.has(r.studentId))
        throw new DomainError('exams.student_not_in_section', 'A student is not in this section', {
          status: 409,
          extra: { studentId: r.studentId },
        });
      const bad = r.subjects.find((x) => !allowed.has(x.subjectId));
      if (bad)
        throw new DomainError('exams.subject_not_in_class', 'A subject is not of this class', {
          status: 409,
          extra: { subjectId: bad.subjectId },
        });
      const ids = new Set(r.subjects.map((x) => x.subjectId));
      if (ids.size !== r.subjects.length)
        throw new DomainError('validation-failed', 'A subject is chosen twice', { status: 400 });
    }
    let changed = 0;
    for (const r of rows) {
      await c.query(
        `DELETE FROM student_subjects WHERE student_id = $1 AND academic_year_id = $2
            AND NOT (subject_id = ANY($3::bigint[]))`,
        [r.studentId, yearId, r.subjects.map((x) => x.subjectId)],
      );
      for (const x of r.subjects) {
        const u = await c.query(
          `INSERT INTO student_subjects (school_id, academic_year_id, student_id, subject_id, kind, stream, created_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, app.current_user_id())
           ON CONFLICT (academic_year_id, student_id, subject_id) DO UPDATE SET kind = EXCLUDED.kind, stream = EXCLUDED.stream
           WHERE student_subjects.kind <> EXCLUDED.kind OR student_subjects.stream IS DISTINCT FROM EXCLUDED.stream`,
          [yearId, r.studentId, x.subjectId, x.kind, r.stream?.trim() || null],
        );
        changed += u.rowCount ?? 0;
      }
    }
    return changed;
  }

  async put(ctx: RequestContext, dto: PutSubjectChoicesDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const cur = await this.load(c, yearId, dto.classSectionId);
      const changed = await this.write(
        c,
        yearId,
        dto.rows,
        new Set(cur.subjects.map((x) => x.id)),
        new Set(cur.rows.map((x) => x.studentId)),
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.subject_choices.set',
        entityType: 'class_sections',
        entityId: dto.classSectionId,
        after: { students: dto.rows.length, changed },
      });
      return { ...(await this.load(c, yearId, dto.classSectionId)), changed };
    });
  }

  /** Students without choices get the class's compulsory (not elective) subjects. */
  async fillDefaults(ctx: RequestContext, sectionId: string) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const cur = await this.load(c, yearId, sectionId);
      const compulsory = cur.subjects.filter((x) => !x.elective);
      if (!compulsory.length)
        throw new DomainError(
          'exams.no_class_subjects',
          'The class has no compulsory subjects: set them under Academics → Subjects',
          { status: 409 },
        );
      const without = cur.rows.filter((r) => !r.subjects.length);
      await this.write(
        c,
        yearId,
        without.map((r) => ({
          studentId: r.studentId,
          stream: null,
          subjects: compulsory.map((x) => ({ subjectId: x.id, kind: 'compulsory' as const })),
        })),
        new Set(cur.subjects.map((x) => x.id)),
        new Set(cur.rows.map((x) => x.studentId)),
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.subject_choices.defaults',
        entityType: 'class_sections',
        entityId: sectionId,
        after: { students: without.length },
      });
      return { ...(await this.load(c, yearId, sectionId)), filled: without.length };
    });
  }

  /** The section's choices as an Excel sheet: a column per subject with C, O, A or empty. */
  async excel(ctx: RequestContext, sectionId: string) {
    const out = await this.list(ctx, sectionId);
    const head = (x: ClassSubject) => `${x.code} · ${x.name}`;
    const bytes = await templateSheet({
      sheet: 'Subjects',
      columns: [
        { header: 'Admission no', width: 16, required: true, format: 'text' },
        { header: 'Name', width: 28 },
        { header: 'Stream', width: 14 },
        ...out.subjects.map((x) => ({
          header: head(x),
          width: 14,
          options: ['C', 'O', 'A'],
          note: x.elective ? 'Elective' : 'Compulsory in the class',
        })),
      ],
      guide: [
        `Subject choices · ${out.section.code}`,
        'For each subject the student takes write C (compulsory), O (optional) or A (additional: shown on the card, kept out of the total); leave it empty when the student does not take it.',
        'A row with every subject empty clears the student’s choices (the student then takes every subject).',
        'Do not change the Admission no column or the subject headings.',
      ],
      rows: out.rows.map((r) => [
        r.admissionNo,
        r.name,
        r.stream,
        ...out.subjects.map((x) => {
          const k = r.subjects.find((v) => v.subjectId === x.id)?.kind;
          return k ? LETTER[k] : null;
        }),
      ]),
    });
    return {
      filename: `subject-choices-${out.section.code}.xlsx`.toLowerCase().replace(/[^\w.-]+/g, '-'),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64: bytes.toString('base64'),
    };
  }

  /** An uploaded choices sheet: checked row by row, saved with `apply` when no row has an error. */
  async upload(ctx: RequestContext, dto: SubjectChoicesUploadDto) {
    const out = await this.list(ctx, dto.classSectionId);
    const heads = out.subjects.map((x) => `${x.code} · ${x.name}`);
    const rows = await readSheet(dto.file, ['Admission no', 'Stream', ...heads]);
    const byNo = new Map(out.rows.map((r) => [r.admissionNo.trim().toLowerCase(), r]));
    const seen = new Set<string>();
    const checked = rows.map(({ row, cells }) => {
      const no = cells['Admission no']!.trim();
      const student = byNo.get(no.toLowerCase());
      let error: string | null = null;
      if (!student) error = `No student with admission no ${no} in ${out.section.code}`;
      else if (seen.has(student.studentId)) error = 'The student is in the sheet twice';
      if (student) seen.add(student.studentId);
      const subjects: Array<{ subjectId: string; kind: Kind }> = [];
      out.subjects.forEach((x, i) => {
        const v = (cells[heads[i]!] ?? '').trim().toUpperCase();
        if (!v) return;
        const kind = FROM_LETTER[v];
        if (!kind) error ??= `${x.code}: write C, O or A (not ${v})`;
        else subjects.push({ subjectId: x.id, kind });
      });
      return {
        row,
        admissionNo: no,
        name: student?.name ?? null,
        studentId: student?.studentId ?? null,
        stream: (cells.Stream ?? '').trim() || null,
        subjects,
        error,
      };
    });
    const errors = checked.filter((x) => x.error).length;
    const preview = {
      rows: checked.map((x) => ({
        row: x.row,
        admissionNo: x.admissionNo,
        name: x.name,
        subjects: x.subjects.length,
        error: x.error,
      })),
      ready: checked.filter((x) => !x.error).length,
      errors,
      applied: false,
    };
    if (!dto.apply || errors || !preview.ready) return preview;
    await this.put(ctx, {
      classSectionId: dto.classSectionId,
      rows: checked.map((x) => ({
        studentId: x.studentId!,
        stream: x.stream,
        subjects: x.subjects,
      })),
    });
    return { ...preview, applied: true };
  }
}
