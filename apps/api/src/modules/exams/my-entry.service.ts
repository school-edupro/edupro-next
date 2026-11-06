import { Injectable } from '@nestjs/common';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ExamEntryService } from './exam-entry.service';

export interface ToEnterLine {
  examId: string;
  exam: string;
  sectionId: string;
  section: string;
  area: 'marks' | 'indicators' | 'remarks' | 'health';
  /** the subject, "Indicators", the remark category or "Height and weight" */
  what: string;
  done: number;
  total: number;
  /** the teacher app page that enters it */
  href: string;
  /** 6 Nov 2026: a sheet reopened for entry by the admin (listed until submitted, however full) */
  reopened?: boolean;
}

/**
 * A teacher's "To enter" (docs/design/71, part 3): per open exam of the year, what is theirs and not done
 * yet — marks of their subjects not submitted, the indicators they rate, the remark categories they
 * write, and (class teacher) height and weight. From their own teacher assignments only; an office user
 * without assignments gets nothing.
 *
 * 6 Nov 2026: a locked subject (the exam's or the class's lock) is not listed, unless its sheet was
 * reopened for entry (docs/design/66): then its subject teacher sees it — or the class teacher when no
 * subject teacher is mapped — even in a wholly locked exam (whose other entry stays off the list).
 */
@Injectable()
export class MyEntryService {
  constructor(
    private readonly db: DbService,
    private readonly entry: ExamEntryService,
  ) {}

