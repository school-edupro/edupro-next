import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { PoolClient, TenantContext } from '@edupro/db';
import { ScopePolicy } from '../../common/access/scope.policy';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { readSheet, templateSheet } from '../../common/excel/sheet';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { tablePdf } from '../engagement/table-pdf';
import {
  EXAMS,
  type PutSubjectChoicesDto,
  type PutSubjectSetupDto,
  type SubjectChoicesUploadDto,
} from './exams.dto';

type Kind = 'compulsory' | 'optional' | 'additional';
type Take = 'all' | 'group' | 'free';

export interface ClassSubject {
  id: string;
  code: string;
  name: string;
  elective: boolean;
  /** all: compulsory; group: one of a choice group; free: an elective anyone may take */
  take: Take;
  groupId: string | null;
  /** the class's place for it; null: not placed yet (after the placed ones) */
  order: number | null;
}
export interface SubjectGroup {
  id: string;
  name: string;
  kind: 'optional' | 'additional';
  min: number;
  max: number;
  subjectIds: string[];
}
export interface ClassStream {
  id: string;
  name: string;
  subjectIds: string[];
}
export interface Setup {
  /** the class has no subjects under Academics: its exams' subjects are offered (no groups, streams) */
  fromExams: boolean;
  /** the class's order is set (otherwise the subject master's order) */
  placed: boolean;
  subjects: ClassSubject[];
  groups: SubjectGroup[];
  streams: ClassStream[];
}
export interface ChoiceRow {
  studentId: string;
  name: string;
  admissionNo: string;
  rollNo: number | null;
  stream: string | null;
  /** empty: no choices recorded (the student takes every subject) */
  subjects: Array<{ subjectId: string; kind: Kind }>;
  /** subjects with marks this year (a mark changed to NA does not count): not taken off */
  marked: string[];
}

