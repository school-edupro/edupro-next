import { Injectable } from '@nestjs/common';
import {
  LAYOUT_TYPES,
  admissionWaitingFor,
  answerText,
  fieldState,
  type AdmissionAnswers,
  type AdmissionField,
  type AdmissionFormDef,
  type PoolClient,
} from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { AdmissionCoreService } from './admission-core.service';
import type { ApprovalDecideDto, ApprovalsQueryDto } from './approvals.dto';
import { ADMISSION_SETUP_MANAGE, AdmissionProcessService } from './process.service';
import type { PointsCheckDto, SendBackDto } from './process.dto';

/** How long a decided registration stays in "Decided by me" (read-only). */
const DECIDED_DAYS = 30;
const NOT_ASKED = new Set(['file', 'photo', 'agree', 'address_same', 'signature']);

export interface LevelRemark {
  stage: string;
  level: number;
  levels: number;
  levelName: string;
  decision: string;
  remarks: string | null;
  by: string | null;
  at: string;
}

/**
 * Admission approvers (docs/design/50): the people a process level names see the registrations waiting
 * at their level and decide there — no Admissions permission needed — and, read-only for a while,
 * those they decided. Everything is checked per registration; one they may not see is "not found".
 */
@Injectable()
export class AdmissionApprovalsService {
  constructor(
    private readonly db: DbService,
    private readonly core: AdmissionCoreService,
    private readonly process: AdmissionProcessService,
  ) {}

  /** Waiting at a level this user is named in (may decide), or decided by them lately (may look). */
  private async access(c: PoolClient, ctx: RequestContext, id: string) {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Registration not found', { status: 404 });
    const waiting = await admissionWaitingFor(c, ctx.user.id);
    if (waiting.has(id)) return { mayDecide: true };
    if (ctx.permissions?.has(ADMISSION_SETUP_MANAGE)) {
      const w = await c.query(`SELECT 1 FROM admission_waiting WHERE id = $1`, [id]);
      if (w.rows.length) return { mayDecide: true };
    }
    const mine = await c.query(
      `SELECT 1 FROM admission_stage_results WHERE application_id = $1 AND decided_by = $2 AND undone_at IS NULL
          AND decided_at > now() - make_interval(days => $3)`,
      [id, ctx.user.id, DECIDED_DAYS],
    );
    if (mine.rows.length) return { mayDecide: false };
    throw new DomainError('not-found', 'Registration not found', { status: 404 });
  }

  /** Every level's decision with its remark, in order (the latest decision of each level). */
  private async remarksOf(c: PoolClient, ids: string[]): Promise<Map<string, LevelRemark[]>> {
    const out = new Map<string, LevelRemark[]>();
    if (!ids.length) return out;
    const r = await c.query<{
      application_id: string;
      stage: string;
      level: number;
      levels: number;
      level_name: string | null;
      decision: string;
      remarks: string | null;
      by: string | null;
      at: Date;
    }>(
      `SELECT DISTINCT ON (x.application_id, x.stage_id, x.level)
              x.application_id::text, st.name AS stage, x.level,
              COALESCE(jsonb_array_length(step -> 'levels'), 1) AS levels,
              step -> 'levels' -> (x.level - 1) ->> 'name' AS level_name,
              x.decision, x.remarks, x.decided_by_name AS by, x.decided_at AS at
         FROM admission_stage_results x
         JOIN applications a ON a.id = x.application_id
         JOIN admission_stages st ON st.id = x.stage_id
         LEFT JOIN LATERAL (SELECT s AS step FROM jsonb_array_elements(a.process_steps) s
                             WHERE s ->> 'stageId' = x.stage_id::text LIMIT 1) ps ON true
        WHERE x.application_id = ANY($1::bigint[]) AND x.undone_at IS NULL
        ORDER BY x.application_id, x.stage_id, x.level, x.decided_at DESC`,
      [ids],
    );
    for (const x of r.rows) {
      const list = out.get(x.application_id) ?? [];
      list.push({
        stage: x.stage,
        level: x.level,
        levels: x.levels,
        levelName: x.level_name ?? `Level ${String(x.level)}`,
        decision: x.decision,
        remarks: x.remarks,
        by: x.by,
        at: x.at.toISOString(),
      });
      out.set(x.application_id, list);
    }
    for (const l of out.values()) l.sort((a, b) => a.at.localeCompare(b.at));
    return out;
  }

