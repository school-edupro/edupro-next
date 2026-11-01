import type { PoolClient } from '@edupro/db';
import type { RequestContext } from '../../common/http/request-context';

/**
 * Whose classes a person sees on Report cards (docs/design/65, 1 Nov 2026): whoever may publish results
 * (the principal; school and group admins) every class; anyone else the classes they coordinate (each
 * section) and the sections they are class teacher of, from this year's Teacher assignments. A person
 * with neither sees no class.
 */
export interface CardScope {
  all: boolean;
  /** the classes with a section in sight */
  classes: string[];
  /** the sections in sight */
  sections: string[];
}

/** The report-card PDFs (one pupil, or several in one PDF): CardScope decides who opens them. */
export const CARD_DATASETS: readonly string[] = ['report_card', 'report_card_batch'];

/** See CardScope: every class for whoever may publish results, else this year's assignments. */
export async function cardScopeOf(c: PoolClient, ctx: RequestContext): Promise<CardScope> {
  if (ctx.permissions?.has('exams.result.publish')) return { all: true, classes: [], sections: [] };
  const r = await c.query<{ class_id: string; section_id: string }>(
    `SELECT DISTINCT cs.class_id::text, cs.id::text AS section_id
       FROM teacher_assignments ta
       JOIN employees e ON e.id = ta.employee_id AND e.user_id = app.current_user_id()
       JOIN class_sections mine ON mine.id = ta.class_section_id
       JOIN class_sections cs ON cs.academic_year_id = ta.academic_year_id AND cs.deleted_at IS NULL
        AND (cs.id = mine.id OR (ta.kind = 'coordinator' AND cs.class_id = mine.class_id))
      WHERE ta.academic_year_id = app.current_academic_year_id() AND ta.valid_to IS NULL
        AND ta.kind IN ('class_teacher', 'coordinator')`,
  );
  return {
    all: false,
    classes: [...new Set(r.rows.map((x) => x.class_id))],
    sections: r.rows.map((x) => x.section_id),
  };
}

/**
 * SQL: every pupil of the report-card export `e` is in sight. `sections` is the placeholder bound to
 * CardScope.sections as text[] (NULL for every class): a PDF made for a section in sight, or one whose
 * pupils (studentId, or each of studentIds) are all enrolled this year in a section in sight.
 */
export function cardExportInSight(sections: `$${number}`): string {
  // eslint-disable-next-line no-restricted-syntax -- the only interpolation is a bind placeholder ($n)
  return `(${sections}::text[] IS NULL
    OR e.params->>'classSectionId' = ANY(${sections}::text[])
    OR (e.params ? 'studentId' AND EXISTS (SELECT 1 FROM enrolments en
          WHERE en.student_id::text = e.params->>'studentId' AND en.academic_year_id = app.current_academic_year_id()
            AND en.class_section_id::text = ANY(${sections}::text[])))
    OR (jsonb_typeof(e.params->'studentIds') = 'array' AND jsonb_array_length(e.params->'studentIds') > 0
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(e.params->'studentIds') sid
          WHERE NOT EXISTS (SELECT 1 FROM enrolments en
            WHERE en.student_id::text = sid AND en.academic_year_id = app.current_academic_year_id()
              AND en.class_section_id::text = ANY(${sections}::text[])))))`;
}
