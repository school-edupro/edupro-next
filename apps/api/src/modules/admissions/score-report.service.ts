import { Injectable } from '@nestjs/common';
import { ADMISSION_STATUS_BY_CODE, type PointLine, type PoolClient } from '@edupro/db';
import ExcelJS from 'exceljs';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { AdmissionCoreService } from './admission-core.service';
import { scoreReportPdf } from './admission-pdf';
import { meritOrder } from './merit-order';
import { classPointRules, classPointsMax } from './points-rules';
import type { ScoreReportQueryDto } from './scores.dto';

const LIVE = `a.status::text NOT IN ('draft', 'cancelled', 'withdrawn')`;
const ist = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);

/**
 * The score report (docs/design/48, part 4): a row per registration of a session's class with each
 * criterion's points, the form points, the test / interview marks, the total and the rank (the merit
 * order of docs/design/40); and Recalculate (part 3) for registrations not yet confirmed.
 */
@Injectable()
export class AdmissionScoreReportService {
  constructor(
    private readonly db: DbService,
    private readonly core: AdmissionCoreService,
    private readonly audit: AuditService,
  ) {}

  private async reportWith(c: PoolClient, q: ScoreReportQueryDto) {
    const line = await c.query<{
      session: string;
      class_name: string;
      merit_seed: string | null;
    }>(
      `SELECT y.name AS session, cl.name AS class_name, k.merit_seed
         FROM admission_class_criteria k JOIN admission_cycles y ON y.id = k.cycle_id JOIN classes cl ON cl.id = k.class_id
        WHERE k.cycle_id = $1 AND k.class_id = $2 AND y.deleted_at IS NULL`,
      [q.cycleId, q.classId],
    );
    if (!line.rows[0])
      throw new DomainError('not-found', 'The class is not in that session', { status: 404 });
    const rules = await classPointRules(c, q.cycleId, q.classId);
    // a column per level of the class's process (docs/design/50): the decision, remark, who
    const proc = await c.query<{
      steps: Array<{ stageId: string; levels: Array<{ name: string }> }>;
    }>(
      `SELECT p.steps FROM admission_process_classes pc JOIN admission_processes p ON p.id = pc.process_id
        WHERE pc.class_id = $1 AND p.status = 'active' LIMIT 1`,
      [q.classId],
    );
    const stageNames = new Map(
      (
        await c.query<{ id: string; name: string }>(`SELECT id::text, name FROM admission_stages`)
      ).rows.map((x) => [x.id, x.name]),
    );
    const levelCols = (proc.rows[0]?.steps ?? []).flatMap((st) =>
      st.levels.map((l, i) => ({
        key: `${st.stageId}:${String(i + 1)}`,
        label: `${stageNames.get(st.stageId) ?? 'Stage'} · ${l.name}`,
      })),
    );
    const max = await classPointsMax(c, q.cycleId, q.classId);
    const r = await c.query<{
      id: string;
      number: string | null;
      candidate: string | null;
      category: string | null;
      status: string;
      dob: Date | null;
      form_points: string | null;
      merit: string | null;
      lines: PointLine[] | null;
      confirmed: boolean;
    }>(
      `SELECT a.id::text, a.application_no AS number, a.candidate_name AS candidate, k.name AS category, a.status::text,
              a.child_dob AS dob, a.form_points::text, a.merit::text, a.points_breakdown AS lines,
              a.points_confirmed_at IS NOT NULL AS confirmed
         FROM applications a LEFT JOIN admission_fee_categories k ON k.id = a.category_id
        WHERE a.cycle_id = $1 AND a.class_id = $2 AND a.form_id IS NOT NULL AND a.status::text <> 'draft'
          AND ($3::bigint IS NULL OR a.category_id = $3) AND ($4::text IS NULL OR a.status::text = $4)
        ORDER BY a.id`,
      [q.cycleId, q.classId, q.categoryId ?? null, q.status ?? null],
    );
    const decided = await c.query<{
      id: string;
      k: string;
      decision: string;
      remarks: string | null;
      by: string | null;
      at: Date;
    }>(
      `SELECT DISTINCT ON (x.application_id, x.stage_id, x.level) x.application_id::text AS id,
              x.stage_id::text || ':' || x.level AS k, x.decision, x.remarks, x.decided_by_name AS by, x.decided_at AS at
         FROM admission_stage_results x
        WHERE x.application_id = ANY($1::bigint[]) AND x.undone_at IS NULL
        ORDER BY x.application_id, x.stage_id, x.level, x.decided_at DESC`,
      [r.rows.map((x) => x.id)],
    );
    const remarkOf = (id: string, k: string) => {
      const d = decided.rows.find((x) => x.id === id && x.k === k);
      return d
        ? `${d.decision}${d.remarks ? `: ${d.remarks}` : ''} (${d.by ?? '-'}, ${d.at.toISOString().slice(8, 10)}-${d.at.toISOString().slice(5, 7)})`
        : null;
    };
    const rows = r.rows.map((x) => {
      const lines = x.lines ?? [];
      const points = x.form_points !== null ? Number(x.form_points) : null;
      const merit = x.merit !== null ? Number(x.merit) : null;
      return {
        id: x.id,
        number: x.number,
        candidate: x.candidate,
        category: x.category,
        status: ADMISSION_STATUS_BY_CODE[x.status] ?? x.status,
        live: !['cancelled', 'withdrawn', 'rejected'].includes(x.status),
        dob: x.dob ? x.dob.toISOString().slice(0, 10) : null,
        lines: rules.map((k) => {
          const l = lines.find((y) => y.name === k.name);
          return l ? { points: l.points, max: l.max, check: l.check ?? null } : null;
        }),
        points,
        marks: merit !== null ? Math.round((merit - (points ?? 0)) * 100) / 100 : null,
        merit,
        confirmed: x.confirmed,
        check: lines.some((l) => Boolean(l.check)),
        remarks: levelCols.map((col) => remarkOf(x.id, col.key)),
      };
    });
    // the rank among the live ones, as Selection orders them
    const ranked = meritOrder(
      rows.filter((x) => x.live).map((x) => ({ ...x, number: x.number })),
      line.rows[0].merit_seed,
    );
    const rank = new Map(ranked.order.map((x) => [x.id, x.rank]));
    const all = rows
      .map((x) => ({ ...x, rank: rank.get(x.id) ?? null }))
      .filter((x) => !q.check || x.check)
      .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || Number(a.id) - Number(b.id));
    return {
      session: line.rows[0].session,
      className: line.rows[0].class_name,
      max,
      levels: levelCols.map((x) => x.label),
      criteria: rules.map((k) => ({
        name: k.name,
        kind: k.kind,
        cap: k.cap,
        points: k.points,
      })),
      rows: all,
    };
  }

  async report(ctx: RequestContext, q: ScoreReportQueryDto) {
    return this.db.tenant(requireTenant(ctx), (c) => this.reportWith(c, q));
  }

  async xlsx(ctx: RequestContext, q: ScoreReportQueryDto) {
    const rep = await this.report(ctx, q);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Score report');
    ws.addRow([`Score report: ${rep.className} · ${rep.session}`]).font = { bold: true };
    ws.addRow([`${String(rep.rows.length)} registrations · printed ${ist(new Date())}`]);
    ws.addRow([]);
    const head = [
      'Rank',
      'Registration no.',
      'Candidate',
      'Category',
      'Status',
      ...rep.criteria.map((k) => k.name),
      'Form points',
      'Marks',
      'Total',
      'To check',
      ...rep.levels,
    ];
    const h = ws.addRow(head);
    h.font = { bold: true };
    head.forEach((_, i) => (ws.getColumn(i + 1).width = i === 2 ? 26 : i === 1 ? 22 : 14));
    for (const x of rep.rows)
      ws.addRow([
        x.rank ?? '',
        x.number ?? '',
        x.candidate ?? '',
        x.category ?? '',
        x.status,
        ...x.lines.map((l) => (l ? l.points : '')),
        x.points ?? '',
        x.marks ?? '',
        x.merit ?? '',
        x.lines
          .map((l) => l?.check)
          .filter(Boolean)
          .join('; '),
        ...x.remarks.map((m) => m ?? ''),
      ]);
    const bytes = Buffer.from(await wb.xlsx.writeBuffer());
    return {
      bytes,
      filename: `score-report-${rep.className.replace(/[^A-Za-z0-9]+/g, '-')}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  async pdf(ctx: RequestContext, q: ScoreReportQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const rep = await this.reportWith(c, q);
      const school = await c.query<{
        name: string;
        address: string | null;
        contact: string | null;
        logo: string | null;
      }>(
        `SELECT name, NULLIF(concat_ws(', ', NULLIF(btrim(address->>'line1'), ''), NULLIF(btrim(address->>'city'), ''), NULLIF(btrim(address->>'state'), '')), '') AS address,
                NULLIF(btrim(contact->>'phone'), '') AS contact, NULLIF(branding->>'logoFileId', '') AS logo
           FROM schools WHERE id = app.current_school_id()`,
      );
      const sc = school.rows[0]!;
      const n = (v: number | null) => (v === null ? '-' : String(v));
      const bytes = await scoreReportPdf({
        school: {
          name: sc.name,
          address: sc.address,
          contact: sc.contact ? `Phone ${sc.contact}` : null,
        },
        logo: await this.core.fileBytes(c, sc.logo),
        title: `Score report: ${rep.className}`,
        subtitle: `${rep.session} · ${String(rep.rows.length)} registrations${rep.max ? ` · points out of ${String(rep.max)}` : ''}`,
        criteria: rep.criteria.map((k) => k.name),
        rows: rep.rows.map((x) => ({
          rank: x.rank !== null ? String(x.rank) : '-',
          number: x.number ?? '',
          candidate: x.candidate ?? '',
          lines: x.lines.map((l) => (l ? String(l.points) : '-')),
          points: n(x.points),
          marks: n(x.marks),
          total: n(x.merit),
          check: x.check,
          note: rep.levels
            .map((l, i) => (x.remarks[i] ? `${l}: ${x.remarks[i]!}` : null))
            .filter(Boolean)
            .join('  |  '),
        })),
        printedAt: ist(new Date()),
      });
      return {
        bytes,
        filename: `score-report-${rep.className.replace(/[^A-Za-z0-9]+/g, '-')}.pdf`,
        contentType: 'application/pdf',
      };
    });
  }

  /**
   * Recalculate (docs/design/48, part 3): the points of a session's registrations (one class, or
   * every class) worked out again from the answers and today's tables; those the office confirmed at
   * Document check stay. Says how many were looked at and how many changed.
   */
  async recalculate(ctx: RequestContext, cycleId: string, classId?: string) {
    if (!/^\d{1,18}$/.test(cycleId))
      throw new DomainError('not-found', 'Admission session not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string; before: string | null }>(
        // eslint-disable-next-line no-restricted-syntax -- LIVE is a fixed fragment
        `SELECT a.id::text, a.form_points::text AS before FROM applications a
          WHERE a.cycle_id = $1 AND ($2::bigint IS NULL OR a.class_id = $2) AND a.form_id IS NOT NULL
            AND ${LIVE} AND a.status::text <> 'admitted' AND a.points_confirmed_at IS NULL ORDER BY a.id`,
        [cycleId, classId ?? null],
      );
      let changed = 0;
      for (const a of r.rows) {
        await this.core.refreshPoints(c, a.id);
        const after = await c.query<{ p: string | null }>(
          `SELECT form_points::text AS p FROM applications WHERE id = $1`,
          [a.id],
        );
        if (Number(after.rows[0]?.p ?? 0) !== Number(a.before ?? 0)) changed += 1;
      }
      await this.audit.stage(ctx, c, {
        action: 'admissions.points.recalculate',
        entityType: 'admission_cycles',
        entityId: cycleId,
        after: { classId: classId ?? null, recalculated: r.rows.length, changed },
      });
      return { recalculated: r.rows.length, changed };
    });
  }
}
