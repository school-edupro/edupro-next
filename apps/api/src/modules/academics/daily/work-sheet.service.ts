import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { ScopePolicy } from '../../../common/access/scope.policy';
import { DbService } from '../../../common/db/db.service';
import { DomainError } from '../../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../../common/http/request-context';
import { PushService } from '../../comms/push.service';
import { FilesService } from '../../files/files.service';
import { AcademicSettingsService, maskEmail, maskMobile } from './academic-settings.service';
import { generatedOn, registerFile, schoolHead } from '../../attendance/register-file';
import type { SaveSheetDto, SheetQueryDto, WorkReportQueryDto } from './daily.dto';
import { DAILY } from './daily.permissions';
import { DailyWorkService } from './daily-work.service';
import { ViewerService } from './viewer.service';

type Kind = 'homework' | 'classwork' | 'assignment';

export interface SheetSubject {
  id: string;
  code: string;
  name: string;
}
export interface SheetSection {
  classSectionId: string;
  section: string;
  classId: string;
  className: string;
  /** The subjects the caller may give work for in this section. */
  subjects: SheetSubject[];
}
/** What is already posted for a subject on the day, in the chosen sections. */
export interface SheetEntry {
  text: string;
  files: number;
  /** The files already attached, each with the entry it belongs to (for its View and Download links). */
  attachments: Array<{ workId: string; fileId: string }>;
  dueOn: string | null;
  /** The sections that have it. */
  sections: string[];
}
export interface SheetRow {
  subject: SheetSubject;
  /** The chosen sections where the caller may post this subject. */
  sections: string[];
  homework: SheetEntry | null;
  classwork: SheetEntry | null;
  assignment: SheetEntry | null;
}

const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const firstLine = (text: string, fallback: string) =>
  (text.split(/\r?\n/).find((l) => l.trim()) ?? '').trim().slice(0, 160) || fallback;

/**
 * The day's sheet: a class teacher fills homework and classwork for every subject of the class in
 * one screen, a subject teacher for the subjects given to them; assignments have the same sheet with
 * a due date. Also who teaches a child, for the family.
 */
@Injectable()
export class WorkSheetService {
  constructor(
    private readonly db: DbService,
    private readonly scopes: ScopePolicy,
    private readonly viewer: ViewerService,
    private readonly work: DailyWorkService,
    private readonly settings: AcademicSettingsService,
    private readonly push: PushService,
    private readonly files: FilesService,
  ) {}

  /** The sections the caller posts for, each with its subjects. */
  async options(ctx: RequestContext): Promise<SheetSection[]> {
    const tenant = requireTenant(ctx);
    const yearId = this.viewer.requireYear(tenant);
    const allowed = await this.scopes.filter(tenant, DAILY.workPost, 'class_section');
    return this.db.tenant(tenant, (c) => this.optionsIn(c, yearId, allowed));
  }

  private async optionsIn(
    c: PoolClient,
    yearId: string,
    allowed: string[] | null,
  ): Promise<SheetSection[]> {
    const sections = await c.query<{
      id: string;
      section: string;
      class_id: string;
      class_name: string;
    }>(
      `SELECT cs.id::text, c.code || '-' || cs.name AS section, cs.class_id::text, c.name AS class_name
         FROM class_sections cs JOIN classes c ON c.id = cs.class_id
        WHERE cs.academic_year_id = $1 AND cs.deleted_at IS NULL AND ($2::bigint[] IS NULL OR cs.id = ANY($2::bigint[]))
        ORDER BY c.display_order, c.code, cs.name`,
      [yearId, allowed],
    );
    const subjects = await c.query<SheetSubject>(
      `SELECT id::text, code, name FROM subjects WHERE deleted_at IS NULL AND status = 'active' ORDER BY display_order, name`,
    );
    const mapped = await c.query<{ class_id: string; subject_id: string }>(
      `SELECT class_id::text, subject_id::text FROM class_subjects WHERE academic_year_id = $1`,
      [yearId],
    );
    // the caller's own assignments say which subjects: a class teacher too posts only for the subjects
    // given to them; a coordinator and the office have every subject of the class
    const mine =
      allowed === null
        ? []
        : (
            await c.query<{ class_section_id: string; kind: string; subject_id: string | null }>(
              `SELECT ta.class_section_id::text, ta.kind::text, ta.subject_id::text
                 FROM teacher_assignments ta JOIN employees e ON e.id = ta.employee_id
                WHERE e.user_id = app.current_user_id() AND ta.academic_year_id = $1 AND ta.valid_to IS NULL`,
              [yearId],
            )
          ).rows;
    const byClass = new Map<string, Set<string>>();
    for (const m of mapped.rows)
      byClass.set(m.class_id, (byClass.get(m.class_id) ?? new Set()).add(m.subject_id));
    return sections.rows.map((s) => {
      const ofClass = byClass.get(s.class_id);
      // a class without a subject mapping studies every subject of the school
      const classSubjects = subjects.rows.filter((x) => !ofClass || ofClass.has(x.id));
      const own = mine.filter((m) => m.class_section_id === s.id);
      const whole =
        allowed === null || own.length === 0 || own.some((m) => m.kind === 'coordinator');
      const ids = new Set(own.map((m) => m.subject_id).filter((x): x is string => x !== null));
      return {
        classSectionId: s.id,
        section: s.section,
        classId: s.class_id,
        className: s.class_name,
        subjects: whole ? classSubjects : subjects.rows.filter((x) => ids.has(x.id)),
      };
    });
  }

