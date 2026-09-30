import type { PoolClient } from 'pg';
import { decryptField, encryptField, maskValue } from './field-crypto';
import {
  PROFILE_FIELDS,
  PROFILE_FIELD_BY_KEY,
  type GuardianParty,
  type ProfileField,
} from './student-fields';
import {
  autoValues,
  completeness,
  type ProfileLists,
  type ProfileValue,
  type ProfileValues,
} from './student-profile';

/**
 * Reads and writes a student's catalogue values across their storage (students columns, address,
 * profile / secure JSONB, the father / mother / guardian records and the enrolment). Runs inside the
 * caller's tenant transaction; row-level security scopes every statement to the school.
 */

export interface StudentProfileSnapshot {
  studentId: string;
  admissionNo: string;
  displayName: string;
  values: ProfileValues;
  /** Sensitive keys whose values are shown masked to this viewer. */
  masked: string[];
  completeness: { percent: number; missing: string[] };
  guardianIds: Partial<Record<GuardianParty, string>>;
  /** File ids of the photos: the student's and each parent's. */
  photos: Partial<Record<'student' | GuardianParty, string>>;
  enrolment: {
    academicYearId: string;
    academicYear: string;
    classSectionId: string;
    className: string;
    section: string;
    rollNo: number | null;
  } | null;
  updatedAt: string;
}

export class ProfileWriteError extends Error {
  constructor(
    message: string,
    readonly errors: Record<string, string>,
  ) {
    super(message);
    this.name = 'ProfileWriteError';
  }
}

const GENDER_TO_ENUM: Record<string, string> = { Male: 'male', Female: 'female', Other: 'other' };
const ENUM_TO_GENDER: Record<string, string> = { male: 'Male', female: 'Female', other: 'Other' };
/** student_guardians.relation for each party; the guardian party is any non-parent link. */
const PARTY_RELATION: Record<GuardianParty, string> = {
  father: 'father',
  mother: 'mother',
  guardian: 'guardian',
};

interface StudentDbRow {
  id: string;
  admission_no: string;
  display_name: string;
  first_name: string;
  last_name: string | null;
  dob: string | null;
  gender: string;
  category: string | null;
  blood_group: string | null;
  house: string | null;
  admitted_on: string | null;
  address: Record<string, unknown>;
  profile: Record<string, unknown>;
  secure: Record<string, unknown>;
  photo_file_id: string | null;
  updated_at: Date;
}
interface GuardianDbRow {
  id: string;
  relation: string;
  first_name: string;
  last_name: string | null;
  mobile: string | null;
  email: string | null;
  occupation: string | null;
  photo_file_id: string | null;
  profile: Record<string, unknown>;
  secure: Record<string, unknown>;
}

const asValue = (v: unknown): ProfileValue =>
  v === null || v === undefined || v === '' ? null : typeof v === 'number' ? v : String(v);

async function loadGuardians(
  c: PoolClient,
  studentId: string,
): Promise<Partial<Record<GuardianParty, GuardianDbRow>>> {
  const r = await c.query<GuardianDbRow>(
    `SELECT g.id::text, sg.relation::text AS relation, g.first_name, g.last_name, g.mobile, g.email::text AS email,
            g.occupation, g.photo_file_id::text, g.profile, g.secure
       FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
      WHERE sg.student_id = $1
      ORDER BY sg.is_primary DESC, sg.id`,
    [studentId],
  );
  const out: Partial<Record<GuardianParty, GuardianDbRow>> = {};
  for (const g of r.rows) {
    const party: GuardianParty =
      g.relation === 'father' ? 'father' : g.relation === 'mother' ? 'mother' : 'guardian';
    if (!out[party]) out[party] = g;
  }
  return out;
}

interface EnrolDbRow {
  student_id: string;
  academic_year_id: string;
  academic_year: string;
  start_date: string;
  class_section_id: string;
  class_name: string;
  section: string;
  roll_no: number | null;
}

