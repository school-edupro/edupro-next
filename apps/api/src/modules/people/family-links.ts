import type { PoolClient } from '@edupro/db';

/**
 * Sibling families (0426): what a student's Sibling section names, and how the two children's father and mother
 * records stand. Plain functions (no DI) so the student 360 and the family links service can share them.
 */
export type FamilyRelation = 'father' | 'mother';
export const FAMILY_RELATIONS: FamilyRelation[] = ['father', 'mother'];

export interface FamilyChild {
  id: string;
  admissionNo: string;
  name: string;
  section: string | null;
}

export interface FamilyParent {
  guardianId: string;
  name: string;
  mobile: string | null;
  email: string | null;
  /** the record has a login (the family website and the app) */
  hasLogin: boolean;
  /** the children linked to this record now */
  children: number;
  /** this child's link to it */
  isPrimary: boolean;
  receivesNotifications: boolean;
}

/**
 * shared: one record for both; different: each has its own; only_here / only_sibling: one child has none for this
 * relation; none: neither has one.
 */
export type FamilyState = 'shared' | 'different' | 'only_here' | 'only_sibling' | 'none';

export interface FamilyRelationRow {
  relation: FamilyRelation;
  here: FamilyParent | null;
  sibling: FamilyParent | null;
  state: FamilyState;
  /** the record to keep for both: the one with a login, else this child's; apart when nothing to do */
  suggested: 'here' | 'sibling' | 'apart';
}

/** A student's view of its sibling family: who is named, whether the parent records are shared, the last link. */
export interface FamilyLinkInfo {
  sibling: FamilyChild | null;
  /** at least one parent record is shared (that parent's login sees both children) */
  sharedAny: boolean;
  /** every father / mother record either child has is shared */
  sharedAll: boolean;
  /** the latest Link families of this child that is not undone: Undo */
  lastBatch: { batchId: string; at: string; siblingAdmissionNo: string } | null;
}

const childOf = async (c: PoolClient, where: string, arg: string): Promise<FamilyChild | null> => {
  const r = await c.query<{
    id: string;
    admission_no: string;
    name: string;
    section: string | null;
  }>(
    // eslint-disable-next-line no-restricted-syntax -- `where` is one of two fixed conditions; the value is bound
    `SELECT s.id::text, s.admission_no, s.display_name AS name,
            (SELECT k.code || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id
               JOIN classes k ON k.id = cs.class_id
              WHERE e.student_id = s.id AND e.status = 'active' ORDER BY e.id DESC LIMIT 1) AS section
       FROM students s WHERE ${where} AND s.deleted_at IS NULL LIMIT 1`,
    [arg],
  );
  const x = r.rows[0];
  return x ? { id: x.id, admissionNo: x.admission_no, name: x.name, section: x.section } : null;
};

export const familyChild = (c: PoolClient, id: string) => childOf(c, 's.id = $1::bigint', id);

/** The sibling a student's Sibling section names (Sibling in school = Yes and an admission number), if on record. */
export async function namedSibling(c: PoolClient, studentId: string): Promise<FamilyChild | null> {
  const r = await c.query<{ yes: string | null; adm: string | null }>(
    `SELECT profile->>'sibling_in_school' AS yes, NULLIF(btrim(profile->>'sibling_admission_no'), '') AS adm
       FROM students WHERE id = $1 AND deleted_at IS NULL`,
    [studentId],
  );
  const x = r.rows[0];
  if (!x?.adm || (x.yes ?? 'Yes') === 'No') return null;
  const s = await childOf(c, 'lower(s.admission_no) = lower($1)', x.adm);
  return s && s.id !== studentId ? s : null;
}

/** A child's father or mother record (its primary one first). */
async function parentOf(
  c: PoolClient,
  studentId: string,
  relation: FamilyRelation,
): Promise<FamilyParent | null> {
  const r = await c.query<{
    id: string;
    name: string;
    mobile: string | null;
    email: string | null;
    has_login: boolean;
    children: number;
    is_primary: boolean;
    notify: boolean;
  }>(
    `SELECT g.id::text, g.display_name AS name, g.mobile, g.email::text, g.user_id IS NOT NULL AS has_login,
            (SELECT count(*)::int FROM student_guardians x WHERE x.guardian_id = g.id) AS children,
            sg.is_primary, sg.receives_notifications AS notify
       FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
      WHERE sg.student_id = $1 AND sg.relation = $2::guardian_relation AND g.deleted_at IS NULL
      ORDER BY sg.is_primary DESC, sg.id LIMIT 1`,
    [studentId, relation],
  );
  const x = r.rows[0];
  return x
    ? {
        guardianId: x.id,
        name: x.name,
        mobile: x.mobile,
        email: x.email,
        hasLogin: x.has_login,
        children: x.children,
        isPrimary: x.is_primary,
        receivesNotifications: x.notify,
      }
    : null;
}

/** How the two children's father and mother records stand. */
export async function familyRows(
  c: PoolClient,
  studentId: string,
  siblingId: string,
): Promise<FamilyRelationRow[]> {
  const out: FamilyRelationRow[] = [];
  for (const relation of FAMILY_RELATIONS) {
    const here = await parentOf(c, studentId, relation);
    const sibling = await parentOf(c, siblingId, relation);
    const state: FamilyState =
      here && sibling
        ? here.guardianId === sibling.guardianId
          ? 'shared'
          : 'different'
        : here
          ? 'only_here'
          : sibling
            ? 'only_sibling'
            : 'none';
    const suggested =
      state === 'different'
        ? sibling!.hasLogin && !here!.hasLogin
          ? 'sibling'
          : 'here'
        : state === 'only_here'
          ? 'here'
          : state === 'only_sibling'
            ? 'sibling'
            : 'apart';
    out.push({ relation, here, sibling, state, suggested });
  }
  return out;
}

/** The student 360's sibling family: the named sibling, how the records stand, the last link to undo. */
export async function familyLinkInfo(c: PoolClient, studentId: string): Promise<FamilyLinkInfo> {
  const sibling = await namedSibling(c, studentId);
  const rows = sibling ? await familyRows(c, studentId, sibling.id) : [];
  const present = rows.filter((r) => r.state !== 'none');
  const last = await c.query<{ batch_id: string; at: Date; adm: string }>(
    `SELECT f.batch_id::text, max(f.created_at) AS at,
            (SELECT s.admission_no FROM students s
              WHERE s.id = CASE WHEN min(f.student_id) = $1::bigint THEN min(f.sibling_id) ELSE min(f.student_id) END) AS adm
       FROM family_links f
      WHERE (f.student_id = $1 OR f.sibling_id = $1) AND f.undone_at IS NULL
      GROUP BY f.batch_id ORDER BY max(f.created_at) DESC LIMIT 1`,
    [studentId],
  );
  const b = last.rows[0];
  return {
    sibling,
    sharedAny: present.some((r) => r.state === 'shared'),
    sharedAll: present.length > 0 && present.every((r) => r.state === 'shared'),
    lastBatch: b
      ? { batchId: b.batch_id, at: b.at.toISOString(), siblingAdmissionNo: b.adm }
      : null,
  };
}
