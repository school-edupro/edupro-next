import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ENV, type Env } from '../../config/env';
import { PEOPLE } from './people.permissions';
import type {
  CancelCorrectionDto,
  CorrectionSettingsDto,
  MoveStageDto,
  SendBackDto,
  UndoDto,
} from './recruitment-corrections.dto';
import { APP_COLS, type AppRow, type AppStatus, type Correction } from './recruitment-app';

/** The parts of the careers form a correction can ask for, as the candidate's form names its steps. */
export const CORRECTION_STEPS: Record<string, string> = {
  personal: 'About you',
  contact: 'Contact and address',
  education: 'Education and experience',
  more: 'Present job and more',
  documents: 'Photo and documents',
};
/** The decisions that can be undone, as the history names them. */
const DECISIONS = ['passed', 'selected', 'not_taken_forward', 'on_hold', 'moved', 'returned'];
const WORD: Record<string, string> = {
  passed: 'Passed',
  selected: 'Selected',
  not_taken_forward: 'Not taken forward',
  on_hold: 'Put on hold',
  moved: 'Stage changed',
  returned: 'Sent back for correction',
};
interface ResultRow {
  stage_id: string;
  scheduled_at: Date | null;
  venue: string | null;
  panel: string | null;
  marks: string | null;
  max_marks: string | null;
  result: string | null;
  remarks: string | null;
  recorded_by: string | null;
  recorded_by_name: string | null;
  recorded_at: Date | null;
}
interface DecisionEvent {
  id: string;
  what: string;
  note: string | null;
  by_name: string | null;
  by_user: string | null;
  at: Date;
  detail: Record<string, unknown>;
}
const istDay = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;

/**
 * Recruitment, part 8 (docs/design/34-recruitment.md): putting an application right. The last decision on
 * it can be undone (the application goes back to where it was; the decision stays in the history, marked
 * undone) and it can be moved to another stage (forward: the stages between are skipped; back: an earlier
 * stage opens again), always with a reason. Who may is set in Recruitment set-up: the person who recorded a
 * result, within the hours set, and the roles and named employees set, at any time. The office may also
 * send an application back to the candidate to correct the parts it marks, by a date; the candidate is
 * told (and reminded a day before), and the corrected application comes back where it was.
 */
