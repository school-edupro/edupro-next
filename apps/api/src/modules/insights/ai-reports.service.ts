import { Inject, Injectable } from '@nestjs/common';
import { providerFromEnv, writeNarrative, type AiProvider } from '@edupro/ai';
import {
  collectReportFacts,
  REPORT_DEPARTMENTS,
  type ReportDepartment,
  type ReportFact,
} from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ENV, type Env } from '../../config/env';
import { ReportsService } from '../reports/reports.service';

export interface AiReportRow {
  id: string;
  kind: 'principal_brief' | 'department_weekly';
  department: string | null;
  periodFrom: string;
  periodTo: string;
  language: string;
  title: string;
  narrative: string;
  facts: ReportFact[];
  citations: string[];
  provider: string;
  model: string;
  costPaise: number;
  exportId: string | null;
  exportStatus: string | null;
  createdAt: string;
}

export interface RunReportInput {
  kind: 'principal_brief' | 'department_weekly';
  department?: ReportDepartment;
  /** Last day of the period (default: last Sunday IST); the period is the seven days ending there. */
  periodTo?: string;
  language?: 'en' | 'hi';
}

const ist = () => new Date(Date.now() + 5.5 * 3600 * 1000);
const iso = (d: Date) => d.toISOString().slice(0, 10);
export const lastSunday = (): string => {
  const d = ist();
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 7) % 7 || 7));
  return iso(d);
};
export const shiftDate = (d: string, days: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + days);
  return iso(x);
};
export const periodLabel = (from: string, to: string) => `${from} to ${to}`;
export const reportTitle = (
  kind: RunReportInput['kind'],
  department?: string,
  language: 'en' | 'hi' = 'en',
) => {
  if (kind === 'principal_brief')
    return language === 'hi' ? 'प्रधानाचार्य का सोमवार सार' : "Principal's Monday brief";
  const names: Record<string, [string, string]> = {
    academics: ['Academics weekly', 'शैक्षणिक साप्ताहिक'],
    attendance: ['Attendance weekly', 'उपस्थिति साप्ताहिक'],
    fees: ['Fees weekly', 'शुल्क साप्ताहिक'],
    communication: ['Communication weekly', 'संचार साप्ताहिक'],
  };
  const n = names[department ?? ''] ?? [`${department} weekly`, `${department} साप्ताहिक`];
  return language === 'hi' ? n[1] : n[0];
};

/**
 * Sprint 16 (AI track): AI reports v1 on demand. The weekly job in the workers does the same steps on
 * Mondays and adds the WhatsApp summary; this service serves the pages and the "run now" button.
 */