/** Reads every catalogue value. Sensitive values are decrypted, then masked unless `showSensitive`. */
export async function readStudentProfile(
  c: PoolClient,
  studentId: string,
  opts: { academicYearId?: string | null; showSensitive: boolean },
): Promise<StudentProfileSnapshot | null> {
  const all = await readStudentProfiles(c, [studentId], opts);
  return all.get(studentId) ?? null;
}

/**
 * Batch read for lists, templates and reports: three queries for any number of students (students,
 * their father / mother / guardian links, the enrolment of the year).
 */
export async function readStudentProfiles(
  c: PoolClient,
  studentIds: readonly string[],
  opts: { academicYearId?: string | null; showSensitive: boolean },
): Promise<Map<string, StudentProfileSnapshot>> {
  const out = new Map<string, StudentProfileSnapshot>();
  if (!studentIds.length) return out;
  const ids = [...studentIds];
  const s = await c.query<StudentDbRow>(
    `SELECT id::text, admission_no, display_name, first_name, last_name, dob::text, gender::text, category, blood_group, house,
            admitted_on::text, address, profile, secure, photo_file_id::text, updated_at
       FROM students WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
    [ids],
  );
  const g = await c.query<GuardianDbRow & { student_id: string }>(
    `SELECT sg.student_id::text, g.id::text, sg.relation::text AS relation, g.first_name, g.last_name, g.mobile,
            g.email::text AS email, g.occupation, g.photo_file_id::text, g.profile, g.secure
       FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
      WHERE sg.student_id = ANY($1::bigint[])
      ORDER BY sg.student_id, sg.is_primary DESC, sg.id`,
    [ids],
  );
  const guardiansOf = new Map<string, Partial<Record<GuardianParty, GuardianDbRow>>>();
  for (const row of g.rows) {
    const party: GuardianParty =
      row.relation === 'father' ? 'father' : row.relation === 'mother' ? 'mother' : 'guardian';
    const bag = guardiansOf.get(row.student_id) ?? {};
    if (!bag[party]) bag[party] = row;
    guardiansOf.set(row.student_id, bag);
  }
  const e = await c.query<EnrolDbRow>(
    `SELECT DISTINCT ON (e.student_id) e.student_id::text, e.academic_year_id::text, y.code AS academic_year,
            y.start_date::text, e.class_section_id::text, c.name AS class_name, cs.name AS section, e.roll_no
       FROM enrolments e
       JOIN academic_years y ON y.id = e.academic_year_id
       JOIN class_sections cs ON cs.id = e.class_section_id
       JOIN classes c ON c.id = cs.class_id
      WHERE e.student_id = ANY($1::bigint[]) AND ($2::bigint IS NULL OR e.academic_year_id = $2::bigint)
      ORDER BY e.student_id, (e.academic_year_id = COALESCE($2::bigint, app.current_academic_year_id())) DESC NULLS LAST,
               y.start_date DESC`,
    [ids, opts.academicYearId ?? null],
  );
  const enrolOf = new Map(e.rows.map((x) => [x.student_id, x]));

  for (const st of s.rows) {
    const guardians = guardiansOf.get(st.id) ?? {};
    const en = enrolOf.get(st.id) ?? null;
    const values: ProfileValues = {};
    const masked: string[] = [];
    const secureValue = (bag: Record<string, unknown>, key: string, f: ProfileField) => {
      const stored = bag[key];
      if (typeof stored !== 'string') return null;
      const plain = decryptField(stored);
      if (plain === null) return null;
      if (opts.showSensitive) return plain;
      masked.push(f.key);
      return maskValue(plain, f.type);
    };
    for (const f of PROFILE_FIELDS) {
      const st_ = f.store;
      let v: ProfileValue = null;
      switch (st_.t) {
        case 'col': {
          const raw = (st as unknown as Record<string, unknown>)[st_.col];
          v = st_.col === 'gender' ? (ENUM_TO_GENDER[String(raw)] ?? null) : asValue(raw);
          break;
        }
        case 'addr':
          v = asValue(st.address[st_.key]);
          break;
        case 'json':
          v =
            st_.on === 'student'
              ? asValue(st.profile[st_.key])
              : asValue(guardians[st_.on]?.profile[st_.key]);
          break;
        case 'secure':
          v =
            st_.on === 'student'
              ? secureValue(st.secure, st_.key, f)
              : guardians[st_.on]
                ? secureValue(guardians[st_.on]!.secure, st_.key, f)
                : null;
          break;
        case 'gcol': {
          const gd = guardians[st_.on];
          if (gd) {
            v =
              st_.col === 'first_name'
                ? asValue([gd.first_name, gd.last_name].filter(Boolean).join(' '))
                : asValue((gd as unknown as Record<string, unknown>)[st_.col]);
          }
          break;
        }
        case 'enrol':
          if (en) {
            v =
              st_.col === 'academic_year'
                ? en.academic_year
                : st_.col === 'class'
                  ? en.class_name
                  : st_.col === 'section'
                    ? en.section
                    : en.roll_no;
          }
          break;
        case 'auto':
          break;
      }
      values[f.key] = v;
    }
    Object.assign(values, autoValues(values, en?.start_date ?? null));
    const guardianIds: Partial<Record<GuardianParty, string>> = {};
    const photos: StudentProfileSnapshot['photos'] = {};
    if (st.photo_file_id) photos.student = st.photo_file_id;
    for (const p of ['father', 'mother', 'guardian'] as const) {
      if (guardians[p]) guardianIds[p] = guardians[p]!.id;
      if (guardians[p]?.photo_file_id) photos[p] = guardians[p]!.photo_file_id!;
    }
    out.set(st.id, {
      studentId: st.id,
      admissionNo: st.admission_no,
      displayName: st.display_name,
      values,
      masked,
      completeness: completeness(values),
      guardianIds,
      photos,
      enrolment: en
        ? {
            academicYearId: en.academic_year_id,
            academicYear: en.academic_year,
            classSectionId: en.class_section_id,
            className: en.class_name,
            section: en.section,
            rollNo: en.roll_no,
          }
        : null,
      updatedAt: st.updated_at.toISOString(),
    });
  }
  return out;
}

/**
 * Applies validated values (from `validateChanges`). A masked sensitive value sent back unchanged is
 * ignored. A parent block needs the parent's name before any other detail: the first write creates
 * and links the guardian record, which siblings then share.
 */
export async function writeStudentProfile(
  c: PoolClient,
  studentId: string,
  values: ProfileValues,
): Promise<{ changed: string[] }> {
  const errors: Record<string, string> = {};
  const studentSets: string[] = [];
  const studentParams: unknown[] = [];
  const setStudent = (sql: string, v: unknown) => {
    studentParams.push(v);
    studentSets.push(sql.replace('$?', `$${String(studentParams.length)}`));
  };
  const addrPatch: Record<string, unknown> = {};
  const addrDrop: string[] = [];
  const profPatch: Record<string, unknown> = {};
  const profDrop: string[] = [];
  const securePatch: Record<string, unknown> = {};
  const secureDrop: string[] = [];
  const party: Record<
    GuardianParty,
    {
      cols: Record<string, unknown>;
      prof: Record<string, unknown>;
      profDrop: string[];
      sec: Record<string, unknown>;
      secDrop: string[];
    }
  > = {
    father: { cols: {}, prof: {}, profDrop: [], sec: {}, secDrop: [] },
    mother: { cols: {}, prof: {}, profDrop: [], sec: {}, secDrop: [] },
    guardian: { cols: {}, prof: {}, profDrop: [], sec: {}, secDrop: [] },
  };
  const changed: string[] = [];

  for (const [key, v] of Object.entries(values)) {
    const f = PROFILE_FIELD_BY_KEY.get(key);
    if (!f) continue;
    const st = f.store;
    // a masked value coming back from a form means "unchanged"
    if (f.sensitive && typeof v === 'string' && /^X{2,}/.test(v)) continue;
    changed.push(key);
    switch (st.t) {
      case 'col':
        if (st.col === 'gender')
          setStudent('gender = $?::gender', v ? GENDER_TO_ENUM[String(v)] : 'unspecified');
        else if (st.col === 'first_name' || st.col === 'admission_no') {
          if (v === null) errors[key] = `${f.label} cannot be empty`;
          else setStudent(`${st.col} = $?`, v);
        } else if (st.col === 'dob' || st.col === 'admitted_on')
          setStudent(`${st.col} = $?::date`, v);
        else setStudent(`${st.col} = $?`, v);
        break;
      case 'addr':
        if (v === null) addrDrop.push(st.key);
        else addrPatch[st.key] = v;
        break;
      case 'json':
        if (st.on === 'student') {
          if (v === null) profDrop.push(st.key);
          else profPatch[st.key] = v;
        } else if (v === null) party[st.on].profDrop.push(st.key);
        else party[st.on].prof[st.key] = v;
        break;
      case 'secure': {
        const enc = v === null ? null : encryptField(String(v));
        if (st.on === 'student') {
          if (enc === null) secureDrop.push(st.key);
          else securePatch[st.key] = enc;
        } else if (enc === null) party[st.on].secDrop.push(st.key);
        else party[st.on].sec[st.key] = enc;
        break;
      }
      case 'gcol':
        party[st.on].cols[st.col] = v;
        break;
      default:
        break;
    }
  }

  // ---- student row: columns, then address / profile / secure merged (null clears a key)
  const addJson = (col: string, patch: Record<string, unknown>, drop: string[]) => {
    if (!Object.keys(patch).length && !drop.length) return;
    studentParams.push(JSON.stringify(patch));
    const patchIdx = studentParams.length;
    studentParams.push(drop);
    studentSets.push(
      `${col} = (${col} || $${String(patchIdx)}::jsonb) - $${String(studentParams.length)}::text[]`,
    );
  };
  addJson('address', addrPatch, addrDrop);
  addJson('profile', profPatch, profDrop);
  addJson('secure', securePatch, secureDrop);
  if (studentSets.length) {
    studentSets.push('updated_by = app.current_user_id()', 'updated_at = now()');
    studentParams.push(studentId);
    try {
      await c.query(
        // eslint-disable-next-line no-restricted-syntax -- column names come from the field catalogue; values are bound
        `UPDATE students SET ${studentSets.join(', ')} WHERE id = $${String(studentParams.length)} AND deleted_at IS NULL`,
        studentParams,
      );
    } catch (error) {
      const e = error as { code?: string; constraint?: string };
      if (e.code === '23505')
        throw new ProfileWriteError('Duplicate value', {
          [e.constraint?.includes('registration') ? 'registration_no' : 'admission_no']:
            'another student already has this number',
        });
      throw error;
    }
  }

  // ---- father / mother / guardian records
  const current = await loadGuardians(c, studentId);
  for (const p of ['father', 'mother', 'guardian'] as const) {
    const b = party[p];
    const touched =
      Object.keys(b.cols).length ||
      Object.keys(b.prof).length ||
      b.profDrop.length ||
      Object.keys(b.sec).length ||
      b.secDrop.length;
    if (!touched) continue;
    const g = current[p];
    const nameKey = `${p}_name`;
    if ('first_name' in b.cols && b.cols.first_name === null) {
      errors[nameKey] =
        `${PROFILE_FIELD_BY_KEY.get(nameKey)!.label} cannot be emptied; unlink the ${p} instead`;
      continue;
    }
    if (!g) {
      const name = b.cols.first_name;
      const hasValues =
        Object.values(b.cols).some((x) => x !== null) ||
        Object.keys(b.prof).length ||
        Object.keys(b.sec).length;
      if (!hasValues) continue;
      if (typeof name !== 'string' || !name) {
        errors[nameKey] = `Enter the ${p}'s name before other ${p} details`;
        continue;
      }
      const ins = await c.query<{ id: string }>(
        `INSERT INTO guardians (school_id, first_name, mobile, email, occupation, profile, secure, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5::jsonb, $6::jsonb, app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [
          name,
          b.cols.mobile ?? null,
          b.cols.email ?? null,
          b.cols.occupation ?? null,
          JSON.stringify(b.prof),
          JSON.stringify(b.sec),
        ],
      );
      const id = ins.rows[0]!.id;
      const hasPrimary = await c.query(
        'SELECT 1 FROM student_guardians WHERE student_id = $1 AND is_primary',
        [studentId],
      );
      await c.query(
        `INSERT INTO student_guardians (school_id, student_id, guardian_id, relation, is_primary, receives_notifications, created_by)
         VALUES (app.current_school_id(), $1, $2, $3::guardian_relation, $4, true, app.current_user_id())`,
        [studentId, id, PARTY_RELATION[p], (hasPrimary.rowCount ?? 0) === 0],
      );
      continue;
    }
    const sets: string[] = ['updated_by = app.current_user_id()', 'updated_at = now()'];
    const params: unknown[] = [];
    const put = (sql: string, v: unknown) => {
      params.push(v);
      sets.push(sql.replace('$?', `$${String(params.length)}`));
    };
    for (const [col, v] of Object.entries(b.cols)) {
      if (col === 'first_name') {
        put('first_name = $?', v);
        sets.push('last_name = NULL'); // the sheet keeps one full-name field
      } else put(`${col} = $?`, v);
    }
    if (Object.keys(b.prof).length || b.profDrop.length) {
      params.push(JSON.stringify(b.prof));
      const i = params.length;
      params.push(b.profDrop);
      sets.push(`profile = (profile || $${String(i)}::jsonb) - $${String(params.length)}::text[]`);
    }
    if (Object.keys(b.sec).length || b.secDrop.length) {
      params.push(JSON.stringify(b.sec));
      const i = params.length;
      params.push(b.secDrop);
      sets.push(`secure = (secure || $${String(i)}::jsonb) - $${String(params.length)}::text[]`);
    }
    params.push(g.id);
    await c.query(
      // eslint-disable-next-line no-restricted-syntax -- column names come from the field catalogue; values are bound
      `UPDATE guardians SET ${sets.join(', ')} WHERE id = $${String(params.length)}`,
      params,
    );
  }
  if (Object.keys(errors).length)
    throw new ProfileWriteError('Some fields could not be saved', errors);
  return { changed };
}

/** Stores the completeness percentage used by lists, filters and reports. */
export async function refreshCompleteness(c: PoolClient, studentId: string): Promise<number> {
  const snap = await readStudentProfile(c, studentId, { showSensitive: false });
  const percent = snap?.completeness.percent ?? 0;
  await c.query('UPDATE students SET profile_completeness = $2 WHERE id = $1', [
    studentId,
    percent,
  ]);
  return percent;
}

/** The school's drop-down values per list code (active rows, in order). */
export async function loadProfileLists(c: PoolClient): Promise<ProfileLists> {
  const r = await c.query<{ list_code: string; value: string }>(
    `SELECT list_code, value FROM profile_lists WHERE status = 'active' ORDER BY list_code, sort_order, value`,
  );
  const out: ProfileLists = {};
  for (const x of r.rows) (out[x.list_code] ??= []).push(x.value);
  // State and Country also accept the school's geography masters
  const geo = await c.query<{ kind: string; name: string }>(
    `SELECT 'Country' AS kind, name FROM countries WHERE status = 'active'
     UNION ALL SELECT 'State', name FROM states WHERE status = 'active'`,
  );
  for (const x of geo.rows) {
    const list = (out[x.kind] ??= []);
    if (!list.some((v) => v.toLowerCase() === x.name.toLowerCase())) list.push(x.name);
  }
  return out;
}