/**
 * Each student's subjects for the year (docs/design/65 part 1, docs/design/67): the class's subjects in
 * the order printed, each compulsory, one of a choice group (that counts in the total, or an additional
 * one kept out of it) or a free elective, and the class's streams. A student's list is the compulsory
 * subjects, the stream's and those picked; a student without choices takes every subject. Marks open only
 * for a student's own subjects; the results and the cards leave the others out.
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
    const r = await c.query<{ id: string; class_id: string; code: string; class_name: string }>(
      `SELECT cs.id::text, cs.class_id::text, k.code || '-' || cs.name AS code, k.name AS class_name
         FROM class_sections cs JOIN classes k ON k.id = cs.class_id
        WHERE cs.id = $1 AND cs.academic_year_id = $2 AND cs.deleted_at IS NULL`,
      [id, yearId],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Section not found in the working year');
    return r.rows[0];
  }

  /**
   * The class's subjects this year (Academics) in the class's order, with its groups and streams; none
   * set there: the subjects its exams have, in the subject master's order.
   */
  private async setupOf(c: PoolClient, classId: string, yearId: string): Promise<Setup> {
    const set = await c.query<{
      id: string;
      code: string;
      name: string;
      elective: boolean;
      group_id: string | null;
      sort_order: number | null;
    }>(
      `SELECT sub.id::text, sub.code, sub.name, cs.is_elective AS elective, cs.group_id::text, cs.sort_order
         FROM class_subjects cs JOIN subjects sub ON sub.id = cs.subject_id AND sub.deleted_at IS NULL
        WHERE cs.class_id = $1 AND cs.academic_year_id = $2
        ORDER BY app.subject_seq(cs.class_id, cs.academic_year_id, cs.subject_id), sub.code`,
      [classId, yearId],
    );
    if (!set.rows.length) {
      const ex = await c.query<{ id: string; code: string; name: string; elective: boolean }>(
        `SELECT sub.id::text, sub.code, sub.name, bool_or(es.is_elective) AS elective
           FROM exam_subjects es JOIN exams e ON e.id = es.exam_id AND e.academic_year_id = $2 AND e.deleted_at IS NULL
           JOIN subjects sub ON sub.id = es.subject_id
          WHERE es.class_id = $1
          GROUP BY sub.id, sub.code, sub.name
          ORDER BY app.subject_seq($1, $2, sub.id), sub.code`,
        [classId, yearId],
      );
      return {
        fromExams: true,
        placed: false,
        subjects: ex.rows.map((x) => ({
          ...x,
          // no set-up: each student's subjects are ticked one by one (kinds as given)
          take: 'free',
          groupId: null,
          order: null,
        })),
        groups: [],
        streams: [],
      };
    }
    const subjects: ClassSubject[] = set.rows.map((x) => ({
      id: x.id,
      code: x.code,
      name: x.name,
      elective: x.elective,
      take: x.group_id ? 'group' : x.elective ? 'free' : 'all',
      groupId: x.group_id,
      order: x.sort_order,
    }));
    const g = await c.query<{
      id: string;
      name: string;
      kind: 'optional' | 'additional';
      pick_min: number;
      pick_max: number;
    }>(
      `SELECT id::text, name, kind, pick_min, pick_max FROM subject_groups
        WHERE class_id = $1 AND academic_year_id = $2 ORDER BY name`,
      [classId, yearId],
    );
    const first = (id: string) => {
      const i = subjects.findIndex((s) => s.groupId === id);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    const groups = g.rows
      .map((x) => ({
        id: x.id,
        name: x.name,
        kind: x.kind,
        min: x.pick_min,
        max: x.pick_max,
        subjectIds: subjects.filter((s) => s.groupId === x.id).map((s) => s.id),
      }))
      .sort((a, b) => first(a.id) - first(b.id) || a.name.localeCompare(b.name));
    const st = await c.query<{ id: string; name: string; subject_ids: string[] | null }>(
      `SELECT st.id::text, st.name,
              array_agg(cs.subject_id::text ORDER BY app.subject_seq(cs.class_id, cs.academic_year_id, cs.subject_id))
                FILTER (WHERE cs.id IS NOT NULL) AS subject_ids
         FROM class_streams st
         LEFT JOIN class_stream_subjects x ON x.stream_id = st.id
         LEFT JOIN class_subjects cs ON cs.id = x.class_subject_id
        WHERE st.class_id = $1 AND st.academic_year_id = $2
        GROUP BY st.id, st.name, st.sort_order ORDER BY st.sort_order, st.name`,
      [classId, yearId],
    );
    return {
      fromExams: false,
      placed: subjects.some((s) => s.order !== null),
      subjects,
      groups,
      streams: st.rows.map((x) => ({ id: x.id, name: x.name, subjectIds: x.subject_ids ?? [] })),
    };
  }

  private async load(c: PoolClient, yearId: string, sectionId: string) {
    const section = await this.section(c, sectionId, yearId);
    const setup = await this.setupOf(c, section.class_id, yearId);
    const r = await c.query<{
      student_id: string;
      name: string;
      admission_no: string;
      roll_no: number | null;
      choices: Array<{ subjectId: string; kind: Kind; stream: string | null }> | null;
      marked: string[] | null;
    }>(
      `SELECT s.id::text AS student_id, s.display_name AS name, s.admission_no, e.roll_no,
              (SELECT jsonb_agg(jsonb_build_object('subjectId', x.subject_id::text, 'kind', x.kind, 'stream', x.stream) ORDER BY x.id)
                 FROM student_subjects x WHERE x.student_id = s.id AND x.academic_year_id = $2) AS choices,
              (SELECT array_agg(DISTINCT t.subject_id::text) FROM (
                 SELECT es.subject_id FROM mark_entries m JOIN exam_subjects es ON es.id = m.exam_subject_id
                   JOIN exams x ON x.id = es.exam_id AND x.academic_year_id = $2 AND x.deleted_at IS NULL
                  WHERE m.student_id = s.id AND m.code IS DISTINCT FROM 'NA'
                 UNION
                 SELECT es.subject_id FROM mark_part_entries pe JOIN exam_subject_parts p ON p.id = pe.part_id
                   JOIN exam_subjects es ON es.id = p.exam_subject_id
                   JOIN exams x ON x.id = es.exam_id AND x.academic_year_id = $2 AND x.deleted_at IS NULL
                  WHERE pe.student_id = s.id) t) AS marked
         FROM enrolments e JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
        WHERE e.class_section_id = $1 AND e.academic_year_id = $2 AND e.status = 'active'
        ORDER BY e.roll_no NULLS LAST, s.display_name`,
      [section.id, yearId],
    );
    const rows: ChoiceRow[] = r.rows.map((x) => ({
      studentId: x.student_id,
      name: x.name,
      admissionNo: x.admission_no,
      rollNo: x.roll_no,
      stream: x.choices?.find((k) => k.stream)?.stream ?? null,
      subjects: (x.choices ?? []).map((k) => ({ subjectId: k.subjectId, kind: k.kind })),
      marked: x.marked ?? [],
    }));
    return {
      section: {
        id: section.id,
        code: section.code,
        classId: section.class_id,
        className: section.class_name,
      },
      ...setup,
      rows,
    };
  }

  /** The kind of a subject for a student: compulsory for everyone, the group's, or optional. */
  private kindOf(setup: Setup, subjectId: string): Kind {
    const s = setup.subjects.find((x) => x.id === subjectId);
    if (!s || s.take === 'all') return 'compulsory';
    if (s.take === 'group')
      return setup.groups.find((g) => g.id === s.groupId)?.kind === 'additional'
        ? 'additional'
        : 'optional';
    return 'optional';
  }

  /**
   * A student's whole list from what was picked: the compulsory subjects and the stream's come with it,
   * kinds follow the set-up (without one, the kinds given are kept). Returns the problem instead, if any.
   */
  private plan(
    setup: Setup,
    row: ChoiceRow,
    stream: string | null,
    picked: Array<{ subjectId: string; kind?: Kind }>,
  ): { error: string } | { stream: string | null; list: Map<string, Kind> } {
    const known = new Set(setup.subjects.map((x) => x.id));
    const bad = picked.find((x) => !known.has(x.subjectId));
    if (bad) return { error: 'A subject is not of this class' };
    if (new Set(picked.map((x) => x.subjectId)).size !== picked.length)
      return { error: 'A subject is chosen twice' };
    const code = (id: string) => setup.subjects.find((x) => x.id === id)?.code ?? id;
    const list = new Map<string, Kind>();
    let label = stream?.trim() || null;
    if (setup.fromExams) {
      const had = new Map(row.subjects.map((x) => [x.subjectId, x.kind]));
      for (const x of picked) list.set(x.subjectId, x.kind ?? had.get(x.subjectId) ?? 'compulsory');
    } else {
      if (label && setup.streams.length) {
        const s = setup.streams.find((x) => x.name.toLowerCase() === label!.toLowerCase());
        if (!s)
          return {
            error: `${label} is not a stream of the class (${setup.streams.map((x) => x.name).join(', ')})`,
          };
        label = s.name;
        for (const id of s.subjectIds) list.set(id, this.kindOf(setup, id));
      }
      for (const x of picked) list.set(x.subjectId, this.kindOf(setup, x.subjectId));
      if (list.size || label)
        for (const s of setup.subjects) if (s.take === 'all') list.set(s.id, 'compulsory');
      for (const g of setup.groups) {
        const n = g.subjectIds.filter((id) => list.has(id)).length;
        if (n > g.max)
          return {
            error: `${g.name}: pick at most ${String(g.max)} (${g.subjectIds
              .filter((id) => list.has(id))
              .map(code)
              .join(', ')})`,
          };
      }
    }
    // a subject with marks stays (no list at all: the student takes every subject, it stays too)
    const dropped = list.size ? row.marked.filter((id) => !list.has(id)) : [];
    if (dropped.length)
      return {
        error: `Has marks in ${dropped.map(code).join(', ')} this year: mark them NA (not applicable) on the marks sheet before taking the subject off`,
      };
    return { stream: label, list };
  }

  private async write(
    c: PoolClient,
    yearId: string,
    lists: Array<{ studentId: string; stream: string | null; list: Map<string, Kind> }>,
  ) {
    let changed = 0;
    for (const r of lists) {
      const ids = [...r.list.keys()];
      const d = await c.query(
        `DELETE FROM student_subjects WHERE student_id = $1 AND academic_year_id = $2
            AND NOT (subject_id = ANY($3::bigint[]))`,
        [r.studentId, yearId, ids],
      );
      changed += d.rowCount ?? 0;
      for (const [subjectId, kind] of r.list) {
        const u = await c.query(
          `INSERT INTO student_subjects (school_id, academic_year_id, student_id, subject_id, kind, stream, created_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, app.current_user_id())
           ON CONFLICT (academic_year_id, student_id, subject_id) DO UPDATE SET kind = EXCLUDED.kind, stream = EXCLUDED.stream
           WHERE student_subjects.kind <> EXCLUDED.kind OR student_subjects.stream IS DISTINCT FROM EXCLUDED.stream`,
          [yearId, r.studentId, subjectId, kind, r.stream],
        );
        changed += u.rowCount ?? 0;
      }
    }
    return changed;
  }

  /** The office (exams.choices.manage, in its scope) or the section's class teacher. */
  private async mayEdit(ctx: RequestContext, tenant: TenantContext, sectionIds: string[]) {
    const out = new Set<string>();
    if (ctx.permissions?.has(EXAMS.choicesManage)) {
      const allowed = await this.scopes.filter(tenant, EXAMS.choicesManage, 'class_section');
      for (const id of sectionIds) if (allowed === null || allowed.includes(id)) out.add(id);
    }
    if (out.size < sectionIds.length && ctx.permissions?.has(EXAMS.marksEnter)) {
      const mine = await this.db.tenant(tenant, (c) =>
        c.query<{ id: string }>(
          `SELECT ta.class_section_id::text AS id FROM teacher_assignments ta JOIN employees e ON e.id = ta.employee_id
            WHERE e.user_id = app.current_user_id() AND ta.kind = 'class_teacher' AND ta.valid_to IS NULL
              AND ta.class_section_id = ANY($1::bigint[])`,
          [sectionIds],
        ),
      );
      for (const x of mine.rows) out.add(x.id);
    }
    return out;
  }

  private async assertEdit(ctx: RequestContext, tenant: TenantContext, sectionId: string) {
    if (!(await this.mayEdit(ctx, tenant, [sectionId])).has(sectionId))
      throw new DomainError(
        'forbidden',
        "Subject choices are set by the office or the section's class teacher",
        { status: 403 },
      );
  }

  /** The year's sections the caller may see, for the picker, and whether the caller sets their choices. */
  async sections(ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    const allowed = await this.scopes.filter(tenant, EXAMS.marksView, 'class_section');
    const rows = await this.db.tenant(
      tenant,
      async (c) =>
        (
          await c.query<{
            id: string;
            code: string;
            class_id: string;
            class_code: string;
            class_name: string;
            students: number;
          }>(
            `SELECT cs.id::text, k.code || '-' || cs.name AS code, k.id::text AS class_id, k.code AS class_code, k.name AS class_name,
                  (SELECT count(*)::int FROM enrolments e WHERE e.class_section_id = cs.id AND e.status = 'active') AS students
             FROM class_sections cs JOIN classes k ON k.id = cs.class_id
            WHERE cs.academic_year_id = $1 AND cs.deleted_at IS NULL AND cs.status = 'active'
              AND ($2::bigint[] IS NULL OR cs.id = ANY($2::bigint[]))
            ORDER BY k.display_order, k.code, cs.name`,
            [yearId, allowed],
          )
        ).rows,
    );
    const edit = await this.mayEdit(
      ctx,
      tenant,
      rows.map((x) => x.id),
    );
    return {
      data: rows.map((x) => ({
        id: x.id,
        code: x.code,
        classId: x.class_id,
        classCode: x.class_code,
        className: x.class_name,
        students: x.students,
        canEdit: edit.has(x.id),
      })),
    };
  }

  async list(ctx: RequestContext, sectionId: string) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    await this.scopes.assert(tenant, EXAMS.marksView, 'class_section', sectionId);
    const canEdit = (await this.mayEdit(ctx, tenant, [sectionId])).has(sectionId);
    return this.db.tenant(tenant, async (c) => {
      const out = await this.load(c, yearId, sectionId);
      return {
        ...out,
        withChoices: out.rows.filter((r) => r.subjects.length).length,
        canEdit,
        canSetUp: ctx.permissions?.has(EXAMS.masterManage) ?? false,
      };
    });
  }

  async put(ctx: RequestContext, dto: PutSubjectChoicesDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    await this.assertEdit(ctx, tenant, dto.classSectionId);
    return this.db.tenant(tenant, async (c) => {
      const cur = await this.load(c, yearId, dto.classSectionId);
      const lists = dto.rows.map((r) => {
        const row = cur.rows.find((x) => x.studentId === r.studentId);
        if (!row)
          throw new DomainError(
            'exams.student_not_in_section',
            'A student is not in this section',
            {
              status: 409,
              extra: { studentId: r.studentId },
            },
          );
        const p = this.plan(cur, row, r.stream ?? null, r.subjects);
        if ('error' in p)
          throw new DomainError('exams.choice_refused', `${row.name}: ${p.error}`, {
            status: 409,
            extra: { studentId: r.studentId },
          });
        return { studentId: r.studentId, ...p };
      });
      const changed = await this.write(c, yearId, lists);
      await this.audit.stage(ctx, c, {
        action: 'exams.subject_choices.set',
        entityType: 'class_sections',
        entityId: dto.classSectionId,
        after: { students: dto.rows.length, changed },
      });
      return { ...(await this.load(c, yearId, dto.classSectionId)), changed };
    });
  }

  /** Students without choices get the class's compulsory subjects. */
  async fillDefaults(ctx: RequestContext, sectionId: string) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    await this.assertEdit(ctx, tenant, sectionId);
    return this.db.tenant(tenant, async (c) => {
      const cur = await this.load(c, yearId, sectionId);
      const compulsory = cur.subjects.filter((x) => !x.elective);
      if (!compulsory.length)
        throw new DomainError(
          'exams.no_class_subjects',
          'The class has no compulsory subjects: map them under Masters → Class and subject mapping',
          { status: 409 },
        );
      const without = cur.rows.filter((r) => !r.subjects.length);
      await this.write(
        c,
        yearId,
        without.map((r) => ({
          studentId: r.studentId,
          stream: null,
          list: new Map(compulsory.map((x) => [x.id, 'compulsory' as const])),
        })),
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

  /**
   * Students without choices this year take their last year's (XI → XII): the subjects the class has
   * this year and the stream, when it is one of the class's.
   */
  async lastYear(ctx: RequestContext, sectionId: string) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    await this.assertEdit(ctx, tenant, sectionId);
    return this.db.tenant(tenant, async (c) => {
      const cur = await this.load(c, yearId, sectionId);
      if (cur.fromExams)
        throw new DomainError(
          'exams.no_class_subjects',
          "Map the class's subjects first (Masters → Class and subject mapping)",
          { status: 409 },
        );
      const without = cur.rows.filter((r) => !r.subjects.length);
      const prev = await c.query<{ student_id: string; subject_id: string; stream: string | null }>(
        `WITH last AS (
           SELECT DISTINCT ON (x.student_id) x.student_id, x.academic_year_id
             FROM student_subjects x JOIN academic_years y ON y.id = x.academic_year_id
            WHERE x.student_id = ANY($1::bigint[])
              AND y.start_date < (SELECT start_date FROM academic_years WHERE id = $2)
            ORDER BY x.student_id, y.start_date DESC)
         SELECT x.student_id::text, x.subject_id::text, x.stream
           FROM student_subjects x JOIN last l ON l.student_id = x.student_id AND l.academic_year_id = x.academic_year_id`,
        [without.map((r) => r.studentId), yearId],
      );
      const known = new Set(cur.subjects.map((x) => x.id));
      const lists: Array<{ studentId: string; stream: string | null; list: Map<string, Kind> }> =
        [];
      let skipped = 0;
      for (const r of without) {
        const had = prev.rows.filter((x) => x.student_id === r.studentId);
        if (!had.length) continue;
        const stream = had.find((x) => x.stream)?.stream ?? null;
        const okStream =
          stream && (!cur.streams.length || cur.streams.some((s) => s.name === stream))
            ? stream
            : null;
        const p = this.plan(
          cur,
          r,
          okStream,
          had.filter((x) => known.has(x.subject_id)).map((x) => ({ subjectId: x.subject_id })),
        );
        if ('error' in p) skipped += 1;
        else lists.push({ studentId: r.studentId, ...p });
      }
      await this.write(c, yearId, lists);
      await this.audit.stage(ctx, c, {
        action: 'exams.subject_choices.last_year',
        entityType: 'class_sections',
        entityId: sectionId,
        after: { students: lists.length, skipped },
      });
      return { ...(await this.load(c, yearId, sectionId)), copied: lists.length, skipped };
    });
  }

  // ---- the class's set-up: order, groups, streams -------------------------------------------------
  private async classOf(c: PoolClient, classId: string) {
    const r = await c.query<{ id: string; code: string; name: string }>(
      `SELECT id::text, code, name FROM classes WHERE id = $1 AND deleted_at IS NULL`,
      [classId],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Class not found', { status: 404 });
    return r.rows[0];
  }

  async setup(ctx: RequestContext, classId: string) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => ({
      class: await this.classOf(c, classId),
      ...(await this.setupOf(c, classId, yearId)),
    }));
  }

  /**
   * The class's subjects in the order printed, who takes each (everyone, a group, anyone who picks it),
   * its groups and streams. Students' choices follow: the compulsory subjects are added to those with
   * choices and every kind is set again from the groups.
   */
  async putSetup(ctx: RequestContext, dto: PutSubjectSetupDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const cls = await this.classOf(c, dto.classId);
      const cur = await this.setupOf(c, dto.classId, yearId);
      if (cur.fromExams)
        throw new DomainError(
          'exams.no_class_subjects',
          "Map the class's subjects first (Masters → Class and subject mapping)",
          { status: 409 },
        );
      const known = new Map(cur.subjects.map((x) => [x.id, x]));
      const given = new Set(dto.subjects.map((x) => x.subjectId));
      if (given.size !== dto.subjects.length)
        throw new DomainError('validation-failed', 'A subject is placed twice', { status: 400 });
      const stray = dto.subjects.find((x) => !known.has(x.subjectId));
      if (stray)
        throw new DomainError('exams.subject_not_in_class', 'A subject is not of this class', {
          status: 409,
          extra: { subjectId: stray.subjectId },
        });
      const left = cur.subjects.filter((x) => !given.has(x.id));
      if (left.length)
        throw new DomainError(
          'validation-failed',
          `Place every subject of the class (${left.map((x) => x.code).join(', ')})`,
          { status: 400 },
        );
      const names = new Set<string>();
      for (const g of dto.groups) {
        if (names.has(g.name.toLowerCase()))
          throw new DomainError('validation-failed', `Two groups are called ${g.name}`, {
            status: 400,
          });
        names.add(g.name.toLowerCase());
        const n = dto.subjects.filter((x) => x.take === 'group' && x.group === g.key).length;
        if (!n)
          throw new DomainError('exams.group_empty', `${g.name} has no subject`, { status: 409 });
        if (g.max > n)
          throw new DomainError(
            'exams.group_pick',
            `${g.name}: pick at most ${String(n)} (it has ${String(n)} subject${n === 1 ? '' : 's'})`,
            { status: 409 },
          );
      }
      const lone = dto.subjects.find(
        (x) => x.take === 'group' && !dto.groups.some((g) => g.key === x.group),
      );
      if (lone)
        throw new DomainError(
          'validation-failed',
          `${known.get(lone.subjectId)!.code}: choose its group`,
          { status: 400 },
        );
      const streamNames = new Set<string>();
      for (const s of dto.streams) {
        if (streamNames.has(s.name.toLowerCase()))
          throw new DomainError('validation-failed', `Two streams are called ${s.name}`, {
            status: 400,
          });
        streamNames.add(s.name.toLowerCase());
        if (s.subjectIds.some((id) => !known.has(id)))
          throw new DomainError('exams.subject_not_in_class', 'A subject is not of this class', {
            status: 409,
          });
      }

      // groups by name: kept, changed, added; the rest go (their subjects with them)
      const old = new Map(cur.groups.map((g) => [g.name.toLowerCase(), g.id]));
      const ids = new Map<string, string>();
      for (const g of dto.groups) {
        const id = old.get(g.name.toLowerCase());
        const r = id
          ? await c.query<{ id: string }>(
              `UPDATE subject_groups SET name = $2, kind = $3, pick_min = $4, pick_max = $5,
                      updated_by = app.current_user_id(), updated_at = now()
                WHERE id = $1 RETURNING id::text`,
              [id, g.name, g.kind, g.min, g.max],
            )
          : await c.query<{ id: string }>(
              `INSERT INTO subject_groups (school_id, academic_year_id, class_id, name, kind, pick_min, pick_max, updated_by)
               VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, app.current_user_id()) RETURNING id::text`,
              [yearId, dto.classId, g.name, g.kind, g.min, g.max],
            );
        ids.set(g.key, r.rows[0]!.id);
      }
      await c.query(
        `UPDATE class_subjects SET group_id = NULL WHERE class_id = $1 AND academic_year_id = $2 AND group_id IS NOT NULL`,
        [dto.classId, yearId],
      );
      await c.query(
        `DELETE FROM subject_groups WHERE class_id = $1 AND academic_year_id = $2 AND NOT (id = ANY($3::bigint[]))`,
        [dto.classId, yearId, [...ids.values()]],
      );
      for (const [i, s] of dto.subjects.entries())
        await c.query(
          `UPDATE class_subjects SET sort_order = $4, is_elective = $5, group_id = $6
            WHERE class_id = $1 AND academic_year_id = $2 AND subject_id = $3`,
          [
            dto.classId,
            yearId,
            s.subjectId,
            i + 1,
            s.take !== 'all',
            s.take === 'group' ? ids.get(s.group!)! : null,
          ],
        );

      // streams by name, with their subjects (the compulsory ones come anyway)
      const oldStreams = new Map(cur.streams.map((s) => [s.name.toLowerCase(), s.id]));
      const streamIds: string[] = [];
      for (const [i, s] of dto.streams.entries()) {
        const id = oldStreams.get(s.name.toLowerCase());
        const r = id
          ? await c.query<{ id: string }>(
              `UPDATE class_streams SET name = $2, sort_order = $3, updated_by = app.current_user_id(), updated_at = now()
                WHERE id = $1 RETURNING id::text`,
              [id, s.name, i + 1],
            )
          : await c.query<{ id: string }>(
              `INSERT INTO class_streams (school_id, academic_year_id, class_id, name, sort_order, updated_by)
               VALUES (app.current_school_id(), $1, $2, $3, $4, app.current_user_id()) RETURNING id::text`,
              [yearId, dto.classId, s.name, i + 1],
            );
        const sid = r.rows[0]!.id;
        streamIds.push(sid);
        const keep = s.subjectIds.filter(
          (id) => dto.subjects.find((x) => x.subjectId === id)?.take !== 'all',
        );
        await c.query(
          `DELETE FROM class_stream_subjects x USING class_subjects cs
            WHERE x.stream_id = $1 AND cs.id = x.class_subject_id AND NOT (cs.subject_id = ANY($2::bigint[]))`,
          [sid, keep],
        );
        await c.query(
          `INSERT INTO class_stream_subjects (school_id, stream_id, class_subject_id)
           SELECT app.current_school_id(), $1, cs.id FROM class_subjects cs
            WHERE cs.class_id = $2 AND cs.academic_year_id = $3 AND cs.subject_id = ANY($4::bigint[])
           ON CONFLICT DO NOTHING`,
          [sid, dto.classId, yearId, keep],
        );
      }
      await c.query(
        `DELETE FROM class_streams WHERE class_id = $1 AND academic_year_id = $2 AND NOT (id = ANY($3::bigint[]))`,
        [dto.classId, yearId, streamIds],
      );

      // the students who have choices: the compulsory subjects added, every kind from the set-up
      const added = await c.query(
        `INSERT INTO student_subjects (school_id, academic_year_id, student_id, subject_id, kind, stream, created_by)
         SELECT app.current_school_id(), $2, x.student_id, cs.subject_id, 'compulsory',
                (SELECT max(y.stream) FROM student_subjects y WHERE y.student_id = x.student_id AND y.academic_year_id = $2),
                app.current_user_id()
           FROM (SELECT DISTINCT student_id FROM student_subjects
                  WHERE academic_year_id = $2 AND student_id IN (SELECT en.student_id FROM enrolments en JOIN class_sections s ON s.id = en.class_section_id
                    WHERE s.class_id = $1 AND en.academic_year_id = $2 AND en.status = 'active')) x
           JOIN class_subjects cs ON cs.class_id = $1 AND cs.academic_year_id = $2 AND NOT cs.is_elective
         ON CONFLICT DO NOTHING`,
        [dto.classId, yearId],
      );
      const rekinded = await c.query(
        `UPDATE student_subjects x
            SET kind = CASE WHEN NOT cs.is_elective THEN 'compulsory' WHEN g.kind = 'additional' THEN 'additional' ELSE 'optional' END
           FROM class_subjects cs LEFT JOIN subject_groups g ON g.id = cs.group_id
          WHERE cs.class_id = $1 AND cs.academic_year_id = $2 AND x.academic_year_id = $2 AND x.subject_id = cs.subject_id
            AND x.student_id IN (SELECT en.student_id FROM enrolments en JOIN class_sections s ON s.id = en.class_section_id
                    WHERE s.class_id = $1 AND en.academic_year_id = $2 AND en.status = 'active')
            AND x.kind <> CASE WHEN NOT cs.is_elective THEN 'compulsory' WHEN g.kind = 'additional' THEN 'additional' ELSE 'optional' END`,
        [dto.classId, yearId],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.subject_setup.set',
        entityType: 'classes',
        entityId: dto.classId,
        before: {
          order: cur.subjects.map((x) => x.code),
          groups: cur.groups.map((g) => g.name),
          streams: cur.streams.map((s) => s.name),
        },
        after: {
          order: dto.subjects.map((x) => known.get(x.subjectId)!.code),
          groups: dto.groups.map((g) => g.name),
          streams: dto.streams.map((s) => s.name),
          added: added.rowCount ?? 0,
          rekinded: rekinded.rowCount ?? 0,
        },
      });
      return {
        class: cls,
        ...(await this.setupOf(c, dto.classId, yearId)),
        added: added.rowCount ?? 0,
        rekinded: rekinded.rowCount ?? 0,
      };
    });
  }

  // ---- counts --------------------------------------------------------------------------------------
  /** How many students take each subject, section by section (the legacy "Subject count report"). */
  async counts(ctx: RequestContext, classId: string) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    const allowed = await this.scopes.filter(tenant, EXAMS.marksView, 'class_section');
    return this.db.tenant(tenant, async (c) => {
      const cls = await this.classOf(c, classId);
      const setup = await this.setupOf(c, classId, yearId);
      const sec = await c.query<{ id: string; code: string; students: number; not_set: number }>(
        `SELECT cs.id::text, k.code || '-' || cs.name AS code, count(en.id)::int AS students,
                count(en.id) FILTER (WHERE NOT EXISTS (SELECT 1 FROM student_subjects x
                   WHERE x.student_id = en.student_id AND x.academic_year_id = $2))::int AS not_set
           FROM class_sections cs JOIN classes k ON k.id = cs.class_id
           LEFT JOIN enrolments en ON en.class_section_id = cs.id AND en.academic_year_id = $2 AND en.status = 'active'
          WHERE cs.class_id = $1 AND cs.academic_year_id = $2 AND cs.deleted_at IS NULL
            AND ($3::bigint[] IS NULL OR cs.id = ANY($3::bigint[]))
          GROUP BY cs.id, k.code, cs.name ORDER BY cs.name`,
        [classId, yearId, allowed],
      );
      const n = await c.query<{ section_id: string; subject_id: string; n: number }>(
        `SELECT cs.id::text AS section_id, x.subject_id::text, count(*)::int AS n
           FROM class_sections cs
           JOIN enrolments en ON en.class_section_id = cs.id AND en.academic_year_id = $1 AND en.status = 'active'
           CROSS JOIN unnest($2::bigint[]) AS x(subject_id)
          WHERE cs.id = ANY($3::bigint[])
            AND app.student_subject_kind(en.student_id, $1, x.subject_id) IS NOT NULL
          GROUP BY cs.id, x.subject_id`,
        [yearId, setup.subjects.map((x) => x.id), sec.rows.map((x) => x.id)],
      );
      const sections = sec.rows.map((s) => ({
        id: s.id,
        code: s.code,
        students: s.students,
        notSet: s.not_set,
        counts: Object.fromEntries(
          n.rows.filter((x) => x.section_id === s.id).map((x) => [x.subject_id, x.n]),
        ) as Record<string, number>,
      }));
      return {
        class: cls,
        subjects: setup.subjects,
        groups: setup.groups,
        sections,
        total: {
          students: sections.reduce((a, s) => a + s.students, 0),
          notSet: sections.reduce((a, s) => a + s.notSet, 0),
          counts: Object.fromEntries(
            setup.subjects.map((x) => [
              x.id,
              sections.reduce((a, s) => a + (s.counts[x.id] ?? 0), 0),
            ]),
          ) as Record<string, number>,
        },
      };
    });
  }

  async countsFile(ctx: RequestContext, classId: string, format: 'xlsx' | 'pdf') {
    const out = await this.counts(ctx, classId);
    const school = await this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ name: string }>(
        `SELECT name FROM schools WHERE id = app.current_school_id()`,
      );
      return r.rows[0]?.name ?? '';
    });
    const TAKE: Record<Take, string> = { all: 'Compulsory', group: '', free: 'Elective' };
    const head = ['Subject', 'Taken by', ...out.sections.map((s) => s.code), 'Total'];
    const body = out.subjects.map((x) => [
      `${x.name} (${x.code})`,
      x.take === 'group' ? (out.groups.find((g) => g.id === x.groupId)?.name ?? '') : TAKE[x.take],
      ...out.sections.map((s) => s.counts[x.id] ?? 0),
      out.total.counts[x.id] ?? 0,
    ]);
    body.push(['Students', '', ...out.sections.map((s) => s.students), out.total.students]);
    body.push(['No choices yet', '', ...out.sections.map((s) => s.notSet), out.total.notSet]);
    const title = `Subject counts · ${out.class.name}`;
    const stamp = `subject-counts-${out.class.code}`.toLowerCase().replace(/[^\w.-]+/g, '-');
    if (format === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Counts');
      ws.addRow([title]).font = { bold: true, size: 13 };
      ws.addRow([school]);
      ws.addRow(head).font = { bold: true };
      for (const line of body) ws.addRow(line);
      ws.getColumn(1).width = 30;
      ws.getColumn(2).width = 18;
      ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 3 }];
      return {
        filename: `${stamp}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
      };
    }
    const bytes = await tablePdf({
      school,
      title,
      subtitle: ['Students taking each subject, section by section'],
      columns: head.map((label, i) => ({
        label,
        width: i === 0 ? 4 : i === 1 ? 2.4 : 1.2,
        right: i > 1,
      })),
      rows: body.map((r) => r.map(String)),
    });
    return {
      filename: `${stamp}.pdf`,
      contentType: 'application/pdf',
      base64: bytes.toString('base64'),
    };
  }

  // ---- Excel -----------------------------------------------------------------------------------------
  /** The columns of the choices sheet: the stream, a column per group, then the free electives. */
  private sheetColumns(out: Setup & { rows: ChoiceRow[] }) {
    const free = out.subjects.filter((x) => x.take === 'free');
    const codes = (ids: string[]) =>
      ids.map((id) => out.subjects.find((x) => x.id === id)!.code).join(', ');
    return {
      stream: out.streams.length > 0 || out.rows.some((r) => r.stream),
      groups: out.groups.map((g) => ({
        g,
        header: g.name,
        note: `${g.kind === 'additional' ? 'Additional (kept out of the total)' : 'Counts in the total'}: pick ${g.min === g.max ? String(g.max) : `${String(g.min)} to ${String(g.max)}`} of ${codes(g.subjectIds)}`,
      })),
      free,
      freeHeader: out.fromExams ? 'Subjects' : 'Other subjects',
    };
  }

  /** The section's choices as an Excel sheet: the stream, a column per group, the other electives. */
  async excel(ctx: RequestContext, sectionId: string) {
    const out = await this.list(ctx, sectionId);
    const cols = this.sheetColumns(out);
    const code = (id: string) => out.subjects.find((x) => x.id === id)?.code ?? '';
    const compulsory = out.subjects.filter((x) => x.take === 'all').map((x) => x.code);
    const bytes = await templateSheet({
      sheet: 'Subjects',
      columns: [
        { header: 'Admission no', width: 16, required: true, format: 'text' },
        { header: 'Name', width: 28 },
        ...(cols.stream
          ? [
              {
                header: 'Stream',
                width: 18,
                ...(out.streams.length ? { options: out.streams.map((s) => s.name) } : {}),
              },
            ]
          : []),
        ...cols.groups.map((x) => ({
          header: x.header,
          width: 18,
          note: x.note,
          ...(x.g.max === 1 ? { options: x.g.subjectIds.map(code) } : {}),
        })),
        ...(cols.free.length
          ? [
              {
                header: cols.freeHeader,
                width: 22,
                note: `Any of ${cols.free.map((x) => x.code).join(', ')} (comma between)`,
              },
            ]
          : []),
      ],
      guide: [
        `Subject choices · ${out.section.code}`,
        ...(compulsory.length
          ? [`Everyone takes ${compulsory.join(', ')}: those are not in the sheet.`]
          : []),
        ...(out.streams.length
          ? [`Stream: ${out.streams.map((s) => s.name).join(', ')}. A stream gives its subjects.`]
          : []),
        'For each group write the code of the subject the student takes (two or more: comma between); leave it empty when none.',
        'Each row sets the student’s subjects: the compulsory ones and those written. A student left out of the sheet keeps theirs.',
        'Do not change the Admission no column or the headings.',
      ],
      rows: out.rows.map((r) => {
        const has = new Set(r.subjects.map((x) => x.subjectId));
        return [
          r.admissionNo,
          r.name,
          ...(cols.stream ? [r.stream] : []),
          ...cols.groups.map(
            (x) =>
              x.g.subjectIds
                .filter((id) => has.has(id))
                .map(code)
                .join(', ') || null,
          ),
          ...(cols.free.length
            ? [
                cols.free
                  .filter((x) => has.has(x.id))
                  .map((x) => x.code)
                  .join(', ') || null,
              ]
            : []),
        ];
      }),
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
    if (!out.canEdit)
      throw new DomainError(
        'forbidden',
        "Subject choices are set by the office or the section's class teacher",
        { status: 403 },
      );
    const cols = this.sheetColumns(out);
    const heads = [
      'Admission no',
      ...(cols.stream ? ['Stream'] : []),
      ...cols.groups.map((x) => x.header),
      ...(cols.free.length ? [cols.freeHeader] : []),
    ];
    const rows = await readSheet(dto.file, heads);
    const byNo = new Map(out.rows.map((r) => [r.admissionNo.trim().toLowerCase(), r]));
    const byCode = new Map(out.subjects.map((x) => [x.code.toUpperCase(), x.id]));
    const seen = new Set<string>();
    const checked = rows.map(({ row, cells }) => {
      const no = cells['Admission no']!.trim();
      const student = byNo.get(no.toLowerCase());
      let error: string | null = null;
      if (!student) error = `No student with admission no ${no} in ${out.section.code}`;
      else if (seen.has(student.studentId)) error = 'The student is in the sheet twice';
      if (student) seen.add(student.studentId);
      const picked: string[] = [];
      const take = (text: string, allowed: string[], where: string) => {
        for (const c of text.split(/[\s,;/]+/).filter(Boolean)) {
          const id = byCode.get(c.toUpperCase());
          if (!id || !allowed.includes(id))
            error ??= `${where}: ${c} is not one of ${allowed.map((a) => out.subjects.find((x) => x.id === a)!.code).join(', ')}`;
          else picked.push(id);
        }
      };
      for (const x of cols.groups) take(cells[x.header] ?? '', x.g.subjectIds, x.header);
      if (cols.free.length)
        take(
          cells[cols.freeHeader] ?? '',
          cols.free.map((x) => x.id),
          cols.freeHeader,
        );
      const stream = cols.stream ? (cells.Stream ?? '').trim() || null : (student?.stream ?? null);
      let list: Map<string, Kind> | null = null;
      let label: string | null = null;
      if (student && !error) {
        const p = this.plan(
          out,
          student,
          stream,
          picked.map((subjectId) => ({ subjectId })),
        );
        if ('error' in p) error = p.error;
        else {
          list = p.list;
          label = p.stream;
        }
      }
      return { row, admissionNo: no, student, list, label, error };
    });
    const errors = checked.filter((x) => x.error).length;
    const preview = {
      rows: checked.map((x) => ({
        row: x.row,
        admissionNo: x.admissionNo,
        name: x.student?.name ?? null,
        subjects: x.list?.size ?? 0,
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
        studentId: x.student!.studentId,
        stream: x.label,
        subjects: [...x.list!.entries()].map(([subjectId, kind]) => ({ subjectId, kind })),
      })),
    });
    return { ...preview, applied: true };
  }
}