  /** Waiting for me (to decide) or Decided by me (the last days), each with the levels' remarks. */
  async list(ctx: RequestContext, q: ApprovalsQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const waiting = [...(await admissionWaitingFor(c, ctx.user.id))];
      const decided = (
        await c.query<{ id: string }>(
          `SELECT DISTINCT x.application_id::text AS id FROM admission_stage_results x
            WHERE x.decided_by = $1 AND x.undone_at IS NULL AND x.decided_at > now() - make_interval(days => $2)`,
          [ctx.user.id, DECIDED_DAYS],
        )
      ).rows
        .map((x) => x.id)
        .filter((id) => !waiting.includes(id));
      const ids = q.tab === 'decided' ? decided : waiting;
      const r = ids.length
        ? await c.query<{
            id: string;
            number: string | null;
            candidate: string | null;
            class_name: string;
            session: string;
            category: string | null;
            status: string;
            form_points: string | null;
            merit: string | null;
            stage: string | null;
            level_no: number | null;
            levels: number | null;
            level_name: string | null;
            level_since: Date | null;
            due_at: Date | null;
          }>(
            `SELECT a.id::text, a.application_no AS number, a.candidate_name AS candidate, cl.name AS class_name, y.name AS session,
                    k.name AS category, a.status::text, a.form_points::text, a.merit::text,
                    st.name AS stage, w.level_no, w.levels, w.level ->> 'name' AS level_name, a.level_since, w.due_at
               FROM applications a JOIN classes cl ON cl.id = a.class_id JOIN admission_cycles y ON y.id = a.cycle_id
               LEFT JOIN admission_fee_categories k ON k.id = a.category_id
               LEFT JOIN admission_waiting w ON w.id = a.id
               LEFT JOIN admission_stages st ON st.id = (w.step ->> 'stageId')::bigint
              WHERE a.id = ANY($1::bigint[])
              ORDER BY (w.due_at < now()) DESC NULLS LAST, a.level_since NULLS LAST, a.id`,
            [ids],
          )
        : { rows: [] };
      const remarks = await this.remarksOf(
        c,
        r.rows.map((x) => x.id),
      );
      const now = Date.now();
      return {
        waiting: waiting.length,
        decided: decided.length,
        overdue: r.rows.filter((x) => q.tab !== 'decided' && x.due_at && x.due_at.getTime() < now)
          .length,
        data: r.rows.slice(0, q.size).map((x) => ({
          id: x.id,
          number: x.number,
          candidate: x.candidate,
          className: x.class_name,
          session: x.session,
          category: x.category,
          status: x.status,
          points: x.form_points !== null ? Number(x.form_points) : null,
          merit: x.merit !== null ? Number(x.merit) : null,
          stage: x.stage,
          level:
            x.level_no && x.levels
              ? `${x.level_name ?? `Level ${String(x.level_no)}`}${x.levels > 1 ? ` (${String(x.level_no)} of ${String(x.levels)})` : ''}`
              : null,
          since: x.level_since?.toISOString() ?? null,
          dueAt: x.due_at?.toISOString() ?? null,
          overdue: Boolean(x.due_at && x.due_at.getTime() < now),
          remarks: remarks.get(x.id) ?? [],
        })),
      };
    });
  }

  /** The review: the candidate, the answers by tab, the documents, the points and the stage path. */
  async review(ctx: RequestContext, id: string) {
    const { mayDecide } = await this.db.tenant(requireTenant(ctx), (c) => this.access(c, ctx, id));
    const d = await this.process.detail(ctx, id);
    const def = d.def as AdmissionFormDef;
    const answers = d.answers as AdmissionAnswers;
    const files = d.files as Record<string, { fileId: string; name: string; contentType: string }>;
    const shown = (f: AdmissionField) => fieldState(f, answers).shown;
    const sections = def.steps
      .map((s) => ({
        title: s.title,
        items: def.fields
          .filter(
            (f) =>
              f.step === s.key &&
              !LAYOUT_TYPES.includes(f.type) &&
              !NOT_ASKED.has(f.type) &&
              shown(f),
          )
          .map((f) => ({ label: f.label, value: answerText(f, answers[f.key]) || '-' })),
      }))
      .filter((s) => s.items.length);
    const docs = def.fields
      .filter((f) => (f.type === 'file' || f.type === 'photo') && shown(f))
      .map((f) => {
        const v = answers[f.key];
        const ids = (Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : []).map(String);
        return {
          key: f.key,
          label: f.label,
          files: ids.map((x) => ({
            id: x,
            name: files[x]?.name ?? 'File',
            contentType: files[x]?.contentType ?? '',
          })),
        };
      });
    const photo = docs.find((x) => x.key === 'student_photo' || /photo/.test(x.key))?.files[0]?.id;
    const remarks = await this.db.tenant(requireTenant(ctx), (c) => this.remarksOf(c, [id]));
    return {
      id: d.id,
      number: d.number,
      candidate: d.candidate,
      status: d.status,
      className: d.class.name,
      session: d.session.name,
      category: d.category,
      categoryId: d.categoryId,
      categories: d.categories,
      photoFileId: photo ?? null,
      mayDecide: mayDecide && d.process.canAct,
      current: d.process.current,
      path: d.process.steps,
      points: d.points,
      merit: d.merit,
      sections,
      documents: docs,
      remarks: remarks.get(id) ?? [],
      // the questions the approver may send back for correction
      fields: def.fields
        .filter((f) => !LAYOUT_TYPES.includes(f.type) && shown(f))
        .map((f) => ({ key: f.key, label: f.label })),
    };
  }

  async decide(ctx: RequestContext, id: string, dto: ApprovalDecideDto) {
    const a = await this.db.tenant(requireTenant(ctx), (c) => this.access(c, ctx, id));
    if (!a.mayDecide)
      throw new DomainError('admissions.not_yours', 'This registration no longer waits for you', {
        status: 409,
      });
    await this.process.decide(ctx, id, dto);
    return this.review(ctx, id);
  }

  async sendBack(ctx: RequestContext, id: string, dto: SendBackDto) {
    const a = await this.db.tenant(requireTenant(ctx), (c) => this.access(c, ctx, id));
    if (!a.mayDecide)
      throw new DomainError('admissions.not_yours', 'This registration no longer waits for you', {
        status: 409,
      });
    await this.process.sendBack(ctx, id, dto);
    return { ok: true };
  }

  async points(ctx: RequestContext, id: string, dto: PointsCheckDto) {
    const a = await this.db.tenant(requireTenant(ctx), (c) => this.access(c, ctx, id));
    if (!a.mayDecide)
      throw new DomainError('admissions.not_yours', 'This registration no longer waits for you', {
        status: 409,
      });
    return this.process.checkPoints(ctx, id, dto);
  }

  /** A document of a registration the approver may see (only files its answers name). */
  async file(ctx: RequestContext, id: string, fileId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.access(c, ctx, id);
      const a = await this.core.row(c, id);
      const named = JSON.stringify(a.data ?? {}).includes(`"${fileId}"`);
      if (!named || !/^\d{1,18}$/.test(fileId))
        throw new DomainError('not-found', 'File not found', { status: 404 });
      const f = await this.core.fileBytes(c, fileId);
      if (!f) throw new DomainError('not-found', 'File not found', { status: 404 });
      return f;
    });
  }
}
