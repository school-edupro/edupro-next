import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  CANDIDATE_ACTIVITIES,
  CANDIDATE_DOCUMENTS,
  CANDIDATE_FIELDS,
  CANDIDATE_ROWS,
  CANDIDATE_SECTIONS,
  decryptField,
  loadEmployeeLists,
  maskValue,
  validateEmployeeChanges,
  type CandidateRowKind,
} from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { FilesService } from '../files/files.service';
import { ApplicationPdfService } from './application-pdf.service';
import { PEOPLE } from './people.permissions';
import {
  APP_COLS,
  OPEN,
  appFilter,
  nameOf,
  type AppRow,
  type AppStatus,
  type Snapshot,
} from './recruitment-app';
import { RecruitmentCorrectionsService } from './recruitment-corrections.service';
import type {
  ApplicationBulkDto,
  ApplicationListDto,
  ApplicationNoteDto,
  RecruitmentNoticesDto,
  StageResultDto,
  WalkInDto,
} from './recruitment-screening.dto';

const istDate = (d: Date) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
const istTime = (d: Date) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(d);

/**
 * Recruitment, part 3 (docs/design/34-recruitment.md): the candidates of every vacancy and their screening.
 * An application goes through the stages its vacancy ticked, in order: each stage keeps when and where it
 * is held, the panel, the marks and the result. Passing moves the candidate to the next stage (passing the
 * last selects); failing ends the application; holding keeps it waiting. Candidates hear of a scheduled
 * stage, a selection and (when the school wants) a rejection through the school's templates.
 */
