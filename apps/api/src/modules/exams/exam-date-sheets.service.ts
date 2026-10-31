import { Injectable } from '@nestjs/common';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';
import { EXAMS } from './exams.dto';
import { REPORT_CARDS } from './report-cards.dto';

export interface Paper {
  subject: string;
  examOn: string;
  startsAt: string | null;
  endsAt: string | null;
}
export interface DateSheet {
  id: string;
  code: string;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  note: string | null;
  classes: Array<{ classId: string; classCode: string; papers: Paper[] }>;
}
interface Raw {
  id: string;
  code: string;
  name: string;
  starts_on: string | null;
  ends_on: string | null;
  note: string | null;
  class_id: string;
  class_code: string;
  subject: string;
  exam_on: string;
  starts_at: string | null;
  ends_at: string | null;
}

/** Papers grouped by exam (in the order of their first paper), then class. */
function group(rows: Raw[]): DateSheet[] {
  const exams = new Map<string, DateSheet>();
  for (const r of rows) {
    const e =
      exams.get(r.id) ??
      ({
        id: r.id,
        code: r.code,
        name: r.name,
        startsOn: r.starts_on,
        endsOn: r.ends_on,
        note: r.note,
        classes: [],
      } satisfies DateSheet);
    exams.set(r.id, e);
    let k = e.classes.find((x) => x.classId === r.class_id);
    if (!k) {
      k = { classId: r.class_id, classCode: r.class_code, papers: [] };
      e.classes.push(k);
    }
    k.papers.push({
      subject: r.subject,
      examOn: r.exam_on,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
    });
  }
  return [...exams.values()];
}

const PAPERS = `
  SELECT e.id::text, e.code, e.name, e.starts_on::text, e.ends_on::text, e.date_sheet_note AS note,
         es.class_id::text, k.code AS class_code, sub.name AS subject, es.exam_on::text,
         to_char(es.starts_at, 'HH24:MI') AS starts_at, to_char(es.ends_at, 'HH24:MI') AS ends_at
    FROM exams e
    JOIN exam_subjects es ON es.exam_id = e.id AND es.exam_on IS NOT NULL
    JOIN subjects sub ON sub.id = es.subject_id
    JOIN classes k ON k.id = es.class_id
   WHERE e.academic_year_id = $1 AND e.deleted_at IS NULL AND e.status = 'active'`;
const ORDER = `ORDER BY min(es.exam_on) OVER (PARTITION BY e.id), e.id, k.display_order, es.exam_on, es.starts_at NULLS LAST, app.subject_seq(es.class_id, e.academic_year_id, es.subject_id), sub.code`;

/**
 * Date sheets in the apps (docs/design/66): staff read the papers of the classes they may read marks
 * of (every exam of the working year); a family reads each child's papers of the exams shown on the
 * portal, leaving out a subject the child does not take.
 */
@Injectable()
export class ExamDateSheetsService {
  constructor(
    private readonly db: DbService,
    private readonly viewer: ViewerService,
  ) {}

  async staff(ctx: RequestContext): Promise<{ data: DateSheet[] }> {
    const tenant = requireTenant(ctx);
    const yearId = this.viewer.requireYear(tenant);
    const v = await this.viewer.resolve(ctx, EXAMS.marksView);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<Raw>(
        // eslint-disable-next-line no-restricted-syntax -- PAPERS / ORDER are fixed fragments of this file
        `${PAPERS}
           AND ($2::bigint[] IS NULL OR es.class_id IN (SELECT class_id FROM class_sections WHERE id = ANY($2::bigint[])))
         ${ORDER}`,
        [yearId, v.kind === 'staff' ? v.sectionIds : []],
      );
      return { data: group(r.rows) };
    });
  }

  async family(ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    const yearId = this.viewer.requireYear(tenant);
    const v = await this.viewer.resolve(ctx, REPORT_CARDS.familyView);
    if (v.kind !== 'family') return { children: [] };
    return this.db.tenant(tenant, async (c) => {
      const children = [];
      for (const s of v.students) {
        if (!s.classSectionId) {
          children.push({ student: { id: s.id, name: s.name, section: s.section }, exams: [] });
          continue;
        }
        const r = await c.query<Raw>(
          // eslint-disable-next-line no-restricted-syntax -- PAPERS / ORDER are fixed fragments of this file
          `${PAPERS} AND e.show_on_portal
             AND es.class_id = (SELECT class_id FROM class_sections WHERE id = $2)
             AND app.student_subject_kind($3, $1, es.subject_id) IS NOT NULL
           ${ORDER}`,
          [yearId, s.classSectionId, s.id],
        );
        children.push({
          student: { id: s.id, name: s.name, section: s.section },
          exams: group(r.rows).map(({ classes, ...e }) => ({
            ...e,
            papers: classes[0]?.papers ?? [],
          })),
        });
      }
      return { children };
    });
  }
}