@Injectable()
export class RecruitmentCorrectionsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async settingsOf(c: PoolClient) {
    await c.query(
      `INSERT INTO recruitment_settings (school_id) VALUES (app.current_school_id()) ON CONFLICT DO NOTHING`,
    );
    return (
      await c.query<{
        undo_hours: number;
        undo_roles: string[];
        undo_employee_ids: string[];
        correction_days: number;
        notify_selected: boolean;
        notify_rejected: boolean;
      }>(
        `SELECT undo_hours, undo_roles, undo_employee_ids::text[] AS undo_employee_ids, correction_days,
                notify_selected, notify_rejected
           FROM recruitment_settings WHERE school_id = app.current_school_id()`,
      )
    ).rows[0]!;
  }

  /** The set-up, with the roles and staff it picks from. */
  async settings(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await this.settingsOf(c);
      const roles = await c.query<{ code: string; name: string }>(
        `SELECT DISTINCT ON (r.code) r.code, r.name FROM roles r
          WHERE (r.school_id IS NULL OR r.school_id = app.current_school_id()) AND r.code NOT IN ('parent', 'student')
          ORDER BY r.code, r.school_id NULLS LAST`,
      );
      const staff = await c.query<{
        id: string;
        code: string;
        name: string;
        designation: string | null;
      }>(
        `SELECT id::text, employee_code AS code, display_name AS name, designation FROM employees
          WHERE deleted_at IS NULL AND status = 'active' ORDER BY display_name LIMIT 3000`,
      );
      return {
        undoHours: s.undo_hours,
        undoRoles: s.undo_roles,
        undoEmployeeIds: s.undo_employee_ids,
        correctionDays: s.correction_days,
        roles: roles.rows.sort((a, b) => a.name.localeCompare(b.name)),
        staff: staff.rows,
        can: { manage: ctx.permissions?.has(PEOPLE.recruitmentManage) ?? false },
      };
    });
  }

  async saveSettings(ctx: RequestContext, dto: CorrectionSettingsDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.settingsOf(c);
      await c.query(
        `UPDATE recruitment_settings SET undo_hours = $1, undo_roles = $2::text[], undo_employee_ids = $3::bigint[],
                correction_days = $4, updated_at = now() WHERE school_id = app.current_school_id()`,
        [
          dto.undoHours,
          [...new Set(dto.undoRoles)],
          [...new Set(dto.undoEmployeeIds)],
          dto.correctionDays,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'people.recruitment.correction_settings',
        entityType: 'recruitment_settings',
        entityId: requireTenant(ctx).schoolId,
        after: dto,
      });
      return { saved: true };
    });
  }

  /** May the signed-in person undo any decision and move stages (a role or a name in the set-up)? */
  private async mayAny(c: PoolClient, s: { undo_roles: string[]; undo_employee_ids: string[] }) {
    const r = await c.query(
      `SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = app.current_user_id() AND ur.school_id = app.current_school_id() AND r.code = ANY($1::text[])
          AND ur.revoked_at IS NULL AND ur.valid_from <= CURRENT_DATE AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)
       UNION ALL
       SELECT 1 FROM employees e WHERE e.user_id = app.current_user_id() AND e.id = ANY($2::bigint[]) AND e.deleted_at IS NULL
       LIMIT 1`,
      [s.undo_roles, s.undo_employee_ids],
    );
    return (r.rowCount ?? 0) > 0;
  }

  private async load(c: PoolClient, id: string): Promise<AppRow> {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Application not found', { status: 404 });
    // eslint-disable-next-line no-restricted-syntax -- a fixed fragment; the id is bound
    const r = await c.query<AppRow>(`${APP_COLS} WHERE a.id = $1 FOR UPDATE OF a`, [id]);
    if (!r.rows[0]) throw new DomainError('not-found', 'Application not found', { status: 404 });
    return r.rows[0];
  }

  private async results(c: PoolClient, id: string) {
    return (
      await c.query<ResultRow>(
        `SELECT stage_id::text, scheduled_at, venue, panel, marks::text, max_marks::text, result, remarks, recorded_by::text,
                recorded_by_name, recorded_at
           FROM application_stage_results WHERE application_id = $1`,
        [id],
      )
    ).rows;
  }

  private async lastDecision(c: PoolClient, id: string) {
    return (
      await c.query<DecisionEvent>(
        `SELECT id::text, what, note, by_name, by_user::text, at, detail FROM job_application_events
          WHERE application_id = $1 AND what = ANY($2::text[]) AND revoked_at IS NULL ORDER BY at DESC, id DESC LIMIT 1`,
        [id, DECISIONS],
      )
    ).rows[0];
  }

  private async event(
    c: PoolClient,
    ctx: RequestContext,
    id: string,
    what: string,
    note: string | null,
    detail: Record<string, unknown> = {},
  ) {
    await c.query(
      `INSERT INTO job_application_events (school_id, application_id, what, note, by_name, by_user, detail)
       VALUES (app.current_school_id(), $1, $2, $3, $4, app.current_user_id(), $5::jsonb)`,
      [id, what, note, ctx.user.displayName, JSON.stringify(detail)],
    );
  }

  /** The stage a decision was at: the one it names, or (older steps) the one called by its note. */
  private stageOf(a: AppRow, e: DecisionEvent, names: Map<string, string>): string | null {
    const id = e.detail.stageId;
    if (typeof id === 'string' && a.stage_ids.includes(id)) return id;
    const name = (e.note ?? '').split(':')[0]!.trim();
    return a.stage_ids.find((s) => names.get(s) === name) ?? null;
  }

  private async stageNames(c: PoolClient, a: AppRow) {
    const r = await c.query<{ id: string; name: string }>(
      `SELECT id::text, name FROM recruitment_stages WHERE id = ANY($1::bigint[])`,
      [a.stage_ids],
    );
    return new Map(r.rows.map((x) => [x.id, x.name]));
  }

  /**
   * What the page needs to offer the corrections: the last decision and whether the signed-in person may
   * undo it, whether they may move stages, and the correction asked of the candidate.
   */
  async rights(c: PoolClient, ctx: RequestContext, a: AppRow) {
    const s = await this.settingsOf(c);
    const any = await this.mayAny(c, s);
    const last =
      a.status === 'joined' || a.status === 'withdrawn'
        ? undefined
        : await this.lastDecision(c, a.id);
    let mayUndo = false;
    if (last) {
      if (any) mayUndo = true;
      else if (s.undo_hours > 0) {
        let by = last.by_user;
        if (!by && last.what !== 'moved' && last.what !== 'returned') {
          const names = await this.stageNames(c, a);
          const st = this.stageOf(a, last, names);
          by = st
            ? ((await this.results(c, a.id)).find((r) => r.stage_id === st)?.recorded_by ?? null)
            : null;
        }
        mayUndo = by === ctx.user.id && Date.now() - last.at.getTime() <= s.undo_hours * 3_600_000;
      }
    }
    const manage = ctx.permissions?.has(PEOPLE.recruitmentManage) ?? false;
    return {
      last: last
        ? {
            what: last.what,
            label: `${WORD[last.what] ?? last.what}${last.note ? `: ${last.note}` : ''}`,
            at: last.at.toISOString(),
            by: last.by_name,
          }
        : null,
      undo: mayUndo,
      move: any && ['submitted', 'screening', 'on_hold', 'rejected', 'selected'].includes(a.status),
      sendBack: manage && ['submitted', 'screening', 'on_hold', 'returned'].includes(a.status),
      cancelCorrection: manage && a.status === 'returned',
      correctionDays: s.correction_days,
      undoHours: s.undo_hours,
    };
  }

  private async notify(
    c: PoolClient,
    id: string,
    event: string,
    extra: Record<string, unknown> = {},
  ) {
    await c.query(`SELECT app.recruitment_notify($1, $2, $3::jsonb)`, [
      id,
      event,
      JSON.stringify(extra),
    ]);
  }

  private async careersLink(c: PoolClient) {
    const r = await c.query<{ code: string }>(
      `SELECT lower(code) AS code FROM schools WHERE id = app.current_school_id()`,
    );
    return `${this.env.PUBLIC_APP_URL.replace(/\/$/, '')}/${r.rows[0]!.code}/careers/mine`;
  }

  /** Undoes the last decision on the application: it goes back to where it was; the decision stays, undone. */
  async undo(ctx: RequestContext, id: string, dto: UndoDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const a = await this.load(c, id);
      const r = await this.rights(c, ctx, a);
      const last = await this.lastDecision(c, id);
      if (!last || !r.last)
        throw new DomainError('recruitment.nothing_to_undo', 'There is no decision to undo', {
          status: 409,
        });
      if (!r.undo)
        throw new DomainError(
          'recruitment.undo_not_allowed',
          r.undoHours > 0
            ? `Only the person who recorded it may undo it, within ${String(r.undoHours)} hours, or those named in Recruitment set-up`
            : 'Only those named in Recruitment set-up may undo a decision',
          { status: 403 },
        );
      const names = await this.stageNames(c, a);
      const stage = this.stageOf(a, last, names);
      const clear = async (stageId: string | null, results?: string[]) => {
        if (!stageId) return;
        await c.query(
          `UPDATE application_stage_results SET result = NULL, recorded_by = NULL, recorded_by_name = NULL, recorded_at = NULL,
                  updated_at = now()
            WHERE application_id = $1 AND stage_id = $2 AND ($3::text[] IS NULL OR result = ANY($3::text[]))`,
          [id, stageId, results ?? null],
        );
      };
      const set = (status: AppStatus, stageId: string | null) =>
        c.query(
          `UPDATE job_applications SET status = $2, current_stage_id = COALESCE($3, current_stage_id), decided_at = NULL,
                  decision_note = NULL, updated_at = now() WHERE id = $1`,
          [id, status, stageId],
        );
      let tell = false;
      const settings = await this.settingsOf(c);
      if (last.what === 'passed') {
        await clear(stage, ['pass']);
        await set('screening', stage);
      } else if (last.what === 'selected') {
        await clear(stage ?? a.stage_ids[a.stage_ids.length - 1] ?? null, ['pass']);
        await set('screening', stage);
        tell = settings.notify_selected;
      } else if (last.what === 'not_taken_forward') {
        await clear(stage ?? a.current_stage_id, ['fail']);
        const prev = last.detail.prevStatus;
        const any = (await this.results(c, id)).some((x) => x.result);
        await set(
          prev === 'on_hold' ? 'on_hold' : any || prev === 'screening' ? 'screening' : 'submitted',
          stage,
        );
        tell = settings.notify_rejected;
      } else if (last.what === 'on_hold') {
        await clear(stage ?? a.current_stage_id, ['hold']);
        await set('screening', stage);
      } else if (last.what === 'moved') {
        const d = last.detail as {
          before?: {
            status: AppStatus;
            stageId: string | null;
            decisionNote: string | null;
            decidedAt: string | null;
          };
          rows?: Array<ResultRow | null>;
          stages?: string[];
        };
        // the stages the move skipped or opened again take back what they had
        for (const [i, sid] of (d.stages ?? []).entries()) {
          const row = d.rows?.[i] ?? null;
          if (!row) {
            await c.query(
              `DELETE FROM application_stage_results WHERE application_id = $1 AND stage_id = $2`,
              [id, sid],
            );
            continue;
          }
          await c.query(
            `UPDATE application_stage_results SET result = $3, remarks = $4, marks = $5, recorded_by = $6, recorded_by_name = $7,
                    recorded_at = $8, updated_at = now()
              WHERE application_id = $1 AND stage_id = $2`,
            [
              id,
              sid,
              row.result,
              row.remarks,
              row.marks,
              row.recorded_by,
              row.recorded_by_name,
              row.recorded_at,
            ],
          );
        }
        if (d.before)
          await c.query(
            `UPDATE job_applications SET status = $2, current_stage_id = $3, decision_note = $4, decided_at = $5, updated_at = now()
              WHERE id = $1`,
            [id, d.before.status, d.before.stageId, d.before.decisionNote, d.before.decidedAt],
          );
      } else if (last.what === 'returned') {
        await this.withdrawCorrection(c, a);
      }
      await c.query(`UPDATE job_application_events SET revoked_at = now() WHERE id = $1`, [
        last.id,
      ]);
      await this.event(c, ctx, id, 'revoked', `${r.last.label} · ${dto.reason}`, {
        eventId: last.id,
      });
      // the candidate was told of a decision now undone: a correction goes
      if (tell) await this.notify(c, id, 'reopened');
      await this.audit.stage(ctx, c, {
        action: 'people.recruitment.undo',
        entityType: 'job_applications',
        entityId: id,
        after: { undone: last.what, reason: dto.reason },
      });
      const now = await this.load(c, id);
      return { status: now.status, stageId: now.current_stage_id, told: tell };
    });
  }

  /**
   * Moves the application to another stage of its vacancy. Forward, the stages between that were not
   * passed are skipped (with the reason); back (or the same stage), that stage and the ones after it open
   * again. What they had is kept in the history, so the move itself can be undone.
   */
  async move(ctx: RequestContext, id: string, dto: MoveStageDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const a = await this.load(c, id);
      const r = await this.rights(c, ctx, a);
      if (!r.move)
        throw new DomainError(
          a.status === 'joined' || a.status === 'withdrawn' || a.status === 'returned'
            ? 'recruitment.not_movable'
            : 'recruitment.move_not_allowed',
          a.status === 'returned'
            ? 'The application is with the candidate for correction'
            : a.status === 'joined' || a.status === 'withdrawn'
              ? 'This application is closed'
              : 'Only those named in Recruitment set-up may change a stage',
          {
            status:
              a.status === 'joined' || a.status === 'withdrawn' || a.status === 'returned'
                ? 409
                : 403,
          },
        );
      const t = a.stage_ids.indexOf(dto.stageId);
      if (t < 0)
        throw new DomainError('validation-failed', 'The stage is not one of this vacancy', {
          status: 400,
        });
      const cur = Math.max(0, a.current_stage_id ? a.stage_ids.indexOf(a.current_stage_id) : 0);
      const names = await this.stageNames(c, a);
      const rows = new Map((await this.results(c, id)).map((x) => [x.stage_id, x]));
      const stages: string[] = [];
      const saved: Array<ResultRow | null> = [];
      if (t > cur) {
        for (const sid of a.stage_ids.slice(cur, t)) {
          const row = rows.get(sid) ?? null;
          if (row?.result === 'pass') continue;
          stages.push(sid);
          saved.push(row);
          await c.query(
            `INSERT INTO application_stage_results (school_id, application_id, stage_id, result, remarks, recorded_by, recorded_by_name, recorded_at)
             VALUES (app.current_school_id(), $1, $2, 'skipped', $3, app.current_user_id(), $4, now())
             ON CONFLICT (application_id, stage_id) DO UPDATE SET result = 'skipped', remarks = EXCLUDED.remarks,
               recorded_by = EXCLUDED.recorded_by, recorded_by_name = EXCLUDED.recorded_by_name, recorded_at = now(), updated_at = now()`,
            [id, sid, `Skipped: ${dto.reason}`, ctx.user.displayName],
          );
        }
      } else {
        for (const sid of a.stage_ids.slice(t)) {
          const row = rows.get(sid);
          if (!row?.result) continue;
          stages.push(sid);
          saved.push(row);
          await c.query(
            `UPDATE application_stage_results SET result = NULL, recorded_by = NULL, recorded_by_name = NULL, recorded_at = NULL,
                    updated_at = now() WHERE application_id = $1 AND stage_id = $2`,
            [id, sid],
          );
        }
      }
      await c.query(
        `UPDATE job_applications SET status = 'screening', current_stage_id = $2, decided_at = NULL, decision_note = NULL,
                updated_at = now() WHERE id = $1`,
        [id, dto.stageId],
      );
      const from = a.current_stage_id ? (names.get(a.current_stage_id) ?? '') : '';
      const to = names.get(dto.stageId) ?? '';
      await this.event(c, ctx, id, 'moved', `${from ? `${from} → ` : ''}${to} · ${dto.reason}`, {
        stageId: dto.stageId,
        before: {
          status: a.status,
          stageId: a.current_stage_id,
          decisionNote: a.decision_note,
          decidedAt: a.decided_at?.toISOString() ?? null,
        },
        stages,
        rows: saved,
      });
      // the candidate was told it was over (selected, not taken forward): it is under review again
      const s = await this.settingsOf(c);
      const tell =
        (a.status === 'rejected' && s.notify_rejected) ||
        (a.status === 'selected' && s.notify_selected);
      if (tell) await this.notify(c, id, 'reopened');
      await this.audit.stage(ctx, c, {
        action: 'people.recruitment.move_stage',
        entityType: 'job_applications',
        entityId: id,
        after: { from: a.current_stage_id, to: dto.stageId, reason: dto.reason },
      });
      return {
        status: 'screening',
        stageId: dto.stageId,
        skipped: t > cur ? stages.length : 0,
        told: tell,
      };
    });
  }

  /**
   * Sends the application back to the candidate to correct the parts marked, by a date: screening pauses;
   * the candidate is emailed (and reminded a day before). Sent again, the remark and the date change.
   */
  async sendBack(ctx: RequestContext, id: string, dto: SendBackDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const a = await this.load(c, id);
      if (!['submitted', 'screening', 'on_hold', 'returned'].includes(a.status))
        throw new DomainError('recruitment.decided', 'This application is already decided', {
          status: 409,
        });
      const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
      const latest = new Date(Date.parse(`${today}T00:00:00Z`) + 60 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      if (dto.dueOn <= today || dto.dueOn > latest)
        throw new DomainError(
          'validation-failed',
          'Correct by: a date from tomorrow, within 60 days',
          {
            status: 400,
          },
        );
      const steps = [...new Set(dto.steps)];
      const partsText = steps.map((x) => CORRECTION_STEPS[x]).join(', ');
      const prev: AppStatus =
        a.status === 'returned' ? (a.correction?.prevStatus ?? 'submitted') : a.status;
      const correction: Correction = {
        remark: dto.remark,
        steps,
        partsText,
        dueOn: dto.dueOn,
        at: new Date().toISOString(),
        byName: ctx.user.displayName,
        byUser: ctx.user.id,
        prevStatus: prev,
      };
      await c.query(
        `UPDATE job_applications SET status = 'returned', correction = $2::jsonb, updated_at = now() WHERE id = $1`,
        [id, JSON.stringify(correction)],
      );
      await this.event(
        c,
        ctx,
        id,
        'returned',
        `${partsText} · ${dto.remark} · by ${istDay(dto.dueOn)}`,
        {
          prevStatus: prev,
        },
      );
      await this.notify(c, id, 'returned', {
        remark: dto.remark,
        parts: partsText,
        due: istDay(dto.dueOn),
        link: await this.careersLink(c),
      });
      await this.audit.stage(ctx, c, {
        action: 'people.recruitment.send_back',
        entityType: 'job_applications',
        entityId: id,
        after: { steps, dueOn: dto.dueOn },
      });
      return { status: 'returned', dueOn: dto.dueOn };
    });
  }

  private async withdrawCorrection(c: PoolClient, a: AppRow) {
    await c.query(
      `UPDATE job_applications SET status = $2, correction = correction || jsonb_build_object('cancelledAt', now()),
              updated_at = now() WHERE id = $1`,
      [a.id, a.correction?.prevStatus ?? 'submitted'],
    );
  }

  /** The office takes back its request for a correction: the application goes on as it was. */
  async cancelCorrection(ctx: RequestContext, id: string, dto: CancelCorrectionDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const a = await this.load(c, id);
      if (a.status !== 'returned')
        throw new DomainError(
          'recruitment.not_returned',
          'The application is not with the candidate',
          {
            status: 409,
          },
        );
      await this.withdrawCorrection(c, a);
      const last = await this.lastDecision(c, id);
      if (last?.what === 'returned')
        await c.query(`UPDATE job_application_events SET revoked_at = now() WHERE id = $1`, [
          last.id,
        ]);
      await this.event(c, ctx, id, 'correction_withdrawn', dto.reason ?? null);
      return { status: a.correction?.prevStatus ?? 'submitted' };
    });
  }
}
