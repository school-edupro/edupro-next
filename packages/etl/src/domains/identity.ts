/**
 * Domain 2: admin, employee_master and student_master to users and user_school_memberships.
 * A person is identified by mobile number across legacy tables (an employee who is also a parent becomes
 * one user with two memberships). The One Auth subject is provisioned later; until then the row carries
 * 'pending:<mobile>' and app.claim_pending_identity() attaches the real subject at first login.
 */
import type { PoolClient } from 'pg';
import type { Loader, Step, Transformed } from '../pipeline';
import { reject, type Reject } from '../reject';
import {
  normaliseEmail,
  normaliseMobile,
  normaliseStatus,
  repairMojibake,
  text,
  yesNoToBoolean,
} from '../transforms';

export type PersonType = 'employee' | 'guardian' | 'student' | 'external';

export interface PersonRow {
  legacyTable: string;
  legacyKey: string;
  oneauthSub: string;
  displayName: string;
  mobile: string | null;
  email: string | null;
  personType: PersonType;
  status: 'active' | 'inactive';
  /** Template role to grant after provisioning (see docs/design/02-rbac-permission-catalogue.md). */
  suggestedRole: string | null;
  legacyRef: string;
}

export interface RawAdmin extends Record<string, unknown> {
  suser?: string;
  sname?: string;
  smobile?: string;
  semail?: string;
  Status?: unknown;
}

export interface RawEmployee extends Record<string, unknown> {
  EmpId?: string | number;
  Name?: string;
  MobileNo?: string;
  Email_Id?: string;
  Status?: unknown;
  isTrash?: unknown;
  FinancialYear?: string;
  role?: string;
  ClassTeacher?: string;
  Designation?: string;
}

export interface RawStudent extends Record<string, unknown> {
  sadmission?: string;
  sname?: string;
  smobile?: string;
  email?: string;
  status?: unknown;
  isTrash?: unknown;
  FinancialYear?: string;
  fathername?: string;
  mothername?: string;
  fathermobile?: string;
  mothermobile?: string;
  guardianname?: string;
  guardianmobile?: string;
}

type Rejects = Array<Reject & { column?: string; legacyKey?: string }>;

export function subjectFor(
  schoolCode: string,
  table: string,
  key: string,
  mobile: string | null,
): string {
  return mobile ? `pending:${mobile}` : `legacy:${schoolCode}:${table}:${key}`;
}

function activeStatus(status: unknown, isTrash: unknown): 'active' | 'inactive' {
  const trash = yesNoToBoolean(isTrash);
  if (trash.kind === 'ok' && trash.value === true) return 'inactive';
  const s = normaliseStatus(status);
  return s.kind === 'ok' && s.value === 'inactive' ? 'inactive' : 'active';
}

function name(v: unknown): string | null {
  const repaired = repairMojibake(v);
  const t = text(repaired);
  return t && t.length >= 2 ? t : null;
}

export function adminStep(schoolCode: string): Step<RawAdmin, PersonRow> {
  return {
    legacyTable: 'admin',
    transform(raw): Transformed<PersonRow> | Rejects {
      const key = text(raw.suser);
      if (!key) return [{ ...reject('admin.suser_missing', raw.suser, true), column: 'suser' }];
      const legacyKey = `suser=${key}`;
      const mobile = normaliseMobile(raw.smobile);
      const email = normaliseEmail(raw.semail);
      const displayName = name(raw.sname) ?? key;
      return {
        legacyKey,
        row: {
          legacyTable: 'admin',
          legacyKey,
          oneauthSub: subjectFor(
            schoolCode,
            'admin',
            key,
            mobile.kind === 'ok' ? mobile.value : null,
          ),
          displayName,
          mobile: mobile.kind === 'ok' ? mobile.value : null,
          email: email.kind === 'ok' ? email.value : null,
          personType: 'employee',
          status: activeStatus(raw.Status, null),
          suggestedRole: 'school_admin',
          legacyRef: key,
        },
      };
    },
  };
}

export function employeeStep(schoolCode: string): Step<RawEmployee, PersonRow> {
  return {
    legacyTable: 'employee_master',
    transform(raw): Transformed<PersonRow> | Rejects {
      const key = text(raw.EmpId);
      if (!key) return [{ ...reject('employee.empid_missing', raw.EmpId, true), column: 'EmpId' }];
      const legacyKey = `EmpId=${key}`;
      const displayName = name(raw.Name);
      if (!displayName)
        return [{ ...reject('employee.name_missing', raw.Name, true), column: 'Name', legacyKey }];
      const mobile = normaliseMobile(raw.MobileNo);
      const email = normaliseEmail(raw.Email_Id);
      const teaches = typeof raw.ClassTeacher === 'string' && raw.ClassTeacher.trim() !== '';
      const role = String(raw.role ?? '').toLowerCase();
      return {
        legacyKey,
        legacyYear: raw.FinancialYear ? String(raw.FinancialYear) : undefined,
        row: {
          legacyTable: 'employee_master',
          legacyKey,
          oneauthSub: subjectFor(
            schoolCode,
            'employee_master',
            key,
            mobile.kind === 'ok' ? mobile.value : null,
          ),
          displayName,
          mobile: mobile.kind === 'ok' ? mobile.value : null,
          email: email.kind === 'ok' ? email.value : null,
          personType: 'employee',
          status: activeStatus(raw.Status, raw.isTrash),
          suggestedRole: role.includes('admin')
            ? 'school_admin'
            : teaches
              ? 'class_teacher'
              : role.includes('teacher')
                ? 'subject_teacher'
                : null,
          legacyRef: key,
        },
      };
    },
  };
}

