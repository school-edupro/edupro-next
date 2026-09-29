import { Injectable } from '@nestjs/common';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';

export interface ResultsAnalytics {
  exams: Array<{
    id: string;
    code: string;
    name: string;
    pupils: number;
    complete: number;
    passPct: number | null;
    meanPct: number | null;
  }>;
  byClass: Array<{
    examCode: string;
    classCode: string;
    section: string | null;
    pupils: number;
    complete: number;
    pass: number;
    fail: number;
    passPct: number | null;
    meanPct: number | null;
  }>;
  weakestSubjects: Array<{
    examCode: string;
    classCode: string;
    subject: string;
    entered: number;
    passPct: number | null;
    mean: number | null;
  }>;
}

/**
 * Sprint 18 (AI track S17-19): results analytics for the principal from mart.exam_results (refreshed
 * hourly) and the subject view from exam_results joined to mark entries.
 */
@Injectable()
export class ResultsAnalyticsService {
  constructor(private readonly db: DbService) {}

  async summary(ctx: RequestContext, examId: string | null): Promise<ResultsAnalytics> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const exams = await c.query<Record<string, unknown>>(
        `SELECT e.id::text, e.code, e.name,
                COALESCE(sum(m.pupils) FILTER (WHERE m.class_section_id IS NULL), 0)::int AS pupils,
                COALESCE(sum(m.complete) FILTER (WHERE m.class_section_id IS NULL), 0)::int AS complete,
                CASE WHEN sum(m.complete) FILTER (WHERE m.class_section_id IS NULL) > 0
                     THEN round(100.0 * sum(m.pass) FILTER (WHERE m.class_section_id IS NULL) / sum(m.complete) FILTER (WHERE m.class_section_id IS NULL), 1) END AS pass_pct,
                CASE WHEN sum(m.complete) FILTER (WHERE m.class_section_id IS NULL) > 0
                     THEN round(sum(m.mean_pct * m.complete) FILTER (WHERE m.class_section_id IS NULL) / sum(m.complete) FILTER (WHERE m.class_section_id IS NULL), 1) END AS mean_pct
           FROM exams e LEFT JOIN mart.exam_results m ON m.exam_id = e.id
          WHERE e.academic_year_id = app.current_academic_year_id() AND e.deleted_at IS NULL
          GROUP BY e.id, e.code, e.name, e.starts_on ORDER BY e.starts_on NULLS LAST, e.code`,
      );
      const byClass = await c.query<Record<string, unknown>>(
        `SELECT m.exam_code, m.class_code, m.section, m.pupils, m.complete, m.pass, m.fail, m.pass_pct, m.mean_pct
           FROM mart.exam_results m
          WHERE m.academic_year_id = app.current_academic_year_id() AND ($1::bigint IS NULL OR m.exam_id = $1::bigint)
          ORDER BY m.exam_code, m.class_code, m.section NULLS FIRST`,
        [examId],
      );
      const weakest = await c.query<Record<string, unknown>>(
        `SELECT e.code AS exam_code, k.code AS class_code, sub.name AS subject,
                count(m.id) FILTER (WHERE NOT m.exempt)::int AS entered,
                CASE WHEN count(m.id) FILTER (WHERE NOT m.exempt) > 0
                     THEN round(100.0 * count(*) FILTER (WHERE NOT m.exempt AND NOT m.absent AND m.marks >= COALESCE(es.pass_marks, 0)) / count(m.id) FILTER (WHERE NOT m.exempt), 1) END AS pass_pct,
                round(avg(m.marks) FILTER (WHERE NOT m.exempt AND NOT m.absent) / es.max_marks * 100, 1) AS mean
           FROM exam_subjects es JOIN exams e ON e.id = es.exam_id JOIN classes k ON k.id = es.class_id JOIN subjects sub ON sub.id = es.subject_id
           LEFT JOIN mark_entries m ON m.exam_subject_id = es.id
          WHERE e.academic_year_id = app.current_academic_year_id() AND e.deleted_at IS NULL AND ($1::bigint IS NULL OR e.id = $1::bigint)
          GROUP BY e.code, k.code, sub.name, es.max_marks HAVING count(m.id) FILTER (WHERE NOT m.exempt) > 0
          ORDER BY pass_pct NULLS LAST, mean NULLS LAST LIMIT 10`,
        [examId],
      );
      const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
      return {
        exams: exams.rows.map((x) => ({
          id: String(x.id),
          code: String(x.code),
          name: String(x.name),
          pupils: Number(x.pupils),
          complete: Number(x.complete),
          passPct: n(x.pass_pct),
          meanPct: n(x.mean_pct),
        })),
        byClass: byClass.rows.map((x) => ({
          examCode: String(x.exam_code),
          classCode: String(x.class_code),
          section: (x.section as string | null) ?? null,
          pupils: Number(x.pupils),
          complete: Number(x.complete),
          pass: Number(x.pass),
          fail: Number(x.fail),
          passPct: n(x.pass_pct),
          meanPct: n(x.mean_pct),
        })),
        weakestSubjects: weakest.rows.map((x) => ({
          examCode: String(x.exam_code),
          classCode: String(x.class_code),
          subject: String(x.subject),
          entered: Number(x.entered),
          passPct: n(x.pass_pct),
          mean: n(x.mean),
        })),
      };
    });
  }
}
