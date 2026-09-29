import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { MODULE_FLAGS } from '../platform/settings.catalogue';
import { SettingsService } from '../platform/settings.service';
import { ReportsService } from '../reports/reports.service';
import type {
  CloseMonthDto,
  CreateRunDto,
  IssueDto,
  IssueListDto,
  IssueUpdateDto,
  LegacyCountsDto,
  LockDto,
  ReopenMonthDto,
  RunStatusDto,
  StepDto,
} from './ops.dto';

type Row = Record<string, unknown>;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

/** The steps of the go-live runbook, installed on every new cut-over run. */
export const DEFAULT_STEPS: Array<[phase: string, code: string, title: string, owner: string]> = [
  ['readiness', 'uat_signed', 'UAT scripts signed by the pilot super-users', 'delivery_lead'],
  ['readiness', 'vapt_clean', 'VAPT certificate: no open critical or high finding', 'platform'],
  [
    'readiness',
    'env_ready',
    'Production environment applied; secrets, One Auth, gateway live-mode test',
    'platform',
  ],
  [
    'readiness',
    'providers',
    'SMS / WhatsApp / email providers connected; DLT templates approved',
    'platform',
  ],
  [
    'readiness',
    'privacy',
    'Privacy notice, consent purposes, retention settings, DPO named',
    'school_admin',
  ],
  [
    'readiness',
    'training',
    'Training sessions done; in-app tours enabled; help desk rota published',
    'delivery_lead',
  ],
  ['readiness', 'apps', 'App store builds approved; forced-update floor set', 'platform'],
  [
    't_minus_7',
    'etl_dry_run',
    'Final ETL dry run into a scratch database; reconciliation attached',
    'data',
  ],
  ['t_minus_7', 'restore_drill', 'Restore drill of the production backup; RTO met', 'platform'],
  ['t_minus_7', 'load_test', 'Load test on production-like staging', 'platform'],
  ['t_minus_7', 'go_no_go', 'Go / no-go meeting held; decision recorded', 'delivery_lead'],
  ['t_minus_1', 'announce', 'Maintenance window announced to families and staff', 'school_admin'],
  [
    't_minus_1',
    'legacy_readonly',
    'Legacy application switched to read-only; cron jobs stopped',
    'platform',
  ],
  ['t_minus_1', 'final_dump', 'Final legacy dump taken; checksum recorded', 'data'],
  [
    'cutover',
    'etl_load',
    'ETL run against production per module; reconciliation per stage',
    'data',
  ],
  [
    'cutover',
    'post_load_checks',
    'RLS forced, schema version, marts refreshed, five pupils traced end to end',
    'platform',
  ],
  [
    'cutover',
    'configure',
    'Settings, year and terms, number sequences continued, fee structures verified',
    'school_admin',
  ],
  [
    'cutover',
    'users',
    'Key users sign in with One Auth; menus confirmed; MFA enrolled',
    'school_admin',
  ],
  [
    'cutover',
    'payment_test',
    'One live ₹1 payment, receipt and next-morning settlement',
    'accounts',
  ],
  ['cutover', 'compat', 'Compat gateway rewritten; current app builds read live data', 'platform'],
  [
    'cutover',
    'monday_dry_run',
    'Attendance for one section, one receipt, one notice, one WhatsApp',
    'school_admin',
  ],
  [
    'cutover',
    'reconciliation',
    'Legacy and live counts reconciled (snapshot sign-off)',
    'delivery_lead',
  ],
  ['cutover', 'switch', 'DNS and app configuration switched; legacy kept read-only', 'platform'],
  ['hypercare', 'desk', 'On-site support desk for the first three school days', 'delivery_lead'],
  [
    'hypercare',
    'standup',
    'Daily stand-up with the school; issue list and counts',
    'delivery_lead',
  ],
  [
    'hypercare',
    'nightly',
    'Nightly checks: jobs, outbox, exports, retention, error rate, backups',
    'platform',
  ],
  [
    'hypercare',
    'exit',
    'Two weeks without S1/S2; month-end accepted; legacy archived',
    'delivery_lead',
  ],
];

const SEVERITY_ORDER = ['s1', 's2', 's3', 's4'];

