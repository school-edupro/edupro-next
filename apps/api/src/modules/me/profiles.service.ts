import { Injectable } from '@nestjs/common';
import { DbService } from '../../common/db/db.service';
import type { RequestContext } from '../../common/http/request-context';

/** One way a person uses EduPro: staff of a school, the parent of one child, or a student. */
export interface Profile {
  /** staff:<school> · parent:<school>:<student> · student:<school>:<student> */
  id: string;
  kind: 'staff' | 'parent' | 'student';
  schoolId: string;
  schoolCode: string;
  schoolName: string;
  /** the staff member's or the child's name */
  name: string;
  /** "Teacher · E015", "VI-A · A1234" */
  detail: string | null;
  studentId: string | null;
  /** the web app this profile's pages belong to */
  app: 'teacher' | 'parent';
  /**
   * The header the app sends for this profile: `family` when the person is also staff in this school, so the
   * API reads them as the parent (or student) here.
   */
  actingAs: 'family' | null;
  hasPhoto: boolean;
}

const STAFF = ['employee', 'external'];

/**
 * The mobile app's profiles (docs/design/89, phase A): every school the person belongs to, as staff, as the
 * parent of each child (guardians linked to the user), or as a student (the student's own login). The app shows
 * one straight away or a switcher; a teacher who is also a parent in the same school gets both.
 */
@Injectable()
export class ProfilesService {
  constructor(private readonly db: DbService) {}

  async profiles(ctx: RequestContext): Promise<{ data: Profile[] }> {
    const schools = new Map<string, { code: string; name: string; types: Set<string> }>();
    for (const m of ctx.user.memberships) {
      const s = schools.get(m.schoolId) ?? {
        code: m.schoolCode,
        name: m.schoolName,
        types: new Set<string>(),
      };
      s.types.add(m.personType);
      schools.set(m.schoolId, s);
    }
    const allowed = [...schools.keys()];
    const out: Profile[] = [];
    for (const [schoolId, s] of schools) {
      const isStaff = [...s.types].some((t) => STAFF.includes(t));
      const base = { schoolId, schoolCode: s.code, schoolName: s.name };
      const rows = await this.db.tenant(
        { schoolId, userId: ctx.user.id, allowedSchoolIds: allowed, requestId: ctx.requestId },
        async (c) => {
          const year = (
            await c.query<{ id: string }>(
              `SELECT id::text FROM academic_years WHERE status = 'active' LIMIT 1`,
            )
          ).rows[0]?.id;
          const staff = isStaff
            ? (
                await c.query<{
                  name: string;
                  code: string | null;
                  designation: string | null;
                  photo: boolean;
                }>(
                  `SELECT display_name AS name, employee_code AS code, designation, photo_file_id IS NOT NULL AS photo
                     FROM employees WHERE user_id = app.current_user_id() AND deleted_at IS NULL
                    ORDER BY id LIMIT 1`,
                )
              ).rows[0]
            : undefined;
          const kids = (
            await c.query<{
              id: string;
              name: string;
              admission_no: string | null;
              section: string | null;
              own: boolean;
              photo: boolean;
            }>(
              `SELECT s.id::text, s.display_name AS name, s.admission_no, c.code || '-' || cs.name AS section,
                      (s.user_id = app.current_user_id()) AS own, s.photo_file_id IS NOT NULL AS photo
                 FROM students s
                 LEFT JOIN enrolments e ON e.student_id = s.id AND e.academic_year_id = $1 AND e.status = 'active'
                 LEFT JOIN class_sections cs ON cs.id = e.class_section_id
                 LEFT JOIN classes c ON c.id = cs.class_id
                WHERE s.deleted_at IS NULL AND (
                      s.user_id = app.current_user_id()
                   OR s.id IN (SELECT sg.student_id FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                                WHERE g.user_id = app.current_user_id() AND g.deleted_at IS NULL))
                ORDER BY own DESC, s.display_name`,
              [year ?? null],
            )
          ).rows;
          return { staff, kids };
        },
      );
      if (isStaff)
        out.push({
          ...base,
          id: `staff:${schoolId}`,
          kind: 'staff',
          name: rows.staff?.name ?? ctx.user.displayName,
          detail: [rows.staff?.designation, rows.staff?.code].filter(Boolean).join(' · ') || null,
          studentId: null,
          app: 'teacher',
          actingAs: null,
          hasPhoto: rows.staff?.photo ?? false,
        });
      for (const k of rows.kids) {
        const kind = k.own ? 'student' : 'parent';
        // a family membership must back the profile (a guardian record without one opens nothing)
        if (!s.types.has(kind === 'student' ? 'student' : 'guardian')) continue;
        out.push({
          ...base,
          id: `${kind}:${schoolId}:${k.id}`,
          kind,
          name: k.name,
          detail: [k.section, k.admission_no].filter(Boolean).join(' · ') || null,
          studentId: k.id,
          app: 'parent',
          actingAs: isStaff ? 'family' : null,
          hasPhoto: k.photo,
        });
      }
    }
    return { data: out };
  }
}