  /** The sheet of a day for the chosen sections: a row per subject with what is already posted. */
  async sheet(ctx: RequestContext, q: SheetQueryDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.viewer.requireYear(tenant);
    const allowed = await this.scopes.filter(tenant, DAILY.workPost, 'class_section');
    const date = q.date ?? today();
    return this.db.tenant(tenant, async (c) => {
      const options = await this.optionsIn(c, yearId, allowed);
      const settings = await this.settings.read(c);
      // a class alone stands for every section of it the caller posts for; a teacher of one class
      // has it chosen already
      const classIds = [...new Set(options.map((o) => o.classId))];
      const classId = q.classId ?? (!q.sections && classIds.length === 1 ? classIds[0] : undefined);
      const ofClass = options.filter((o) => o.classId === classId).map((o) => o.classSectionId);
      const asked = q.sections ? q.sections.split(',') : [];
      const ticked = classId ? asked.filter((id) => ofClass.includes(id)) : asked;
      const wanted = ticked.length ? ticked : ofClass;
      const chosen = options.filter((o) => wanted.includes(o.classSectionId));
      if (wanted.length && chosen.length !== new Set(wanted).size)
        throw new DomainError('scope-denied', 'A chosen class is not assigned to you', {
          status: 403,
        });
      const kinds: Kind[] = q.mode === 'assignment' ? ['assignment'] : ['homework', 'classwork'];
      const posted = chosen.length
        ? await c.query<{
            section: string;
            subject_id: string;
            kind: Kind;
            body: string;
            title: string;
            due_on: string | null;
            id: string;
            files: string[] | null;
          }>(
            `SELECT c.code || '-' || cs.name AS section, w.subject_id::text, w.kind, w.body, w.title, w.due_on::text, w.id::text,
                    (SELECT array_agg(f.file_id::text ORDER BY f.file_id) FROM daily_work_files f WHERE f.daily_work_id = w.id) AS files
               FROM daily_work w JOIN class_sections cs ON cs.id = w.class_section_id JOIN classes c ON c.id = cs.class_id
              WHERE w.deleted_at IS NULL AND w.assigned_on = $1::date AND w.class_section_id = ANY($2::bigint[])
                AND w.kind = ANY($3::daily_work_kind[]) AND w.subject_id IS NOT NULL
              ORDER BY c.display_order, cs.name, w.id`,
            [date, chosen.map((s) => s.classSectionId), kinds],
          )
        : { rows: [] };
      const entry = (subjectId: string, kind: Kind): SheetEntry | null => {
        const hits = posted.rows.filter((p) => p.subject_id === subjectId && p.kind === kind);
        if (!hits.length) return null;
        const first = hits[0]!;
        return {
          text: first.body || first.title,
          files: (first.files ?? []).length,
          attachments: (first.files ?? []).map((fileId) => ({ workId: first.id, fileId })),
          dueOn: first.due_on,
          sections: [...new Set(hits.map((h) => h.section))],
        };
      };
      const seen = new Map<string, SheetRow>();
      for (const s of chosen)
        for (const sub of s.subjects) {
          const row = seen.get(sub.id) ?? {
            subject: sub,
            sections: [],
            homework: entry(sub.id, 'homework'),
            classwork: entry(sub.id, 'classwork'),
            assignment: entry(sub.id, 'assignment'),
          };
          row.sections.push(s.section);
          seen.set(sub.id, row);
        }
      // the families see the sheet from the school's publish time of that day, or at once
      const at = settings.publishTime ? `${date}T${settings.publishTime}` : null;
      const now = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 16);
      return {
        date,
        mode: q.mode,
        options: options.map((o) => ({
          classSectionId: o.classSectionId,
          section: o.section,
          classId: o.classId,
        })),
        classes: [...new Map(options.map((o) => [o.classId, o.className])).entries()].map(
          ([id, name]) => ({ id, name }),
        ),
        classId: chosen[0]?.classId ?? classId ?? null,
        chosen: chosen.map((s) => s.classSectionId),
        rows: [...seen.values()],
        publishAt: at && at > now ? at : now,
        publishTime: settings.publishTime,
        maxMb: settings.maxMb[q.mode === 'assignment' ? 'assignment' : 'daily_work'],
      };
    });
  }

  /** Saves the sheet: every filled box becomes (or updates) the entry of that section, subject and day. */
  async save(ctx: RequestContext, dto: SaveSheetDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.viewer.requireYear(tenant);
    const allowed = await this.scopes.filter(tenant, DAILY.workPost, 'class_section');
    const options = await this.db.tenant(tenant, (c) => this.optionsIn(c, yearId, allowed));
    const chosen = options.filter((o) => dto.classSectionIds.includes(o.classSectionId));
    if (chosen.length !== new Set(dto.classSectionIds).size)
      throw new DomainError('scope-denied', 'A chosen class is not assigned to you', {
        status: 403,
      });
    const kinds: Kind[] = dto.mode === 'assignment' ? ['assignment'] : ['homework', 'classwork'];
    const filled = dto.rows.flatMap((r) =>
      kinds
        .map((kind) => ({
          subjectId: r.subjectId,
          kind,
          text: r[kind],
          fileIds: r[`${kind}FileIds`],
          dueOn: kind === 'assignment' ? r.dueOn : undefined,
        }))
        .filter((x) => x.text || x.fileIds.length),
    );
    if (!filled.length)
      throw new DomainError(
        'validation-failed',
        dto.mode === 'assignment'
          ? 'Write the assignment of at least one subject'
          : 'Write the homework or the classwork of at least one subject',
        { status: 400 },
      );
    const late = filled.find((f) => f.dueOn && f.dueOn < dto.date);
    if (late)
      throw new DomainError('validation-failed', 'The due date cannot be before the date', {
        status: 400,
      });
    let created = 0;
    let updated = 0;
    const touched = new Set<string>();
    for (const s of chosen)
      for (const f of filled) {
        const subject = s.subjects.find((x) => x.id === f.subjectId);
        if (!subject) continue; // not a subject of the caller in this section
        const existing = await this.db.tenant(tenant, async (c) => {
          const r = await c.query<{ id: string; files: string[] | null }>(
            `SELECT w.id::text, (SELECT array_agg(wf.file_id::text) FROM daily_work_files wf WHERE wf.daily_work_id = w.id) AS files
               FROM daily_work w
              WHERE w.deleted_at IS NULL AND w.class_section_id = $1 AND w.subject_id = $2 AND w.kind = $3::daily_work_kind
                AND w.assigned_on = $4::date
              ORDER BY w.id DESC LIMIT 1`,
            [s.classSectionId, f.subjectId, f.kind, dto.date],
          );
          return r.rows[0] ?? null;
        });
        const label =
          f.kind === 'homework' ? 'Homework' : f.kind === 'classwork' ? 'Classwork' : 'Assignment';
        const title = firstLine(f.text, `${subject.name} ${label.toLowerCase()}`);
        if (existing) {
          // a box left as it was changes nothing; new files are added to the ones already there
          await this.work.update(ctx, existing.id, {
            ...(f.text ? { title, body: f.text } : {}),
            ...(f.dueOn ? { dueOn: f.dueOn } : {}),
            ...(dto.publishAt ? { publishAt: dto.publishAt } : {}),
            ackRequired: dto.ackRequired,
            ...(f.fileIds.length
              ? { fileIds: [...new Set([...(existing.files ?? []), ...f.fileIds])].slice(0, 10) }
              : {}),
          });
          updated += 1;
        } else {
          await this.work.create(
            ctx,
            {
              classSectionId: s.classSectionId,
              subjectId: f.subjectId,
              kind: f.kind,
              title,
              body: f.text,
              assignedOn: dto.date,
              dueOn: f.dueOn,
              fileIds: f.fileIds,
              publishAt: dto.publishAt,
              ackRequired: dto.ackRequired,
            },
            { quiet: true },
          );
          created += 1;
          touched.add(s.classSectionId);
        }
      }
    if (!created && !updated)
      throw new DomainError(
        'daily.subject_not_assigned',
        'None of these subjects is yours in the chosen classes',
        { status: 403 },
      );
    // one notification for the sheet, when the families can already see it
    const scheduled =
      dto.publishAt !== undefined &&
      new Date(
        /(Z|[+-]\d{2}:\d{2})$/.test(dto.publishAt) ? dto.publishAt : `${dto.publishAt}+05:30`,
      ).getTime() > Date.now();
    if (touched.size && !scheduled)
      await this.db.tenant(tenant, async (c) => {
        await this.push.send(c, ctx, {
          userIds: await this.push.familyUsersOfSections(c, [...touched]),
          title: dto.mode === 'assignment' ? 'New assignment' : 'Homework and classwork',
          body: `Posted for ${dto.date}`,
          link: '/homework',
          event: 'homework',
        });
      });
    return { created, updated, sections: chosen.length };
  }

  /** What was posted between two dates, as Excel or PDF with the school's header. */
  async reportFile(ctx: RequestContext, q: WorkReportQueryDto) {
    const { rows } = await this.work.list(ctx, {
      classSectionId: q.classSectionId,
      from: q.from,
      to: q.to,
      kind: q.kind === 'assignment' ? 'assignment' : undefined,
      page: 1,
      size: 200,
    });
    const items = rows.filter((r) =>
      q.kind === 'daily'
        ? r.kind !== 'assignment'
        : q.kind === 'assignment'
          ? r.kind === 'assignment'
          : true,
    );
    const head = await this.db.tenant(requireTenant(ctx), (c) => schoolHead(c));
    const KIND = { homework: 'Homework', classwork: 'Classwork', assignment: 'Assignment' };
    const at = (d: Date) =>
      d.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    return registerFile(
      {
        school: head.name,
        address: head.address,
        report:
          q.kind === 'assignment'
            ? 'Assignments'
            : q.kind === 'daily'
              ? 'Homework and classwork'
              : 'Homework, classwork and assignments',
        details: [
          q.classSectionId ? `Class ${items[0]?.section ?? ''}` : 'All classes',
          q.from || q.to ? `From ${q.from ?? '…'} to ${q.to ?? '…'}` : '',
          generatedOn(),
        ].filter(Boolean),
        legend: `${String(items.length)} entr${items.length === 1 ? 'y' : 'ies'}`,
        columns: [
          { label: 'Sl.', width: 3, right: true },
          { label: 'Date', width: 7 },
          { label: 'Class', width: 5 },
          { label: 'Subject', width: 10 },
          { label: 'Kind', width: 7 },
          { label: 'Work', width: 30 },
          { label: 'Due', width: 7 },
          { label: 'Files', width: 4, right: true },
          { label: 'Published', width: 10 },
          { label: 'Posted by', width: 10 },
        ],
        rows: items.map((w, i) => [
          i + 1,
          w.assignedOn,
          w.section,
          w.subjectName ?? '',
          KIND[w.kind],
          w.body || w.title,
          w.dueOn ?? '',
          w.files.length,
          `${at(new Date(w.publishAt))}${w.scheduled ? ' (scheduled)' : ''}`,
          w.postedBy ?? '',
        ]),
        filename: `daily-work-${new Date().toISOString().slice(0, 10)}`,
      },
      q.format,
    );
  }

  // ---- who teaches my child ------------------------------------------------------------------------
  /** The class teacher and the subject teachers of each child of the family; contact as the school set it. */
  async myTeachers(ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    const yearId = this.viewer.requireYear(tenant);
    const v = await this.viewer.resolve(ctx, DAILY.workView);
    if (v.kind !== 'family')
      throw new DomainError('permission-denied', 'For parents and students', { status: 403 });
    return this.db.tenant(tenant, async (c) => {
      const settings = await this.settings.read(c);
      const sections = v.students.map((s) => s.classSectionId).filter((x): x is string => !!x);
      const r = await c.query<{
        class_section_id: string;
        employee_id: string;
        name: string;
        designation: string | null;
        mobile: string | null;
        email: string | null;
        has_photo: boolean;
        kind: string;
        is_actual: boolean;
        subject: string | null;
      }>(
        `SELECT ta.class_section_id::text, e.id::text AS employee_id, e.display_name AS name, e.designation, e.mobile, e.email,
                e.photo_file_id IS NOT NULL AS has_photo, ta.kind::text, ta.is_actual, s.name AS subject
           FROM teacher_assignments ta
           JOIN employees e ON e.id = ta.employee_id AND e.deleted_at IS NULL
           LEFT JOIN subjects s ON s.id = ta.subject_id
          WHERE ta.academic_year_id = $1 AND ta.valid_to IS NULL AND ta.class_section_id = ANY($2::bigint[])
            AND ta.kind IN ('class_teacher', 'subject_teacher')
          ORDER BY (ta.kind = 'class_teacher') DESC, ta.is_actual DESC, s.display_order NULLS FIRST, s.name, e.display_name`,
        [yearId, sections],
      );
      const show = (how: string, v0: string | null, mask: (x: string | null) => string | null) =>
        how === 'hidden' || !v0 ? null : how === 'masked' ? mask(v0) : v0;
      return {
        contact: { mobile: settings.teacherMobile, email: settings.teacherEmail },
        students: v.students.map((st) => {
          // one card per teacher of the section: their role and every subject they teach there
          const cards = new Map<
            string,
            {
              employeeId: string;
              name: string;
              designation: string | null;
              role: 'class_teacher' | 'co_class_teacher' | 'subject_teacher';
              subjects: string[];
              mobile: string | null;
              email: string | null;
              hasPhoto: boolean;
            }
          >();
          for (const t of r.rows.filter((x) => x.class_section_id === st.classSectionId)) {
            const card = cards.get(t.employee_id) ?? {
              employeeId: t.employee_id,
              name: t.name,
              designation: t.designation,
              role: 'subject_teacher' as const,
              subjects: [],
              mobile: show(settings.teacherMobile, t.mobile, maskMobile),
              email: show(settings.teacherEmail, t.email, maskEmail),
              hasPhoto: t.has_photo,
            };
            if (t.kind === 'class_teacher' && card.role !== 'class_teacher')
              card.role = t.is_actual ? 'class_teacher' : 'co_class_teacher';
            if (t.subject && !card.subjects.includes(t.subject)) card.subjects.push(t.subject);
            cards.set(t.employee_id, card);
          }
          return {
            id: st.id,
            name: st.name,
            section: st.section,
            teachers: [...cards.values()],
          };
        }),
      };
    });
  }

  /** The photo of a teacher of one of the family's children, as a signed link. */
  async teacherPhoto(ctx: RequestContext, employeeId: string) {
    const tenant = requireTenant(ctx);
    const yearId = this.viewer.requireYear(tenant);
    const v = await this.viewer.resolve(ctx, DAILY.workView);
    const sections = v.students.map((s) => s.classSectionId).filter((x): x is string => !!x);
    const fileId = await this.db.tenant(tenant, async (c) => {
      const r = await c.query<{ photo_file_id: string | null }>(
        `SELECT e.photo_file_id::text FROM employees e
          WHERE e.id = $1 AND e.deleted_at IS NULL AND EXISTS (
                SELECT 1 FROM teacher_assignments ta
                 WHERE ta.employee_id = e.id AND ta.academic_year_id = $2 AND ta.valid_to IS NULL
                   AND ta.class_section_id = ANY($3::bigint[]))`,
        [employeeId, yearId, sections],
      );
      return r.rows[0]?.photo_file_id ?? null;
    });
    if (v.kind !== 'family' || !fileId)
      throw new DomainError('not-found', 'Photo not found', { status: 404 });
    return this.files.downloadUrl(ctx, fileId);
  }
}