@Injectable()
export class RecruitmentScreeningService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly pdf: ApplicationPdfService,
    private readonly corrections: RecruitmentCorrectionsService,
  ) {}

  private manage(ctx: RequestContext) {
    return ctx.permissions?.has(PEOPLE.recruitmentManage) ?? false;
  }

  /** A step of the application's history; a decision keeps who made it and what it changed (to undo it). */
  private async event(
    c: PoolClient,
    ctx: RequestContext,
    id: string,
    what: string,
    note?: string | null,
    detail: Record<string, unknown> = {},
  ) {
    await c.query(
      `INSERT INTO job_application_events (school_id, application_id, what, note, by_name, by_user, detail)
       VALUES (app.current_school_id(), $1, $2, $3, $4, app.current_user_id(), $5::jsonb)`,
      [id, what, note ?? null, ctx.user.displayName, JSON.stringify(detail)],
    );
  }

  private async load(c: PoolClient, id: string): Promise<AppRow> {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Application not found', { status: 404 });
    // eslint-disable-next-line no-restricted-syntax -- a fixed fragment; the id is bound
    const r = await c.query<AppRow>(`${APP_COLS} WHERE a.id = $1`, [id]);
    if (!r.rows[0]) throw new DomainError('not-found', 'Application not found', { status: 404 });
    return r.rows[0];
  }

  // ---- the list ---------------------------------------------------------------------------------------

  async list(ctx: RequestContext, q: ApplicationListDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const f = appFilter(q);
      const r = await c.query<AppRow>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments chosen in appFilter; values are bound
        `${APP_COLS} ${f.sql} ORDER BY a.submitted_at DESC, a.id DESC LIMIT 2000`,
        f.args,
      );
      const counts = await c.query<{ status: AppStatus; n: number }>(
        `SELECT status, count(*)::int AS n FROM job_applications WHERE ($1::bigint IS NULL OR vacancy_id = $1) GROUP BY status`,
        [q.vacancy ?? null],
      );
      return {
        data: r.rows.map((a) => ({
          id: a.id,
          number: a.number,
          name: nameOf(a),
          mobile: (a.snapshot.values.mobile as string | undefined) ?? a.c_mobile,
          email: (a.snapshot.values.email as string | undefined) ?? a.c_email,
          vacancyId: a.vacancy_id,
          vacancy: a.vacancy,
          vacancyCode: a.vacancy_code,
          status: a.status,
          stageId: a.current_stage_id,
          stage: a.stage,
          source: a.source,
          match: Boolean(a.employee_match?.length),
          submittedAt: a.submitted_at.toISOString(),
        })),
        counts: Object.fromEntries(counts.rows.map((x) => [x.status, x.n])),
      };
    });
  }

  /** Per vacancy: candidates at each stage, and how many were selected, for the vacancy page. */
  async pipeline(ctx: RequestContext, vacancyId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const v = await c.query<{ stage_ids: string[]; posts: number }>(
        `SELECT stage_ids::text[] AS stage_ids, posts FROM vacancies WHERE id = $1`,
        [vacancyId],
      );
      if (!v.rows[0]) throw new DomainError('not-found', 'Vacancy not found', { status: 404 });
      const stages = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM recruitment_stages WHERE id = ANY($1::bigint[])`,
        [v.rows[0].stage_ids],
      );
      const at = await c.query<{ stage: string; n: number }>(
        `SELECT current_stage_id::text AS stage, count(*)::int AS n FROM job_applications
          WHERE vacancy_id = $1 AND status IN ('submitted', 'screening', 'on_hold') GROUP BY 1`,
        [vacancyId],
      );
      const by = await c.query<{ status: AppStatus; n: number }>(
        `SELECT status, count(*)::int AS n FROM job_applications WHERE vacancy_id = $1 GROUP BY 1`,
        [vacancyId],
      );
      const name = new Map(stages.rows.map((x) => [x.id, x.name]));
      const n = new Map(at.rows.map((x) => [x.stage, x.n]));
      const st = Object.fromEntries(by.rows.map((x) => [x.status, x.n]));
      return {
        posts: v.rows[0].posts,
        total: by.rows.reduce((k, x) => k + x.n, 0),
        stages: v.rows[0].stage_ids.map((id) => ({
          id,
          name: name.get(id) ?? '',
          open: n.get(id) ?? 0,
        })),
        selected: (st.selected ?? 0) + (st.joined ?? 0),
        rejected: st.rejected ?? 0,
        onHold: st.on_hold ?? 0,
      };
    });
  }

  // ---- one application --------------------------------------------------------------------------------

  async view(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const a = await this.load(c, id);
      const full = ctx.permissions?.has(PEOPLE.sensitiveView) ?? false;
      const v = a.snapshot.values;
      const sections = CANDIDATE_SECTIONS.map((s) => ({
        title: s.title,
        fields: CANDIDATE_FIELDS.filter((f) => f.section === s.id)
          .map((f) => {
            let value: string | null;
            if (f.sensitive) {
              const enc = a.snapshot_secure[f.key];
              const plain = enc ? decryptField(enc) : null;
              value = plain ? (full ? plain : maskValue(plain, f.type)) : null;
            } else {
              const raw = v[f.key];
              value = raw === null || raw === undefined || raw === '' ? null : String(raw);
            }
            return { key: f.key, label: f.label, type: f.type, value };
          })
          .filter((x) => x.value !== null),
      })).filter((s) => s.fields.length);
      const rows = (Object.keys(CANDIDATE_ROWS) as CandidateRowKind[])
        .map((k) => ({
          kind: k,
          title: CANDIDATE_ROWS[k].title,
          columns: CANDIDATE_ROWS[k].columns.map((col) => ({ key: col.key, label: col.label })),
          rows: a.snapshot.rows[k] ?? [],
        }))
        .filter((x) => x.rows.length);
      const docLabel = new Map(CANDIDATE_DOCUMENTS.map((d) => [d.kind, d.label]));
      const stages = await c.query<{
        id: string;
        name: string;
        kind: string;
        max_marks: string | null;
      }>(
        `SELECT id::text, name, kind, max_marks::text FROM recruitment_stages WHERE id = ANY($1::bigint[])`,
        [a.stage_ids],
      );
      const results = await c.query<{
        stage_id: string;
        scheduled_at: Date | null;
        venue: string | null;
        panel: string | null;
        marks: string | null;
        max_marks: string | null;
        result: 'pass' | 'fail' | 'hold' | null;
        remarks: string | null;
        recorded_by_name: string | null;
        recorded_at: Date | null;
      }>(
        `SELECT stage_id::text, scheduled_at, venue, panel, marks::text, max_marks::text, result, remarks, recorded_by_name, recorded_at
           FROM application_stage_results WHERE application_id = $1`,
        [id],
      );
      const events = await c.query<{
        at: Date;
        what: string;
        note: string | null;
        by_name: string | null;
        revoked: boolean;
      }>(
        `SELECT at, what, note, by_name, revoked_at IS NOT NULL AS revoked FROM job_application_events
          WHERE application_id = $1 ORDER BY at, id`,
        [id],
      );
      const stageById = new Map(stages.rows.map((x) => [x.id, x]));
      const resultBy = new Map(results.rows.map((x) => [x.stage_id, x]));
      const open = OPEN.includes(a.status);
      return {
        id: a.id,
        number: a.number,
        name: nameOf(a),
        vacancy: { id: a.vacancy_id, title: a.vacancy, code: a.vacancy_code },
        status: a.status,
        stageId: a.current_stage_id,
        source: a.source,
        submittedAt: a.submitted_at.toISOString(),
        decidedAt: a.decided_at?.toISOString() ?? null,
        decisionNote: a.decision_note,
        employeeMatch: a.employee_match ?? [],
        sections,
        rows,
        activities: a.snapshot.activities.filter((x) =>
          (CANDIDATE_ACTIVITIES as readonly string[]).includes(x),
        ),
        documents: a.snapshot.files.map((f) => ({
          id: f.id,
          kind: f.kind,
          label: docLabel.get(f.kind) ?? f.kind,
          fileId: f.fileId,
          contentType: f.contentType,
        })),
        stages: a.stage_ids.map((sid) => {
          const s = stageById.get(sid);
          const r = resultBy.get(sid);
          return {
            id: sid,
            name: s?.name ?? '',
            kind: s?.kind ?? 'interview',
            maxMarks:
              s?.max_marks === null || s?.max_marks === undefined ? null : Number(s.max_marks),
            current: open && sid === a.current_stage_id,
            scheduledAt: r?.scheduled_at?.toISOString() ?? null,
            venue: r?.venue ?? null,
            panel: r?.panel ?? null,
            marks: r?.marks === null || r?.marks === undefined ? null : Number(r.marks),
            result: r?.result ?? null,
            remarks: r?.remarks ?? null,
            recordedBy: r?.recorded_by_name ?? null,
            recordedAt: r?.recorded_at?.toISOString() ?? null,
          };
        }),
        events: events.rows.map((e) => ({ ...e, at: e.at.toISOString() })),
        employee: a.employee_id
          ? await c
              .query<{ id: string; code: string; name: string }>(
                `SELECT id::text, employee_code AS code, display_name AS name FROM employees WHERE id = $1`,
                [a.employee_id],
              )
              .then((x) => x.rows[0] ?? null)
          : null,
        joinedAt: a.joined_at?.toISOString() ?? null,
        photoFileId: a.snapshot.files.find((f) => f.kind === 'photo')?.fileId ?? null,
        // a correction asked of the candidate (part 8) and what the signed-in person may put right
        correction: a.correction,
        corrections: await this.corrections.rights(c, ctx, a),
        can: {
          join:
            a.status === 'selected' &&
            !a.employee_id &&
            this.manage(ctx) &&
            (ctx.permissions?.has(PEOPLE.employeeCreate) ?? false),
          record: this.manage(ctx) && open,
          reject: this.manage(ctx) && open,
          resume: this.manage(ctx) && a.status === 'on_hold',
          sensitive: full,
        },
      };
    });
  }

  /** A document of the application (a file in its snapshot), for whoever may see candidates. */
  async fileUrl(ctx: RequestContext, id: string, fileId: string) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const a = await this.load(c, id);
      if (!a.snapshot.files.some((f) => f.fileId === fileId))
        throw new DomainError('not-found', 'File not found', { status: 404 });
    });
    return this.files.downloadUrl(ctx, fileId);
  }

  // ---- screening ---------------------------------------------------------------------------------------

  /**
   * Records a stage of one application: its schedule (date and time, venue, panel), and once held its marks
   * and result. Only the stage the candidate is at; marks within the stage's maximum. A new schedule tells
   * the candidate; a result moves the application (pass: next stage or selected; fail: not taken forward;
   * hold: on hold).
   */
  private async recordWith(
    c: PoolClient,
    ctx: RequestContext,
    a: AppRow,
    stageId: string,
    dto: StageResultDto,
  ) {
    if (!OPEN.includes(a.status))
      throw new DomainError('recruitment.decided', 'This application is already decided', {
        status: 409,
      });
    if (a.current_stage_id !== stageId)
      throw new DomainError('recruitment.not_at_stage', 'The candidate is not at this stage', {
        status: 409,
      });
    const st = (
      await c.query<{ name: string; kind: string; max_marks: string | null }>(
        `SELECT name, kind, max_marks::text FROM recruitment_stages WHERE id = $1`,
        [stageId],
      )
    ).rows[0]!;
    const max = st.max_marks === null ? null : Number(st.max_marks);
    if (dto.marks !== undefined && dto.marks !== null && max !== null && dto.marks > max)
      throw new DomainError('validation-failed', `Marks: at most ${String(max)} for ${st.name}`, {
        status: 400,
      });
    const before = await c.query<{ scheduled_at: Date | null }>(
      `SELECT scheduled_at FROM application_stage_results WHERE application_id = $1 AND stage_id = $2`,
      [a.id, stageId],
    );
    const sched =
      dto.scheduledAt === undefined
        ? undefined
        : dto.scheduledAt
          ? new Date(dto.scheduledAt)
          : null;
    await c.query(
      `INSERT INTO application_stage_results (school_id, application_id, stage_id, scheduled_at, venue, panel, marks, max_marks,
                                              result, remarks, recorded_by, recorded_by_name, recorded_at)
       VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9,
               CASE WHEN $8::text IS NULL THEN NULL ELSE app.current_user_id() END,
               CASE WHEN $8::text IS NULL THEN NULL ELSE $10 END,
               CASE WHEN $8::text IS NULL THEN NULL ELSE now() END)
       ON CONFLICT (application_id, stage_id) DO UPDATE SET
         scheduled_at = CASE WHEN $11 THEN EXCLUDED.scheduled_at ELSE application_stage_results.scheduled_at END,
         venue = COALESCE(EXCLUDED.venue, application_stage_results.venue),
         panel = COALESCE(EXCLUDED.panel, application_stage_results.panel),
         marks = COALESCE(EXCLUDED.marks, application_stage_results.marks),
         result = COALESCE(EXCLUDED.result, application_stage_results.result),
         remarks = COALESCE(EXCLUDED.remarks, application_stage_results.remarks),
         recorded_by = COALESCE(EXCLUDED.recorded_by, application_stage_results.recorded_by),
         recorded_by_name = COALESCE(EXCLUDED.recorded_by_name, application_stage_results.recorded_by_name),
         recorded_at = COALESCE(EXCLUDED.recorded_at, application_stage_results.recorded_at),
         updated_at = now()`,
      [
        a.id,
        stageId,
        sched ?? null,
        dto.venue ?? null,
        dto.panel ?? null,
        dto.marks ?? null,
        max,
        dto.result ?? null,
        dto.remarks ?? null,
        ctx.user.displayName,
        sched !== undefined,
      ],
    );
    // a new date tells the candidate (when the school sends this notice)
    if (sched && before.rows[0]?.scheduled_at?.getTime() !== sched.getTime()) {
      await this.event(
        c,
        ctx,
        a.id,
        'scheduled',
        `${st.name}: ${istDate(sched)}, ${istTime(sched)}${dto.venue ? `, ${dto.venue}` : ''}`,
      );
      await c.query(`SELECT app.recruitment_notify($1, 'scheduled', $2::jsonb)`, [
        a.id,
        JSON.stringify({
          stageId,
          stage: st.name,
          date: istDate(sched),
          time: istTime(sched),
          venue: dto.venue ? `, ${dto.venue}` : '',
        }),
      ]);
    }
    if (a.status === 'submitted')
      await c.query(
        `UPDATE job_applications SET status = 'screening', updated_at = now() WHERE id = $1`,
        [a.id],
      );
    if (!dto.result) return;
    if (dto.result === 'hold') {
      await c.query(
        `UPDATE job_applications SET status = 'on_hold', updated_at = now() WHERE id = $1`,
        [a.id],
      );
      await this.event(
        c,
        ctx,
        a.id,
        'on_hold',
        `${st.name}${dto.remarks ? `: ${dto.remarks}` : ''}`,
        { stageId, prevStatus: a.status === 'submitted' ? 'screening' : a.status },
      );
      return;
    }
    if (dto.result === 'fail') {
      await c.query(
        `UPDATE job_applications SET status = 'rejected', decision_note = $2, decided_at = now(), updated_at = now() WHERE id = $1`,
        [a.id, dto.remarks ?? `Not through ${st.name}`],
      );
      await this.event(
        c,
        ctx,
        a.id,
        'not_taken_forward',
        `${st.name}${dto.remarks ? `: ${dto.remarks}` : ''}`,
        { stageId, prevStatus: a.status === 'submitted' ? 'screening' : a.status },
      );
      await c.query(`SELECT app.recruitment_notify($1, 'not_selected', $2::jsonb)`, [
        a.id,
        JSON.stringify({ stageId }),
      ]);
      return;
    }
    const i = a.stage_ids.indexOf(stageId);
    const next = a.stage_ids[i + 1];
    if (next) {
      await c.query(
        `UPDATE job_applications SET status = 'screening', current_stage_id = $2, updated_at = now() WHERE id = $1`,
        [a.id, next],
      );
      await this.event(c, ctx, a.id, 'passed', st.name, { stageId });
      // the stage cleared, by email when the stage tells its result (0204)
      const nextName = await c.query<{ name: string }>(
        `SELECT name FROM recruitment_stages WHERE id = $1`,
        [next],
      );
      await c.query(`SELECT app.recruitment_notify($1, 'passed', $2::jsonb)`, [
        a.id,
        JSON.stringify({
          stageId,
          stage: st.name,
          next: nextName.rows[0]?.name ?? 'the next stage',
        }),
      ]);
      return;
    }
    await c.query(
      `UPDATE job_applications SET status = 'selected', decision_note = $2, decided_at = now(), updated_at = now() WHERE id = $1`,
      [a.id, dto.remarks ?? null],
    );
    await this.event(c, ctx, a.id, 'selected', st.name, { stageId });
    await c.query(`SELECT app.recruitment_notify($1, 'selected')`, [a.id]);
  }

  async record(ctx: RequestContext, id: string, stageId: string, dto: StageResultDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const a = await this.load(c, id);
      await this.recordWith(c, ctx, a, stageId, dto);
      await this.audit.stage(ctx, c, {
        action: 'people.recruitment.stage',
        entityType: 'job_applications',
        entityId: id,
        after: { stageId, result: dto.result ?? null },
      });
      const now = await this.load(c, id);
      return { status: now.status, stageId: now.current_stage_id };
    });
  }

  /** The same result for several candidates at the same stage (shortlisting the ticked ones, say). */
  async bulk(ctx: RequestContext, dto: ApplicationBulkDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      let done = 0;
      const skipped: string[] = [];
      for (const id of [...new Set(dto.ids)]) {
        const a = await this.load(c, id).catch(() => null);
        if (!a || !OPEN.includes(a.status) || a.current_stage_id !== dto.stageId) {
          skipped.push(a?.number ?? id);
          continue;
        }
        await this.recordWith(c, ctx, a, dto.stageId, {
          result: dto.result,
          remarks: dto.remarks,
          scheduledAt: dto.scheduledAt,
          venue: dto.venue,
          panel: dto.panel,
        });
        done++;
      }
      await this.audit.stage(ctx, c, {
        action: 'people.recruitment.stage_bulk',
        entityType: 'job_applications',
        entityId: requireTenant(ctx).schoolId,
        after: { stageId: dto.stageId, result: dto.result ?? null, done, skipped: skipped.length },
      });
      return { done, skipped };
    });
  }

  /** Ends an application at any stage, with the reason. */
  async reject(ctx: RequestContext, id: string, dto: ApplicationNoteDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const a = await this.load(c, id);
      if (!OPEN.includes(a.status))
        throw new DomainError('recruitment.decided', 'This application is already decided', {
          status: 409,
        });
      await c.query(
        `UPDATE job_applications SET status = 'rejected', decision_note = $2, decided_at = now(), updated_at = now() WHERE id = $1`,
        [id, dto.note ?? null],
      );
      await this.event(c, ctx, id, 'not_taken_forward', dto.note ?? null, {
        stageId: null,
        prevStatus: a.status,
      });
      // told as the result of the stage it was at (that stage's email switch, 0204)
      await c.query(`SELECT app.recruitment_notify($1, 'not_selected', $2::jsonb)`, [
        id,
        JSON.stringify(a.current_stage_id ? { stageId: a.current_stage_id } : {}),
      ]);
      return { status: 'rejected' };
    });
  }

  /** An application on hold goes on at the stage it waited at. */
  async resume(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const a = await this.load(c, id);
      if (a.status !== 'on_hold')
        throw new DomainError('recruitment.not_on_hold', 'This application is not on hold', {
          status: 409,
        });
      await c.query(
        `UPDATE job_applications SET status = 'screening', updated_at = now() WHERE id = $1`,
        [id],
      );
      await c.query(
        `UPDATE application_stage_results SET result = NULL WHERE application_id = $1 AND stage_id = $2 AND result = 'hold'`,
        [id, a.current_stage_id],
      );
      await this.event(c, ctx, id, 'resumed');
      return { status: 'screening' };
    });
  }

  /**
   * A candidate the office adds (a walk-in, a referral): found by mobile or email or made new, with the
   * details checked as the employee master checks them; the application goes to the vacancy's first stage.
   * The candidate can complete the full form online by signing in with that mobile or email.
   */
  async walkIn(ctx: RequestContext, dto: WalkInDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const v = await c.query<{ status: string; stage_ids: string[] }>(
        `SELECT status, stage_ids::text[] AS stage_ids FROM vacancies WHERE id = $1`,
        [dto.vacancyId],
      );
      if (!v.rows[0]) throw new DomainError('not-found', 'Vacancy not found', { status: 404 });
      if (!['approved', 'published', 'closed'].includes(v.rows[0].status))
        throw new DomainError(
          'recruitment.not_approved',
          'Candidates are added to an approved vacancy',
          {
            status: 409,
          },
        );
      const lists = await loadEmployeeLists(c);
      const raw: Record<string, unknown> = {
        first_name: dto.firstName,
        last_name: dto.lastName ?? null,
        gender: dto.gender,
        dob: dto.dob ?? null,
        mobile: dto.mobile,
        email: dto.email ?? null,
      };
      const checked = await validateEmployeeChanges(c, raw, lists, null);
      if (Object.keys(checked.errors).length)
        throw new DomainError('validation-failed', Object.values(checked.errors).join('; '), {
          status: 400,
        });
      const values = checked.values;
      const found = await c.query<{ id: string; profile: { values?: Record<string, unknown> } }>(
        `SELECT id::text, profile FROM candidates WHERE mobile = $1 OR ($2::text IS NOT NULL AND email = $2) ORDER BY (mobile = $1) DESC LIMIT 1`,
        [values.mobile, values.email ?? null],
      );
      let candidateId = found.rows[0]?.id;
      const name = [values.first_name, values.last_name].filter(Boolean).join(' ');
      if (!candidateId) {
        candidateId = (
          await c.query<{ id: string }>(
            `INSERT INTO candidates (school_id, mobile, email, name, profile)
             VALUES (app.current_school_id(), $1, $2, $3, $4::jsonb) RETURNING id::text`,
            [
              values.mobile,
              values.email ?? null,
              name,
              JSON.stringify({ values, rows: {}, activities: [] }),
            ],
          )
        ).rows[0]!.id;
      } else {
        // what the candidate already gave stays; the office fills only what is empty
        const cur = found.rows[0]!.profile.values ?? {};
        const merged = {
          ...values,
          ...Object.fromEntries(Object.entries(cur).filter(([, x]) => x !== null && x !== '')),
        };
        await c.query(
          `UPDATE candidates SET profile = jsonb_set(profile, '{values}', $2::jsonb), name = COALESCE(name, $3), updated_at = now() WHERE id = $1`,
          [candidateId, JSON.stringify(merged), name],
        );
      }
      const dup = await c.query(
        `SELECT 1 FROM job_applications WHERE vacancy_id = $1 AND candidate_id = $2`,
        [dto.vacancyId, candidateId],
      );
      if (dup.rowCount)
        throw new DomainError(
          'recruitment.already_applied',
          'This candidate has already applied for this post',
          {
            status: 409,
          },
        );
      const cand = await c.query<{
        profile: Omit<Snapshot, 'files'>;
        secure: Record<string, string>;
      }>(`SELECT profile, secure FROM candidates WHERE id = $1`, [candidateId]);
      const files = (
        await c.query<{ id: string; kind: string; file_id: string; content_type: string }>(
          `SELECT cf.id::text, cf.kind, cf.file_id::text, f.content_type FROM candidate_files cf JOIN files f ON f.id = cf.file_id
            WHERE cf.candidate_id = $1 AND f.deleted_at IS NULL`,
          [candidateId],
        )
      ).rows.map((x) => ({
        id: x.id,
        kind: x.kind,
        fileId: x.file_id,
        contentType: x.content_type,
      }));
      const p = cand.rows[0]!.profile;
      const match = await c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, employee_code AS code, display_name AS name FROM employees
          WHERE deleted_at IS NULL AND status = 'active'
            AND ((mobile IS NOT NULL AND mobile = $1) OR ($2::text IS NOT NULL AND email IS NOT NULL AND lower(email::text) = lower($2)))
          LIMIT 3`,
        [values.mobile, values.email ?? null],
      );
      const y = new Date().getFullYear();
      const n = await c.query<{ n: number }>(
        `SELECT COALESCE(max(substring(number FROM '([0-9]+)$')::int), 0) + 1 AS n FROM job_applications WHERE number LIKE $1`,
        [`APP-${String(y)}-%`],
      );
      const number = `APP-${String(y)}-${String(n.rows[0]!.n).padStart(4, '0')}`;
      const r = await c.query<{ id: string }>(
        `INSERT INTO job_applications (school_id, number, vacancy_id, candidate_id, snapshot, snapshot_secure, employee_match,
                                       source, current_stage_id)
         VALUES (app.current_school_id(), $1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, 'office', $7) RETURNING id::text`,
        [
          number,
          dto.vacancyId,
          candidateId,
          JSON.stringify({
            values: p.values ?? {},
            rows: p.rows ?? {},
            activities: p.activities ?? [],
            files,
          }),
          JSON.stringify(cand.rows[0]!.secure ?? {}),
          match.rows.length ? JSON.stringify(match.rows) : null,
          v.rows[0].stage_ids[0] ?? null,
        ],
      );
      const id = r.rows[0]!.id;
      await this.event(c, ctx, id, 'added', 'Added by the office');
      // the application as entered, kept as a PDF the "received" email carries
      const pdf = await this.pdf.store(c, id);
      await c.query(`SELECT app.recruitment_notify($1, 'applied', $2::jsonb)`, [
        id,
        JSON.stringify(pdf ? { attachments: [pdf] } : {}),
      ]);
      await this.audit.stage(ctx, c, {
        action: 'people.recruitment.walk_in',
        entityType: 'job_applications',
        entityId: id,
      });
      return { id, number };
    });
  }

  // ---- notices -----------------------------------------------------------------------------------------

  async notices(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(
        `INSERT INTO recruitment_settings (school_id) VALUES (app.current_school_id()) ON CONFLICT DO NOTHING`,
      );
      const r = await c.query<{
        notify_applied: boolean;
        notify_scheduled: boolean;
        notify_selected: boolean;
        notify_rejected: boolean;
        by_sms: boolean;
        by_whatsapp: boolean;
        by_email: boolean;
      }>(
        `SELECT notify_applied, notify_scheduled, notify_selected, notify_rejected, by_sms, by_whatsapp, by_email FROM recruitment_settings`,
      );
      const s = r.rows[0]!;
      return {
        applied: s.notify_applied,
        scheduled: s.notify_scheduled,
        selected: s.notify_selected,
        rejected: s.notify_rejected,
        sms: s.by_sms,
        whatsapp: s.by_whatsapp,
        email: s.by_email,
      };
    });
  }

  async saveNotices(ctx: RequestContext, dto: RecruitmentNoticesDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(
        `INSERT INTO recruitment_settings (school_id, notify_applied, notify_scheduled, notify_selected, notify_rejected, by_sms, by_whatsapp, by_email)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (school_id) DO UPDATE SET notify_applied = $1, notify_scheduled = $2, notify_selected = $3, notify_rejected = $4,
           by_sms = $5, by_whatsapp = $6, by_email = $7, updated_at = now()`,
        [dto.applied, dto.scheduled, dto.selected, dto.rejected, dto.sms, dto.whatsapp, dto.email],
      );
      await c.query(`SELECT app.recruitment_seed_templates(app.current_school_id())`);
      await this.audit.stage(ctx, c, {
        action: 'people.recruitment.notices',
        entityType: 'recruitment_settings',
        entityId: requireTenant(ctx).schoolId,
        after: dto,
      });
      return { saved: true };
    });
  }

  /** The application PDF for the office (made again from the application as it was sent). */
  async applicationPdf(ctx: RequestContext, id: string) {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Application not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const out = await this.pdf.render(c, id);
      if (!out) throw new DomainError('not-found', 'Application not found', { status: 404 });
      return {
        filename: out.filename,
        contentType: 'application/pdf',
        base64: out.bytes.toString('base64'),
      };
    });
  }
}