  async toEnter(ctx: RequestContext): Promise<ToEnterLine[]> {
    const tenant = requireTenant(ctx);
    const yearId = this.entry.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const mine = await c.query<{
        kind: string;
        section_id: string;
        class_id: string;
        section: string;
        subject_id: string | null;
        subject: string | null;
        category_ids: string[];
      }>(
        `SELECT ta.kind::text, ta.class_section_id::text AS section_id, cs.class_id::text, k.code || '-' || cs.name AS section,
                ta.subject_id::text, sub.name AS subject, ta.remark_category_ids::text[] AS category_ids
           FROM teacher_assignments ta JOIN employees e ON e.id = ta.employee_id
           JOIN class_sections cs ON cs.id = ta.class_section_id JOIN classes k ON k.id = cs.class_id
           LEFT JOIN subjects sub ON sub.id = ta.subject_id
          WHERE e.user_id = app.current_user_id() AND ta.academic_year_id = $1 AND ta.valid_to IS NULL
          ORDER BY k.display_order, cs.name`,
        [yearId],
      );
      if (!mine.rows.length) return [];
      const exams = await c.query<{
        id: string;
        name: string;
        areas: string[];
        class_ids: string[];
        locked: boolean;
      }>(
        `SELECT e.id::text, e.name, e.areas::text[] AS areas, e.marks_locked AS locked,
                COALESCE((SELECT array_agg(ec.class_id::text) FROM exam_classes ec WHERE ec.exam_id = e.id), '{}') AS class_ids
           FROM exams e
          WHERE e.academic_year_id = $1 AND e.deleted_at IS NULL
            AND (NOT e.marks_locked OR EXISTS (
                 SELECT 1 FROM exam_entry_status st JOIN exam_subjects es ON es.id = st.exam_subject_id
                  WHERE es.exam_id = e.id AND st.entry_open AND st.status = 'open'))
          ORDER BY e.starts_on NULLS LAST, e.id`,
        [yearId],
      );
      const sections = [...new Map(mine.rows.map((m) => [m.section_id, m])).values()];
      const roster = new Map<string, string[]>();
      for (const s of sections)
        roster.set(
          s.section_id,
          (await this.entry.roster(c, yearId, s.section_id)).map((r) => r.studentId),
        );
      const out: ToEnterLine[] = [];
      const push = (l: ToEnterLine) => {
        if (l.total > 0 && l.done < l.total) out.push(l);
      };
      for (const e of exams.rows)
        for (const s of sections) {
          if (!e.class_ids.includes(s.class_id)) continue;
          const kids = roster.get(s.section_id) ?? [];
          const mineHere = mine.rows.filter((m) => m.section_id === s.section_id);
          const isClassTeacher = mineHere.some(
            (m) => m.kind === 'class_teacher' || m.kind === 'coordinator',
          );
          const base = { examId: e.id, exam: e.name, sectionId: s.section_id, section: s.section };
          // marks: my subjects here, not submitted yet and not locked (or reopened for entry); a sheet
          // reopened for entry whose subject has no subject teacher here is the class teacher's
          if (e.areas.includes('marks')) {
            const mySubjects = mineHere
              .filter((x) => x.kind === 'subject_teacher' && x.subject_id)
              .map((x) => x.subject_id!);
            const classTeacher = mineHere.some((m) => m.kind === 'class_teacher');
            const r = await c.query<{
              subject_id: string;
              name: string;
              open: boolean;
              opened: boolean;
              mapped: boolean;
              takers: number;
              done: number;
            }>(
              `SELECT es.subject_id::text, sub.name,
                      COALESCE(st.status, 'open') = 'open' AND (NOT ($4 OR es.entry_locked) OR COALESCE(st.entry_open, false)) AS open,
                      COALESCE(st.entry_open AND st.status = 'open' AND ($4 OR es.entry_locked), false) AS opened,
                      EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.class_section_id = $3 AND ta.academic_year_id = $7
                                 AND ta.valid_to IS NULL AND ta.kind = 'subject_teacher' AND ta.subject_id = es.subject_id) AS mapped,
                      (SELECT count(*)::int FROM unnest($5::bigint[]) AS k(id)
                        WHERE app.student_exam_subject_kind(k.id, es.exam_id, es.subject_id) IS NOT NULL) AS takers,
                      ((SELECT count(*)::int FROM mark_entries me WHERE me.exam_subject_id = es.id AND me.student_id = ANY($5::bigint[]))
                       + (SELECT count(DISTINCT mp.student_id)::int FROM mark_part_entries mp JOIN exam_subject_parts p ON p.id = mp.part_id
                           WHERE p.exam_subject_id = es.id AND mp.student_id = ANY($5::bigint[])
                             AND NOT EXISTS (SELECT 1 FROM mark_entries me2 WHERE me2.exam_subject_id = es.id AND me2.student_id = mp.student_id))) AS done
                 FROM exam_subjects es JOIN subjects sub ON sub.id = es.subject_id
                 LEFT JOIN exam_entry_status st ON st.exam_subject_id = es.id AND st.class_section_id = $3
                WHERE es.exam_id = $1 AND es.class_id = $2
                  AND (es.subject_id = ANY($6::bigint[]) OR ($8 AND st.entry_open))
                ORDER BY app.subject_seq(es.class_id, $7, es.subject_id), sub.code`,
              [e.id, s.class_id, s.section_id, e.locked, kids, mySubjects, yearId, classTeacher],
            );
            for (const x of r.rows) {
              const mine = mySubjects.includes(x.subject_id) || (x.opened && !x.mapped);
              if (!mine || !x.open || (e.locked && !x.opened)) continue;
              const line: ToEnterLine = {
                ...base,
                area: 'marks',
                what: x.name,
                done: Math.min(x.done, x.takers),
                total: x.takers,
                href: `/marks?exam=${e.id}&pick=${encodeURIComponent(`${s.section_id}|${x.subject_id}`)}`,
              };
              if (x.opened && x.takers > 0) out.push({ ...line, reopened: true });
              else push(line);
            }
          }
          // a wholly locked exam lists only its sheets reopened for entry
          if (e.locked) continue;
          // indicators I rate here
          if (e.areas.includes('indicators')) {
            const set = await this.entry.classSet(c, e.id, s.class_id);
            const reach = await this.entry.indicatorReach(c, tenant, yearId, s.section_id);
            if (set && reach.kind !== 'none') {
              const ids = set.indicators
                .filter((i) => !i.heading && this.entry.reachCovers(reach, i))
                .map((i) => i.id);
              if (ids.length) {
                const r = await c.query<{ n: number }>(
                  `SELECT count(*)::int AS n FROM indicator_entries
                    WHERE exam_id = $1 AND indicator_id = ANY($2::bigint[]) AND student_id = ANY($3::bigint[])`,
                  [e.id, ids, kids],
                );
                push({
                  ...base,
                  area: 'indicators',
                  what: 'Indicators',
                  done: r.rows[0]!.n,
                  total: ids.length * kids.length,
                  href: `/indicators?exam=${e.id}&section=${s.section_id}`,
                });
              }
            }
          }
          // remark categories I write here: the class teacher all of the class's, a subject teacher their
          // subject's, a Remarks assignment those it names
          if (e.areas.includes('remarks')) {
            const subjects = mineHere
              .filter((m) => m.kind === 'subject_teacher')
              .map((m) => m.subject_id);
            const named = mineHere.flatMap((m) => (m.kind === 'remarks' ? m.category_ids : []));
            const cats = await c.query<{ id: string; name: string; n: number }>(
              `SELECT rc.id::text, rc.name,
                      (SELECT count(*)::int FROM exam_remark_items x WHERE x.exam_id = $1 AND x.category_id = rc.id AND x.student_id = ANY($6::bigint[])) AS n
                 FROM remark_categories rc
                WHERE rc.status = 'active' AND (cardinality(rc.class_ids) = 0 OR $2::bigint = ANY(rc.class_ids))
                  AND ($3 OR rc.subject_id = ANY($4::bigint[]) OR rc.id = ANY($5::bigint[]))
                ORDER BY rc.sort_order, rc.code`,
              [e.id, s.class_id, isClassTeacher, subjects, named, kids],
            );
            for (const k of cats.rows)
              push({
                ...base,
                area: 'remarks',
                what: k.name,
                done: k.n,
                total: kids.length,
                href: `/remarks?exam=${e.id}&section=${s.section_id}`,
              });
          }
          // height and weight: the class teacher
          if (e.areas.includes('health') && mineHere.some((m) => m.kind === 'class_teacher')) {
            const r = await c.query<{ n: number }>(
              `SELECT count(DISTINCT student_id)::int AS n FROM health_records
                WHERE exam_id = $1 AND student_id = ANY($2::bigint[]) AND (height_cm IS NOT NULL OR weight_kg IS NOT NULL)`,
              [e.id, kids],
            );
            push({
              ...base,
              area: 'health',
              what: 'Height and weight',
              done: r.rows[0]!.n,
              total: kids.length,
              href: `/health?exam=${e.id}&section=${s.section_id}`,
            });
          }
        }
      return out;
    });
  }
}