export function studentStep(schoolCode: string): Step<RawStudent, PersonRow> {
  return {
    legacyTable: 'student_master',
    transform(raw): Transformed<PersonRow> | Rejects {
      const key = text(raw.sadmission);
      if (!key)
        return [
          { ...reject('student.admission_missing', raw.sadmission, true), column: 'sadmission' },
        ];
      const legacyKey = `sadmission=${key}`;
      const displayName = name(raw.sname);
      if (!displayName)
        return [{ ...reject('student.name_missing', raw.sname, true), column: 'sname', legacyKey }];
      // Students sign in through the school-issued identity, never through the guardian's mobile.
      return {
        legacyKey,
        legacyYear: raw.FinancialYear ? String(raw.FinancialYear) : undefined,
        row: {
          legacyTable: 'student_master',
          legacyKey,
          oneauthSub: subjectFor(schoolCode, 'student_master', key, null),
          displayName,
          mobile: null,
          email: null,
          personType: 'student',
          status: activeStatus(raw.status, raw.isTrash),
          suggestedRole: 'student',
          legacyRef: key,
        },
      };
    },
  };
}

/** One guardian user per distinct guardian mobile; students without any guardian mobile are reported, not blocked. */
export function guardianStep(schoolCode: string): Step<RawStudent, PersonRow> {
  return {
    legacyTable: 'student_master',
    transform(raw): Transformed<PersonRow> | Rejects {
      const key = text(raw.sadmission) ?? '';
      const legacyKey = `sadmission=${key}#guardian`;
      const candidates: Array<[unknown, unknown]> = [
        [raw.guardianmobile, raw.guardianname],
        [raw.fathermobile, raw.fathername],
        [raw.mothermobile, raw.mothername],
        [raw.smobile, raw.fathername ?? raw.mothername ?? raw.guardianname],
      ];
      for (const [m, n] of candidates) {
        const mobile = normaliseMobile(m);
        if (mobile.kind === 'ok' && mobile.value) {
          const displayName = name(n) ?? `Guardian of ${name(raw.sname) ?? key}`;
          return {
            legacyKey,
            legacyYear: raw.FinancialYear ? String(raw.FinancialYear) : undefined,
            row: {
              legacyTable: 'student_master',
              legacyKey,
              oneauthSub: subjectFor(schoolCode, 'student_master', key, mobile.value),
              displayName,
              mobile: mobile.value,
              email: null,
              personType: 'guardian',
              status: activeStatus(raw.status, raw.isTrash),
              suggestedRole: 'parent',
              legacyRef: key,
            },
          };
        }
      }
      return [
        {
          ...reject('guardian.mobile_missing', raw.smobile ?? raw.fathermobile ?? null, false),
          column: 'smobile',
          legacyKey,
        },
      ];
    },
  };
}

/** Upserts users by One Auth subject and memberships by (school, user, person type). Idempotent. */
export class UsersLoader implements Loader<PersonRow> {
  readonly targetTable = 'users';

  async load(client: PoolClient, rows: Array<Transformed<PersonRow>>): Promise<string[]> {
    const ids: string[] = [];
    for (const { row } of rows) {
      const u = await client.query<{ id: string }>(
        `INSERT INTO users (oneauth_sub, display_name, mobile, email, status, legacy_ref)
         VALUES ($1, $2, $3, $4, $5::row_status, $6)
         ON CONFLICT (oneauth_sub) DO UPDATE
           SET display_name = CASE WHEN users.display_name LIKE 'Guardian of %' THEN EXCLUDED.display_name ELSE users.display_name END,
               mobile = COALESCE(users.mobile, EXCLUDED.mobile),
               email = COALESCE(users.email, EXCLUDED.email),
               legacy_ref = COALESCE(users.legacy_ref, EXCLUDED.legacy_ref),
               updated_at = now()
         RETURNING id::text`,
        [row.oneauthSub, row.displayName, row.mobile, row.email, row.status, row.legacyRef],
      );
      const userId = u.rows[0]!.id;
      await client.query(
        `INSERT INTO user_school_memberships (school_id, user_id, person_type, status)
         VALUES (app.current_school_id(), $1, $2::person_type, $3::row_status)
         ON CONFLICT (school_id, user_id, person_type) DO UPDATE SET status = EXCLUDED.status, deleted_at = NULL, updated_at = now()`,
        [userId, row.personType, row.status],
      );
      ids.push(userId);
    }
    return ids;
  }
}