@Injectable()
export class OpsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly reports: ReportsService,
  ) {}

  private async setting<T = unknown>(ctx: RequestContext, key: string, def: T): Promise<T> {
    const s = (await this.settings.current(requireTenant(ctx))).find((x) => x.key === key);
    return (s?.value as T | undefined) ?? def;
  }

  // ---- feature flags ---------------------------------------------------------------------------------
  async features(ctx: RequestContext) {
    const raw = await this.setting<string>(ctx, 'platform.modules_enabled', MODULE_FLAGS.join(','));
    const enabled = new Set(
      String(raw)
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    );
    const until = await this.setting<string>(ctx, 'platform.hypercare_until', '');
    return {
      modules: MODULE_FLAGS.map((m) => ({ module: m, enabled: enabled.has(m) })),
      hypercareUntil: until || null,
      hypercare: !until || until >= new Date().toISOString().slice(0, 10),
    };
  }

  // ---- cut-over runs ---------------------------------------------------------------------------------
  private static readonly RUN = `SELECT r.id::text, r.kind, r.name, r.status, r.started_at, r.finished_at, r.notes, r.created_at, r.signed_off_at,
       cb.display_name AS created_by, sb.display_name AS signed_off_by,
       (SELECT count(*) FROM cutover_steps s WHERE s.run_id = r.id)::int AS steps,
       (SELECT count(*) FROM cutover_steps s WHERE s.run_id = r.id AND s.status = 'done')::int AS done_steps,
       (SELECT COALESCE(sum(s.duration_s), 0) FROM cutover_steps s WHERE s.run_id = r.id)::int AS duration_s
  FROM cutover_runs r LEFT JOIN users cb ON cb.id = r.created_by LEFT JOIN users sb ON sb.id = r.signed_off_by`;

  private toRun(x: Row) {
    return {
      id: String(x.id),
      kind: String(x.kind),
      name: String(x.name),
      status: String(x.status),
      startedAt: iso(x.started_at),
      finishedAt: iso(x.finished_at),
      notes: (x.notes as string | null) ?? null,
      createdAt: iso(x.created_at)!,
      createdBy: (x.created_by as string | null) ?? null,
      signedOffAt: iso(x.signed_off_at),
      signedOffBy: (x.signed_off_by as string | null) ?? null,
      steps: Number(x.steps),
      doneSteps: Number(x.done_steps),
      durationS: Number(x.duration_s),
    };
  }

  async runs(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      // eslint-disable-next-line no-restricted-syntax -- fixed SELECT fragment constant; values are bound parameters
      const r = await c.query<Row>(`${OpsService.RUN} ORDER BY r.created_at DESC LIMIT 50`);
      return r.rows.map((x) => this.toRun(x));
    });
  }

  async createRun(ctx: RequestContext, dto: CreateRunDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO cutover_runs (school_id, kind, name, notes, created_by) VALUES (app.current_school_id(), $1, $2, $3, app.current_user_id()) RETURNING id::text`,
        [dto.kind, dto.name, dto.notes ?? null],
      );
      const id = r.rows[0]!.id;
      let seq = 0;
      for (const [phase, code, title, owner] of DEFAULT_STEPS) {
        seq += 10;
        await c.query(
          `INSERT INTO cutover_steps (school_id, run_id, sequence, phase, code, title, owner_role) VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6)`,
          [id, seq, phase, code, title, owner],
        );
      }
      await this.audit.stage(ctx, c, {
        action: 'ops.cutover.create',
        entityType: 'cutover_runs',
        entityId: id,
        after: { kind: dto.kind, name: dto.name },
      });
      return this.runDetail(ctx, id, c);
    });
  }

  async runDetail(ctx: RequestContext, id: string, client?: PoolClient) {
    const work = async (c: PoolClient) => {
      // eslint-disable-next-line no-restricted-syntax -- fixed SELECT fragment constant; values are bound parameters
      const r = await c.query<Row>(`${OpsService.RUN} WHERE r.id = $1`, [id]);
      if (!r.rows[0]) throw new DomainError('not-found', 'Run not found', { status: 404 });
      const steps = await c.query<Row>(
        `SELECT s.id::text, s.sequence, s.phase, s.code, s.title, s.owner_role, s.status, s.done_at, s.duration_s, s.note, u.display_name AS done_by
           FROM cutover_steps s LEFT JOIN users u ON u.id = s.done_by WHERE s.run_id = $1 ORDER BY s.sequence`,
        [id],
      );
      const snaps = await c.query<Row>(
        `SELECT s.id::text, s.source, s.counts, s.taken_at, u.display_name AS taken_by FROM cutover_snapshots s LEFT JOIN users u ON u.id = s.taken_by
          WHERE s.run_id = $1 ORDER BY s.taken_at DESC`,
        [id],
      );
      const legacy = snaps.rows.find((s) => s.source === 'legacy');
      const live = snaps.rows.find((s) => s.source === 'live');
      const tolerance = Number(await this.setting(ctx, 'platform.cutover_tolerance_pct', 0)) || 0;
      const reconciliation = this.reconcile(
        (legacy?.counts as Record<string, unknown>) ?? null,
        (live?.counts as Record<string, unknown>) ?? null,
        tolerance,
      );
      return {
        ...this.toRun(r.rows[0]),
        steps: steps.rows.map((s) => ({
          id: String(s.id),
          sequence: Number(s.sequence),
          phase: String(s.phase),
          code: String(s.code),
          title: String(s.title),
          ownerRole: (s.owner_role as string | null) ?? null,
          status: String(s.status),
          doneAt: iso(s.done_at),
          doneBy: (s.done_by as string | null) ?? null,
          durationS: s.duration_s == null ? null : Number(s.duration_s),
          note: (s.note as string | null) ?? null,
        })),
        snapshots: snaps.rows.map((s) => ({
          id: String(s.id),
          source: String(s.source),
          counts: s.counts as Record<string, unknown>,
          takenAt: iso(s.taken_at)!,
          takenBy: (s.taken_by as string | null) ?? null,
        })),
        reconciliation,
        tolerancePct: tolerance,
      };
    };
    return client ? work(client) : this.db.tenant(requireTenant(ctx), work);
  }

  private reconcile(
    legacy: Record<string, unknown> | null,
    live: Record<string, unknown> | null,
    tolerancePct: number,
  ) {
    if (!legacy || !live) return { ready: false, rows: [], mismatches: 0 };
    const keys = [...new Set([...Object.keys(legacy), ...Object.keys(live)])].sort();
    const rows = keys.map((k) => {
      const a = Number(legacy[k] ?? 0);
      const b = Number(live[k] ?? 0);
      const diff = b - a;
      const pct = a === 0 ? (b === 0 ? 0 : 100) : Math.abs(diff / a) * 100;
      return { measure: k, legacy: a, live: b, diff, withinTolerance: pct <= tolerancePct };
    });
    return { ready: true, rows, mismatches: rows.filter((r) => !r.withinTolerance).length };
  }

  async setRunStatus(ctx: RequestContext, id: string, dto: RunStatusDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `UPDATE cutover_runs SET status = $2, notes = COALESCE($3, notes),
                started_at = CASE WHEN $2 = 'running' THEN COALESCE(started_at, now()) ELSE started_at END,
                finished_at = CASE WHEN $2 IN ('done', 'aborted') THEN now() ELSE finished_at END, updated_at = now()
          WHERE id = $1 AND status <> 'done'`,
        [id, dto.status, dto.notes ?? null],
      );
      if (!r.rowCount)
        throw new DomainError('conflict', 'Run not found or already done', { status: 409 });
      await this.audit.stage(ctx, c, {
        action: `ops.cutover.${dto.status}`,
        entityType: 'cutover_runs',
        entityId: id,
      });
      return this.runDetail(ctx, id, c);
    });
  }

  /** Ticks a step; the duration is the time since the previous done step when not given. */
  async setStep(ctx: RequestContext, runId: string, stepId: string, dto: StepDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const prev = await c.query<{ done_at: Date | null; started_at: Date | null }>(
        `SELECT (SELECT max(done_at) FROM cutover_steps WHERE run_id = $1 AND status IN ('done', 'skipped', 'failed')) AS done_at,
                (SELECT started_at FROM cutover_runs WHERE id = $1) AS started_at`,
        [runId],
      );
      const since = prev.rows[0]?.done_at ?? prev.rows[0]?.started_at ?? null;
      const duration =
        dto.durationS ??
        (since && dto.status !== 'pending'
          ? Math.round((Date.now() - since.getTime()) / 1000)
          : null);
      const r = await c.query(
        `UPDATE cutover_steps SET status = $3, note = COALESCE($4, note),
                done_by = CASE WHEN $3 = 'pending' THEN NULL ELSE app.current_user_id() END,
                done_at = CASE WHEN $3 = 'pending' THEN NULL ELSE now() END,
                duration_s = CASE WHEN $3 = 'pending' THEN NULL ELSE $5::int END
          WHERE id = $2 AND run_id = $1`,
        [runId, stepId, dto.status, dto.note ?? null, duration],
      );
      if (!r.rowCount) throw new DomainError('not-found', 'Step not found', { status: 404 });
      await c.query(
        `UPDATE cutover_runs SET status = 'running', started_at = COALESCE(started_at, now()), updated_at = now() WHERE id = $1 AND status = 'planned'`,
        [runId],
      );
      return this.runDetail(ctx, runId, c);
    });
  }

  async snapshotLive(ctx: RequestContext, runId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const counts = await c.query<{ counts: Record<string, unknown> }>(
        `SELECT app.live_counts() AS counts`,
      );
      await c.query(`DELETE FROM cutover_snapshots WHERE run_id = $1 AND source = 'live'`, [runId]);
      await c.query(
        `INSERT INTO cutover_snapshots (school_id, run_id, source, counts, taken_by) VALUES (app.current_school_id(), $1, 'live', $2::jsonb, app.current_user_id())`,
        [runId, JSON.stringify(counts.rows[0]!.counts)],
      );
      return this.runDetail(ctx, runId, c);
    });
  }

  async snapshotLegacy(ctx: RequestContext, runId: string, dto: LegacyCountsDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`DELETE FROM cutover_snapshots WHERE run_id = $1 AND source = 'legacy'`, [
        runId,
      ]);
      await c.query(
        `INSERT INTO cutover_snapshots (school_id, run_id, source, counts, taken_by) VALUES (app.current_school_id(), $1, 'legacy', $2::jsonb, app.current_user_id())`,
        [runId, JSON.stringify(dto.counts)],
      );
      return this.runDetail(ctx, runId, c);
    });
  }

  /** Sign-off: every step done or skipped and the reconciliation within tolerance. */
  async signOff(ctx: RequestContext, runId: string) {
    const detail = await this.runDetail(ctx, runId);
    const pending = detail.steps.filter((s) => s.status === 'pending' || s.status === 'failed');
    if (pending.length)
      throw new DomainError(
        'conflict',
        `${pending.length} step(s) are not done: ${pending.map((s) => s.code).join(', ')}`,
        { status: 409 },
      );
    if (!detail.reconciliation.ready)
      throw new DomainError(
        'conflict',
        'Take the live snapshot and enter the legacy counts first',
        { status: 409 },
      );
    if (detail.reconciliation.mismatches)
      throw new DomainError(
        'cutover.reconciliation_failed',
        `${detail.reconciliation.mismatches} measure(s) differ beyond the tolerance`,
        {
          status: 409,
          extra: { rows: detail.reconciliation.rows.filter((r) => !r.withinTolerance) },
        },
      );
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(
        `UPDATE cutover_runs SET status = 'done', finished_at = COALESCE(finished_at, now()), signed_off_by = app.current_user_id(), signed_off_at = now(), updated_at = now() WHERE id = $1`,
        [runId],
      );
      await this.audit.stage(ctx, c, {
        action: 'ops.cutover.sign_off',
        entityType: 'cutover_runs',
        entityId: runId,
        after: { reconciliation: detail.reconciliation.rows },
      });
      return this.runDetail(ctx, runId, c);
    });
  }

  // ---- hypercare -------------------------------------------------------------------------------------
  private static readonly ISSUE = `SELECT i.id::text, i.number, i.title, i.detail, i.module, i.severity, i.channel, i.status, i.assigned_role, i.assigned_user::text AS assigned_user_id,
       i.due_at, i.workaround, i.resolution, i.first_response_at, i.closed_at, i.created_at, i.updated_at,
       (i.status NOT IN ('closed', 'verified') AND i.due_at < now()) AS overdue,
       rp.display_name AS reporter, au.display_name AS assigned_to
  FROM hypercare_issues i LEFT JOIN users rp ON rp.id = i.reporter_user LEFT JOIN users au ON au.id = i.assigned_user`;

  private toIssue(x: Row) {
    return {
      id: String(x.id),
      number: String(x.number),
      title: String(x.title),
      detail: (x.detail as string | null) ?? null,
      module: String(x.module),
      severity: String(x.severity),
      channel: String(x.channel),
      status: String(x.status),
      reporter: (x.reporter as string | null) ?? null,
      assignedRole: (x.assigned_role as string | null) ?? null,
      assignedUserId: (x.assigned_user_id as string | null) ?? null,
      assignedTo: (x.assigned_to as string | null) ?? null,
      dueAt: iso(x.due_at)!,
      overdue: Boolean(x.overdue),
      workaround: (x.workaround as string | null) ?? null,
      resolution: (x.resolution as string | null) ?? null,
      firstResponseAt: iso(x.first_response_at),
      closedAt: iso(x.closed_at),
      createdAt: iso(x.created_at)!,
      updatedAt: iso(x.updated_at)!,
    };
  }

  async createIssue(ctx: RequestContext, dto: IssueDto) {
    const hours =
      Number(
        await this.setting(
          ctx,
          `hypercare.sla_${dto.severity}_hours`,
          { s1: 4, s2: 24, s3: 72, s4: 168 }[dto.severity],
        ),
      ) || 72;
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const n = await c.query<{ n: string }>(
        `SELECT lpad((count(*) + 1)::text, 3, '0') AS n FROM hypercare_issues`,
      );
      const r = await c.query<{ id: string }>(
        `INSERT INTO hypercare_issues (school_id, number, title, detail, module, severity, channel, reporter_user, due_at, request_id)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, app.current_user_id(), now() + make_interval(hours => $7), app.current_request_id()) RETURNING id::text`,
        [
          `HC/${n.rows[0]!.n}`,
          dto.title,
          dto.detail ?? null,
          dto.module,
          dto.severity,
          dto.channel,
          hours,
        ],
      );
      const id = r.rows[0]!.id;
      await c.query(
        `INSERT INTO hypercare_updates (school_id, issue_id, author, body, status_to) VALUES (app.current_school_id(), $1, app.current_user_id(), $2, 'open')`,
        [id, dto.detail ?? dto.title],
      );
      await this.audit.stage(ctx, c, {
        action: 'ops.hypercare.report',
        entityType: 'hypercare_issues',
        entityId: id,
        after: { title: dto.title, severity: dto.severity },
      });
      return this.issue(c, id);
    });
  }

  private async issue(c: PoolClient, id: string) {
    // eslint-disable-next-line no-restricted-syntax -- fixed SELECT fragment constant; values are bound parameters
    const r = await c.query<Row>(`${OpsService.ISSUE} WHERE i.id = $1`, [id]);
    if (!r.rows[0]) throw new DomainError('not-found', 'Issue not found', { status: 404 });
    const updates = await c.query<Row>(
      `SELECT u.id::text, u.body, u.status_from, u.status_to, u.created_at, a.display_name AS author FROM hypercare_updates u LEFT JOIN users a ON a.id = u.author WHERE u.issue_id = $1 ORDER BY u.created_at`,
      [id],
    );
    return {
      ...this.toIssue(r.rows[0]),
      updates: updates.rows.map((u) => ({
        id: String(u.id),
        body: (u.body as string | null) ?? null,
        statusFrom: (u.status_from as string | null) ?? null,
        statusTo: (u.status_to as string | null) ?? null,
        author: (u.author as string | null) ?? null,
        createdAt: iso(u.created_at)!,
      })),
    };
  }

  async issues(ctx: RequestContext, q: IssueListDto, mineOnly: boolean) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const where: string[] = [];
      const params: unknown[] = [];
      if (q.status) {
        params.push(q.status);
        where.push(`i.status = $${params.length}`);
      }
      if (q.severity) {
        params.push(q.severity);
        where.push(`i.severity = $${params.length}`);
      }
      if (q.module) {
        params.push(q.module);
        where.push(`i.module = $${params.length}`);
      }
      if (mineOnly || q.mine === 'true') where.push('i.reporter_user = app.current_user_id()');
      // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values bound
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      params.push(q.size, (q.page - 1) * q.size);
      const r = await c.query<Row & { total: string }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed SELECT fragment constant; values are bound parameters
        `${OpsService.ISSUE.replace('SELECT i.id::text', 'SELECT count(*) OVER () AS total, i.id::text')} ${whereSql}
          ORDER BY (i.status IN ('closed', 'verified')), i.severity, i.due_at LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      const summary = await c.query<{ severity: string; open: string; overdue: string }>(
        `SELECT severity, count(*) FILTER (WHERE status NOT IN ('closed', 'verified'))::text AS open,
                count(*) FILTER (WHERE status NOT IN ('closed', 'verified') AND due_at < now())::text AS overdue
           FROM hypercare_issues GROUP BY severity ORDER BY severity`,
      );
      return {
        data: r.rows.map((x) => this.toIssue(x)),
        page: { number: q.page, size: q.size, total: Number(r.rows[0]?.total ?? 0) },
        summary: SEVERITY_ORDER.map((s) => {
          const row = summary.rows.find((x) => x.severity === s);
          return { severity: s, open: Number(row?.open ?? 0), overdue: Number(row?.overdue ?? 0) };
        }),
      };
    });
  }

  async issueDetail(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), (c) => this.issue(c, id));
  }

  async updateIssue(ctx: RequestContext, id: string, dto: IssueUpdateDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await c.query<{ status: string; severity: string }>(
        `SELECT status, severity FROM hypercare_issues WHERE id = $1`,
        [id],
      );
      if (!before.rows[0]) throw new DomainError('not-found', 'Issue not found', { status: 404 });
      const prev = before.rows[0];
      let due: string | null = null;
      if (dto.severity && dto.severity !== prev.severity) {
        const hours =
          Number(await this.setting(ctx, `hypercare.sla_${dto.severity}_hours`, 72)) || 72;
        due = `${hours}`;
      }
      await c.query(
        `UPDATE hypercare_issues SET status = COALESCE($2, status), severity = COALESCE($3, severity),
                assigned_role = COALESCE($4, assigned_role), assigned_user = COALESCE($5::bigint, assigned_user),
                workaround = COALESCE($6, workaround), resolution = COALESCE($7, resolution),
                first_response_at = COALESCE(first_response_at, now()),
                due_at = CASE WHEN $8::int IS NULL THEN due_at ELSE created_at + make_interval(hours => $8::int) END,
                closed_at = CASE WHEN $2 IN ('closed', 'verified') THEN COALESCE(closed_at, now()) WHEN $2 IS NOT NULL THEN NULL ELSE closed_at END,
                updated_at = now()
          WHERE id = $1`,
        [
          id,
          dto.status ?? null,
          dto.severity ?? null,
          dto.assignedRole ?? null,
          dto.assignedUserId ?? null,
          dto.workaround ?? null,
          dto.resolution ?? null,
          due === null ? null : Number(due),
        ],
      );
      if (dto.body || (dto.status && dto.status !== prev.status))
        await c.query(
          `INSERT INTO hypercare_updates (school_id, issue_id, author, body, status_from, status_to) VALUES (app.current_school_id(), $1, app.current_user_id(), $2, $3, $4)`,
          [
            id,
            dto.body ?? null,
            dto.status && dto.status !== prev.status ? prev.status : null,
            dto.status && dto.status !== prev.status ? dto.status : null,
          ],
        );
      await this.audit.stage(ctx, c, {
        action: 'ops.hypercare.update',
        entityType: 'hypercare_issues',
        entityId: id,
        before: prev,
        after: dto as Row,
      });
      return this.issue(c, id);
    });
  }

  // ---- month-end close and period locks ---------------------------------------------------------------
  async locks(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Row>(
        `SELECT l.id::text, l.ledger::text, l.locked_through::text, l.note, l.locked_at, l.released_at, l.release_reason, lb.display_name AS locked_by, rb.display_name AS released_by
           FROM fee_period_locks l LEFT JOIN users lb ON lb.id = l.locked_by LEFT JOIN users rb ON rb.id = l.released_by ORDER BY l.locked_at DESC LIMIT 100`,
      );
      return r.rows.map((x) => ({
        id: String(x.id),
        ledger: (x.ledger as string | null) ?? null,
        lockedThrough: String(x.locked_through),
        note: (x.note as string | null) ?? null,
        lockedAt: iso(x.locked_at)!,
        lockedBy: (x.locked_by as string | null) ?? null,
        releasedAt: iso(x.released_at),
        releasedBy: (x.released_by as string | null) ?? null,
        releaseReason: (x.release_reason as string | null) ?? null,
      }));
    });
  }

  async lock(ctx: RequestContext, dto: LockDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO fee_period_locks (school_id, ledger, locked_through, note, locked_by) VALUES (app.current_school_id(), $1::ledger_type, $2::date, $3, app.current_user_id()) RETURNING id::text`,
        [dto.ledger ?? null, dto.lockedThrough, dto.note ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: 'fees.period.lock',
        entityType: 'fee_period_locks',
        entityId: r.rows[0]!.id,
        after: { ...dto },
      });
      return { id: r.rows[0]!.id, lockedThrough: dto.lockedThrough, ledger: dto.ledger ?? null };
    });
  }

  private monthBounds(month: string) {
    const start = `${month}-01`;
    const d = new Date(`${start}T00:00:00Z`);
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
      .toISOString()
      .slice(0, 10);
    return { start, end };
  }

  /** The checks of a month: what the accounts office must clear before closing. */
  async monthEnd(ctx: RequestContext, month: string) {
    const { start, end } = this.monthBounds(month);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const receipts = await c.query<Row>(
        `SELECT ledger::text, mode::text, count(*)::int AS n, COALESCE(sum(amount), 0)::text AS amount FROM fee_payments
          WHERE received_on BETWEEN $1::date AND $2::date AND status <> 'reversed' GROUP BY ledger, mode ORDER BY ledger, mode`,
        [start, end],
      );
      const one = async <T extends Record<string, unknown> = Row>(
        sql: string,
        values: unknown[] = [],
      ) => (await c.query<T>(sql, values)).rows[0]!;
      const totals = await one<{
        n: number;
        amount: string;
        reversed: number;
        misc_n: number;
        misc_amount: string;
      }>(
        `SELECT (SELECT count(*) FROM fee_payments WHERE received_on BETWEEN $1::date AND $2::date AND status <> 'reversed')::int AS n,
                (SELECT COALESCE(sum(amount), 0) FROM fee_payments WHERE received_on BETWEEN $1::date AND $2::date AND status <> 'reversed')::text AS amount,
                (SELECT count(*) FROM fee_payments WHERE received_on BETWEEN $1::date AND $2::date AND status = 'reversed')::int AS reversed,
                (SELECT count(*) FROM misc_receipts WHERE received_on BETWEEN $1::date AND $2::date AND status <> 'reversed')::int AS misc_n,
                (SELECT COALESCE(sum(amount), 0) FROM misc_receipts WHERE received_on BETWEEN $1::date AND $2::date AND status <> 'reversed')::text AS misc_amount`,
        [start, end],
      );
      const bank = await one<{ unmatched: number }>(
        `SELECT count(*)::int AS unmatched FROM bank_statement_lines WHERE txn_date BETWEEN $1::date AND $2::date AND credit > 0 AND payment_id IS NULL AND misc_receipt_id IS NULL AND status::text NOT IN ('ignored', 'matched')`,
        [start, end],
      ).catch(() => ({ unmatched: 0 }));
      const settlements = await one<{ unmatched: number; mismatched: number }>(
        `SELECT COALESCE(sum(unmatched), 0)::int AS unmatched, COALESCE(sum(mismatched), 0)::int AS mismatched FROM payment_settlements WHERE settled_on BETWEEN $1::date AND $2::date`,
        [start, end],
      );
      const unsettled = await one<{ n: number }>(
        `SELECT count(*)::int AS n FROM fee_payments WHERE received_on BETWEEN $1::date AND $2::date AND mode::text = 'online' AND settlement_line_id IS NULL AND status <> 'reversed'`,
        [start, end],
      );
      const variances = await one<{ n: number }>(
        `SELECT count(*)::int AS n FROM shadow_variances WHERE status::text = 'open'`,
      ).catch(() => ({ n: 0 }));
      const adjustments = await one<{ n: number }>(
        `SELECT count(*)::int AS n FROM fee_adjustments WHERE status::text = 'pending'`,
      ).catch(() => ({ n: 0 }));
      const uncleared = await one<{ n: number }>(
        `SELECT count(*)::int AS n FROM fee_payments WHERE received_on BETWEEN $1::date AND $2::date AND mode::text = 'cheque' AND cleared_on IS NULL AND status <> 'reversed'`,
        [start, end],
      );
      const lockedThrough = await one<{ d: string | null }>(
        `SELECT app.fee_locked_through('school')::text AS d`,
      );
      const close = await c.query<Row>(
        `SELECT m.status, m.checks, m.pack_export_ids, m.closed_at, m.note, cb.display_name AS closed_by FROM fee_month_closes m LEFT JOIN users cb ON cb.id = m.closed_by WHERE m.month = $1::date`,
        [start],
      );
      const checks = [
        {
          code: 'receipts',
          label: 'Receipts of the month',
          value: `${totals.n} · ₹${Number(totals.amount).toFixed(2)}`,
          ok: true,
        },
        {
          code: 'misc',
          label: 'Misc receipts',
          value: `${totals.misc_n} · ₹${Number(totals.misc_amount).toFixed(2)}`,
          ok: true,
        },
        {
          code: 'reversed',
          label: 'Reversed receipts (never in the day book)',
          value: String(totals.reversed),
          ok: true,
        },
        {
          code: 'cheques',
          label: 'Cheques not yet cleared',
          value: String(uncleared.n),
          ok: uncleared.n === 0,
          blocking: false,
        },
        {
          code: 'bank',
          label: 'Bank statement credits unmatched',
          value: String(bank.unmatched),
          ok: bank.unmatched === 0,
          blocking: true,
        },
        {
          code: 'settlements',
          label: 'Settlement lines unmatched or mismatched',
          value: `${settlements.unmatched} / ${settlements.mismatched}`,
          ok: settlements.unmatched + settlements.mismatched === 0,
          blocking: true,
        },
        {
          code: 'unsettled',
          label: 'Online receipts without a settlement line',
          value: String(unsettled.n),
          ok: unsettled.n === 0,
          blocking: false,
        },
        {
          code: 'variances',
          label: 'Open shadow variances',
          value: String(variances.n),
          ok: variances.n === 0,
          blocking: true,
        },
        {
          code: 'adjustments',
          label: 'Adjustment requests pending',
          value: String(adjustments.n),
          ok: adjustments.n === 0,
          blocking: true,
        },
      ];
      return {
        month,
        start,
        end,
        byLedgerAndMode: receipts.rows.map((r) => ({
          ledger: String(r.ledger),
          mode: String(r.mode),
          count: Number(r.n),
          amount: String(r.amount),
        })),
        checks,
        blocking: checks.filter((k) => k.blocking && !k.ok).map((k) => k.code),
        lockedThrough: lockedThrough.d,
        close: close.rows[0]
          ? {
              status: String(close.rows[0].status),
              closedAt: iso(close.rows[0].closed_at),
              closedBy: (close.rows[0].closed_by as string | null) ?? null,
              note: (close.rows[0].note as string | null) ?? null,
              packExportIds: ((close.rows[0].pack_export_ids as string[] | number[]) ?? []).map(
                String,
              ),
            }
          : { status: 'open', closedAt: null, closedBy: null, note: null, packExportIds: [] },
      };
    });
  }

  async closeMonth(ctx: RequestContext, month: string, dto: CloseMonthDto) {
    const state = await this.monthEnd(ctx, month);
    if (state.close.status === 'closed')
      throw new DomainError('conflict', 'The month is already closed', { status: 409 });
    if (state.blocking.length)
      throw new DomainError(
        'fees.month_end_blocked',
        `Clear these checks first: ${state.blocking.join(', ')}`,
        { status: 409, extra: { blocking: state.blocking } },
      );
    const packIds: string[] = [];
    if (dto.pack) {
      const yearId = requireTenant(ctx).academicYearId ?? undefined;
      for (const [dataset, format] of [
        ['fee_day_book', 'pdf'],
        ['fee_head_tally', 'xlsx'],
        ['fee_tally_vouchers', 'xml'],
        ['fee_defaulters', 'xlsx'],
      ] as const) {
        const exp = await this.reports
          .create(
            ctx,
            {
              dataset,
              format,
              params: { from: state.start, to: state.end, academicYearId: yearId },
              title: `Month-end ${month} · ${dataset}`,
            },
            'fees.month_end.pack',
          )
          .catch(() => null);
        if (exp) packIds.push(exp.id);
      }
    }
    await this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(
        `INSERT INTO fee_period_locks (school_id, ledger, locked_through, note, locked_by) VALUES (app.current_school_id(), NULL, $1::date, $2, app.current_user_id())`,
        [state.end, `Month-end close ${month}`],
      );
      await c.query(
        `INSERT INTO fee_month_closes (school_id, month, status, checks, pack_export_ids, closed_by, closed_at, note)
         VALUES (app.current_school_id(), $1::date, 'closed', $2::jsonb, $3::bigint[], app.current_user_id(), now(), $4)
         ON CONFLICT (school_id, month) DO UPDATE SET status = 'closed', checks = EXCLUDED.checks, pack_export_ids = EXCLUDED.pack_export_ids, closed_by = EXCLUDED.closed_by, closed_at = now(), note = EXCLUDED.note, reopened_at = NULL, reopened_by = NULL, updated_at = now()`,
        [state.start, JSON.stringify(state.checks), packIds, dto.note ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: 'fees.month_end.close',
        entityType: 'fee_month_closes',
        entityId: month,
        after: { checks: state.checks, packIds },
      });
    });
    return this.monthEnd(ctx, month);
  }

  async reopenMonth(ctx: RequestContext, month: string, dto: ReopenMonthDto) {
    const { start, end } = this.monthBounds(month);
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `UPDATE fee_month_closes SET status = 'open', reopened_by = app.current_user_id(), reopened_at = now(), note = $2, updated_at = now() WHERE month = $1::date AND status = 'closed'`,
        [start, dto.reason],
      );
      if (!r.rowCount)
        throw new DomainError('conflict', 'The month is not closed', { status: 409 });
      await c.query(
        `UPDATE fee_period_locks SET released_at = now(), released_by = app.current_user_id(), release_reason = $2 WHERE released_at IS NULL AND ledger IS NULL AND locked_through = $1::date`,
        [end, dto.reason],
      );
      await this.audit.stage(ctx, c, {
        action: 'fees.month_end.reopen',
        entityType: 'fee_month_closes',
        entityId: month,
        after: { reason: dto.reason },
      });
    });
    return this.monthEnd(ctx, month);
  }
}

/** Shared guard for the receipt paths: refuses a received_on on or before the active lock. */
export async function assertPeriodOpen(
  c: PoolClient,
  ledger: string,
  receivedOn: string | null,
): Promise<void> {
  const r = await c.query<{ d: string | null }>(
    `SELECT app.fee_locked_through($1::ledger_type)::text AS d`,
    [ledger],
  );
  const locked = r.rows[0]?.d;
  if (!locked) return;
  const on = receivedOn ?? new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  if (on <= locked)
    throw new DomainError(
      'fees.period_locked',
      `The fee period is closed through ${locked}; receipts dated on or before it cannot be posted`,
      {
        status: 409,
        extra: { lockedThrough: locked },
      },
    );
}