@Injectable()
export class AiReportsService {
  private readonly provider: AiProvider;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly reports: ReportsService,
  ) {
    this.provider = providerFromEnv({
      AI_PROVIDER: env.AI_PROVIDER,
      AI_MODEL: env.AI_MODEL,
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
      ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
      NODE_ENV: env.NODE_ENV,
    });
  }

  async run(ctx: RequestContext, input: RunReportInput): Promise<AiReportRow> {
    const tenant = requireTenant(ctx);
    if (
      input.kind === 'department_weekly' &&
      !REPORT_DEPARTMENTS.includes(input.department as ReportDepartment)
    )
      throw new DomainError('validation-failed', 'department is required for a weekly report', {
        status: 400,
      });
    const to = input.periodTo ?? lastSunday();
    const from = shiftDate(to, -6);
    const language = input.language ?? 'en';
    const id = await this.db.tenant(tenant, async (c) => {
      const school = await c.query<{ name: string }>(
        `SELECT name FROM schools WHERE id = app.current_school_id()`,
      );
      const facts = await collectReportFacts(c, {
        kind: input.kind,
        department: input.department,
        from,
        to,
      });
      const title = reportTitle(input.kind, input.department, language);
      const out = await writeNarrative(this.provider, {
        title,
        period: periodLabel(from, to),
        school: school.rows[0]?.name ?? '',
        audience: input.kind === 'principal_brief' ? 'principal' : 'department',
        facts,
        language,
      });
      if (out.unknownCitations.length)
        throw new DomainError(
          'ai.report_uncited',
          'The narrative cited facts that do not exist; not published',
          {
            status: 502,
            extra: { unknown: out.unknownCitations },
          },
        );
      const r = await c.query<{ id: string }>(
        `INSERT INTO ai_reports (school_id, kind, department, period_from, period_to, language, title, narrative, facts, citations, provider, model, cost_paise, requested_by)
         VALUES (app.current_school_id(), $1, $2, $3::date, $4::date, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, app.current_user_id())
         ON CONFLICT (school_id, kind, COALESCE(department, ''), period_to) DO UPDATE
           SET narrative = EXCLUDED.narrative, facts = EXCLUDED.facts, citations = EXCLUDED.citations, provider = EXCLUDED.provider, model = EXCLUDED.model,
               cost_paise = EXCLUDED.cost_paise, language = EXCLUDED.language, title = EXCLUDED.title, requested_by = app.current_user_id(), created_at = now()
         RETURNING id::text`,
        [
          input.kind,
          input.department ?? null,
          from,
          to,
          language,
          title,
          out.narrative,
          JSON.stringify(facts),
          JSON.stringify(out.citations),
          out.provider,
          out.model,
          out.costPaise,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'insights.report.run',
        entityType: 'ai_reports',
        entityId: r.rows[0]!.id,
        after: {
          kind: input.kind,
          department: input.department ?? null,
          from,
          to,
          facts: facts.length,
          citations: out.citations.length,
          provider: out.provider,
        },
      });
      return r.rows[0]!.id;
    });
    // the PDF goes through the export service like every other document
    const exp = await this.reports.create(
      ctx,
      {
        dataset: 'ai_report',
        format: 'pdf',
        params: { reportId: id },
        title: reportTitle(input.kind, input.department, language),
      },
      'insights.report.export',
    );
    await this.db.tenant(tenant, (c) =>
      c.query(`UPDATE ai_reports SET export_id = $2 WHERE id = $1`, [id, exp.id]),
    );
    return this.get(ctx, id);
  }

  async list(ctx: RequestContext, days = 400): Promise<AiReportRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `SELECT a.*, e.status::text AS export_status FROM ai_reports a LEFT JOIN exports e ON e.id = a.export_id
          WHERE a.period_to >= CURRENT_DATE - $1::int ORDER BY a.period_to DESC, a.kind, a.department NULLS FIRST`,
        [days],
      );
      return r.rows.map((x) => toRow(x, false));
    });
  }

  async get(ctx: RequestContext, id: string): Promise<AiReportRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `SELECT a.*, e.status::text AS export_status FROM ai_reports a LEFT JOIN exports e ON e.id = a.export_id WHERE a.id = $1`,
        [id],
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'Report not found', { status: 404 });
      return toRow(r.rows[0], true);
    });
  }
}

function toRow(x: Record<string, unknown>, full: boolean): AiReportRow {
  const d = (v: unknown) =>
    v instanceof Date
      ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
      : String(v);
  return {
    id: String(x.id),
    kind: x.kind as AiReportRow['kind'],
    department: (x.department as string | null) ?? null,
    periodFrom: d(x.period_from),
    periodTo: d(x.period_to),
    language: String(x.language),
    title: String(x.title),
    narrative: full ? String(x.narrative) : String(x.narrative).split('\n').slice(0, 3).join('\n'),
    facts: full ? ((x.facts as ReportFact[]) ?? []) : [],
    citations: (x.citations as string[]) ?? [],
    provider: String(x.provider),
    model: String(x.model),
    costPaise: Number(x.cost_paise),
    exportId: x.export_id === null || x.export_id === undefined ? null : String(x.export_id),
    exportStatus: (x.export_status as string | null) ?? null,
    createdAt: (x.created_at as Date).toISOString(),
  };
}
