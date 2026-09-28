/**
 * Domain 3 (docs/data/03-etl-framework.md section 4): student_master to students, guardians and enrolments;
 * employee_master to employees and postings. Identity users come from domain 2; here the person records are
 * created and linked to those users by legacy reference.
 */
import type { PoolClient } from 'pg';
import type { Loader, Step, Transformed } from '../pipeline';
import { reject, type Reject } from '../reject';
import {
  normaliseDate,
  normaliseEmail,
  normaliseMobile,
  normaliseStatus,
  repairMojibake,
  splitLegacySection,
  text,
  yesNoToBoolean,
} from '../transforms';
import type { RawEmployee, RawStudent } from './identity';

type Rejects = Array<Reject & { column?: string; legacyKey?: string }>;

const name = (v: unknown): string | null => {
  const t = text(repairMojibake(v));
  return t && t.length >= 1 ? t : null;
};

function splitName(full: string): { first: string; last: string | null } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0]!, last: null };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1]! };
}

function activeStatus(status: unknown, isTrash: unknown): 'active' | 'inactive' {
  const trash = yesNoToBoolean(isTrash);
  if (trash.kind === 'ok' && trash.value === true) return 'inactive';
  const s = normaliseStatus(status);
  return s.kind === 'ok' && s.value === 'inactive' ? 'inactive' : 'active';
}

function gender(v: unknown): 'male' | 'female' | 'other' | 'unspecified' {
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  if (s === 'm' || s === 'male' || s === 'boy') return 'male';
  if (s === 'f' || s === 'female' || s === 'girl') return 'female';
  if (s === '') return 'unspecified';
  return 'other';
}

// ---- students ------------------------------------------------------------------------------------
export interface StudentRecord {
  admissionNo: string;
  firstName: string;
  lastName: string | null;
  dob: string | null;
  gender: 'male' | 'female' | 'other' | 'unspecified';
  category: string | null;
  status: 'active' | 'inactive';
  legacyYear: string | null;
  /** Guardian to link (father, mother or named guardian, first with a mobile). */
  guardian: {
    firstName: string;
    lastName: string | null;
    mobile: string | null;
    email: string | null;
    relation: 'father' | 'mother' | 'guardian';
  } | null;
  /** Legacy section label such as 'VI-A' for the enrolment of the legacy year. */
  section: { classCode: string; section: string | null } | null;
  rollNo: number | null;
}

export interface RawStudentFull extends RawStudent {
  DOB?: string;
  Sex?: string;
  Category?: string;
  srollno?: string | number;
  MasterClass?: string;
}

export const studentRecordStep: Step<RawStudentFull, StudentRecord> = {
  legacyTable: 'student_master',
  transform(raw): Transformed<StudentRecord> | Rejects {
    const key = text(raw.sadmission);
    if (!key)
      return [
        { ...reject('student.admission_missing', raw.sadmission, true), column: 'sadmission' },
      ];
    const legacyKey = `sadmission=${key}`;
    const full = name(raw.sname);
    if (!full)
      return [{ ...reject('student.name_missing', raw.sname, true), column: 'sname', legacyKey }];
    const { first, last } = splitName(full);
    const dob = normaliseDate(raw.DOB);
    const rejects: Rejects = [];
    if (dob.kind === 'reject') rejects.push({ ...dob, column: 'DOB', legacyKey });
    const section = splitLegacySection(raw.sclass);
    if (section.kind === 'reject' && raw.sclass)
      rejects.push({ ...section, column: 'sclass', legacyKey });
    if (rejects.some((r) => r.blocking)) return rejects;

    const candidates: Array<[unknown, unknown, 'father' | 'mother' | 'guardian']> = [
      [raw.fathermobile, raw.fathername, 'father'],
      [raw.mothermobile, raw.mothername, 'mother'],
      [raw.guardianmobile, raw.guardianname, 'guardian'],
      [raw.smobile, raw.fathername ?? raw.mothername ?? raw.guardianname, 'guardian'],
    ];
    let guardian: StudentRecord['guardian'] = null;
    for (const [m, n, relation] of candidates) {
      const mobile = normaliseMobile(m);
      const gname = name(n);
      if ((mobile.kind === 'ok' && mobile.value) || gname) {
        const split = gname ? splitName(gname) : { first: `Guardian of ${full}`, last: null };
        const email = normaliseEmail(raw.email);
        guardian = {
          firstName: split.first,
          lastName: split.last,
          mobile: mobile.kind === 'ok' ? mobile.value : null,
          email: email.kind === 'ok' ? email.value : null,
          relation,
        };
        break;
      }
    }
    const roll = Number(raw.srollno);
    return {
      legacyKey,
      legacyYear: raw.FinancialYear ? String(raw.FinancialYear) : undefined,
      row: {
        admissionNo: key,
        firstName: first,
        lastName: last,
        dob: dob.kind === 'ok' ? dob.value : null,
        gender: gender(raw.Sex),
        category: text(raw.Category),
        status: activeStatus(raw.status, raw.isTrash),
        legacyYear: raw.FinancialYear ? String(raw.FinancialYear) : null,
        guardian,
        section: section.kind === 'ok' ? section.value : null,
        rollNo: Number.isInteger(roll) && roll > 0 ? roll : null,
      },
    };
  },
};

/**
 * Upserts the student, links the guardian (reused by mobile) and, when the legacy year maps to a target
 * academic year and the section exists there, writes the enrolment. Rows whose section is missing are
 * loaded without an enrolment and counted in the reconciliation report.
 */
export class StudentsLoader implements Loader<StudentRecord> {
  readonly targetTable = 'students';
  readonly unresolvedSections = new Map<string, number>();

  async load(client: PoolClient, rows: Array<Transformed<StudentRecord>>): Promise<string[]> {
    const ids: string[] = [];
    for (const { row, legacyYear } of rows) {
      const s = await client.query<{ id: string }>(
        `INSERT INTO students (school_id, admission_no, first_name, last_name, dob, gender, category, status, legacy_ref,
                               user_id)
         VALUES (app.current_school_id(), $1, $2, $3, $4::date, $5::gender, $6, $7::row_status, $8,
                 (SELECT u.id FROM users u WHERE u.legacy_ref = $8 AND u.oneauth_sub LIKE 'legacy:%' LIMIT 1))
         ON CONFLICT (school_id, admission_no) DO UPDATE
           SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, dob = COALESCE(EXCLUDED.dob, students.dob),
               gender = EXCLUDED.gender, category = COALESCE(EXCLUDED.category, students.category), status = EXCLUDED.status, updated_at = now()
         RETURNING id::text`,
        [
          row.admissionNo,
          row.firstName,
          row.lastName,
          row.dob,
          row.gender,
          row.category,
          row.status,
          row.admissionNo,
        ],
      );
      const studentId = s.rows[0]!.id;
      ids.push(studentId);

      if (row.guardian) {
        const g = row.guardian;
        const existing = g.mobile
          ? await client.query<{ id: string }>(
              'SELECT id::text FROM guardians WHERE mobile = $1 AND deleted_at IS NULL AND school_id = app.current_school_id() ORDER BY id LIMIT 1',
              [g.mobile],
            )
          : { rows: [] as Array<{ id: string }> };
        let guardianId = existing.rows[0]?.id;
        if (!guardianId) {
          const ins = await client.query<{ id: string }>(
            `INSERT INTO guardians (school_id, first_name, last_name, mobile, email, legacy_ref,
                                    user_id)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5,
                     (SELECT u.id FROM users u WHERE $3::text IS NOT NULL AND u.oneauth_sub = 'pending:' || $3::text LIMIT 1))
             RETURNING id::text`,
            [g.firstName, g.lastName, g.mobile, g.email, row.admissionNo],
          );
          guardianId = ins.rows[0]!.id;
        }
        await client.query(
          `INSERT INTO student_guardians (school_id, student_id, guardian_id, relation, is_primary)
           VALUES (app.current_school_id(), $1, $2, $3::guardian_relation, true)
           ON CONFLICT (student_id, guardian_id) DO NOTHING`,
          [studentId, guardianId, g.relation],
        );
      }

      if (row.section && legacyYear) {
        // A class without a section cannot be placed; it is reported, never guessed.
        const target = row.section.section
          ? await client.query<{ year_id: string; section_id: string | null }>(
              `SELECT y.id::text AS year_id,
                      (SELECT cs.id::text FROM class_sections cs JOIN classes c ON c.id = cs.class_id
                        WHERE cs.academic_year_id = y.id AND cs.deleted_at IS NULL AND cs.school_id = app.current_school_id() AND upper(c.code) = upper($2)
                          AND upper(cs.name) = upper($3) LIMIT 1) AS section_id
                 FROM academic_years y WHERE y.school_id = app.current_school_id() AND (y.legacy_ref = $1 OR y.code = $1) LIMIT 1`,
              [legacyYear, row.section.classCode, row.section.section],
            )
          : { rows: [] as Array<{ year_id: string; section_id: string | null }> };
        const t = target.rows[0];
        if (t?.section_id) {
          await client.query(
            `INSERT INTO enrolments (school_id, student_id, academic_year_id, class_section_id, roll_no, status)
             VALUES (app.current_school_id(), $1, $2, $3, $4, CASE WHEN $5::row_status = 'active' THEN 'active' ELSE 'left' END::enrolment_status)
             ON CONFLICT (student_id, academic_year_id) DO UPDATE SET class_section_id = EXCLUDED.class_section_id, roll_no = EXCLUDED.roll_no, updated_at = now()`,
            [studentId, t.year_id, t.section_id, row.rollNo, row.status],
          );
        } else {
          const label = `${legacyYear}:${row.section.classCode}${row.section.section ? '-' + row.section.section : ''}`;
          this.unresolvedSections.set(label, (this.unresolvedSections.get(label) ?? 0) + 1);
        }
      }
    }
    return ids;
  }
}

// ---- employees -----------------------------------------------------------------------------------
export interface EmployeeRecord {
  employeeCode: string;
  firstName: string;
  lastName: string | null;
  designation: string | null;
  department: string | null;
  employeeType: 'teaching' | 'non_teaching' | 'contract' | 'visiting';
  joinedOn: string | null;
  mobile: string | null;
  email: string | null;
  status: 'active' | 'inactive';
  legacyYear: string | null;
  reportsToEmpId: string | null;
}

export interface RawEmployeeFull extends RawEmployee {
  DOJ?: string;
  employeetype?: string;
  L1_Approver_Id?: string | number;
}

function employeeType(v: unknown, designation: string | null): EmployeeRecord['employeeType'] {
  const s = String(v ?? '').toLowerCase();
  if (s.includes('contract')) return 'contract';
  if (s.includes('visit') || s.includes('guest')) return 'visiting';
  if (s.includes('non') || s.includes('admin') || s.includes('support')) return 'non_teaching';
  if (s.includes('teach')) return 'teaching';
  return designation && /teacher|pgt|tgt|prt|lecturer/i.test(designation)
    ? 'teaching'
    : 'non_teaching';
}

export const employeeRecordStep: Step<RawEmployeeFull, EmployeeRecord> = {
  legacyTable: 'employee_master',
  transform(raw): Transformed<EmployeeRecord> | Rejects {
    const key = text(raw.EmpId);
    if (!key) return [{ ...reject('employee.empid_missing', raw.EmpId, true), column: 'EmpId' }];
    const legacyKey = `EmpId=${key}`;
    const full = name(raw.Name);
    if (!full)
      return [{ ...reject('employee.name_missing', raw.Name, true), column: 'Name', legacyKey }];
    const { first, last } = splitName(full);
    const mobile = normaliseMobile(raw.MobileNo);
    const email = normaliseEmail(raw.Email_Id);
    const doj = normaliseDate(raw.DOJ);
    const designation = text(raw.Designation);
    const approver = text(raw.L1_Approver_Id);
    return {
      legacyKey,
      legacyYear: raw.FinancialYear ? String(raw.FinancialYear) : undefined,
      row: {
        employeeCode: key,
        firstName: first,
        lastName: last,
        designation,
        department: text(raw.Department),
        employeeType: employeeType(raw.employeetype, designation),
        joinedOn: doj.kind === 'ok' ? doj.value : null,
        mobile: mobile.kind === 'ok' ? mobile.value : null,
        email: email.kind === 'ok' ? email.value : null,
        status: activeStatus(raw.Status, raw.isTrash),
        legacyYear: raw.FinancialYear ? String(raw.FinancialYear) : null,
        reportsToEmpId: approver && approver !== key && approver !== '0' ? approver : null,
      },
    };
  },
};

/** Upserts the employee and the posting of the legacy year; reporting lines resolve when the approver exists. */
export class EmployeesLoader implements Loader<EmployeeRecord> {
  readonly targetTable = 'employees';

  async load(client: PoolClient, rows: Array<Transformed<EmployeeRecord>>): Promise<string[]> {
    const ids: string[] = [];
    for (const { row, legacyYear } of rows) {
      const e = await client.query<{ id: string }>(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, employee_type, designation, department, joined_on, mobile, email, status, legacy_ref,
                                user_id)
         VALUES (app.current_school_id(), $1, $2, $3, $4::employee_type, $5, $6, $7::date, $8, $9, $10::row_status, $1,
                 (SELECT u.id FROM users u WHERE u.legacy_ref = $1 AND (u.oneauth_sub = 'pending:' || coalesce($8, '') OR u.oneauth_sub LIKE 'legacy:%') ORDER BY (u.oneauth_sub LIKE 'pending:%') DESC LIMIT 1))
         ON CONFLICT (school_id, employee_code) DO UPDATE
           SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, designation = COALESCE(EXCLUDED.designation, employees.designation),
               department = COALESCE(EXCLUDED.department, employees.department), joined_on = COALESCE(employees.joined_on, EXCLUDED.joined_on),
               mobile = COALESCE(EXCLUDED.mobile, employees.mobile), email = COALESCE(EXCLUDED.email, employees.email), status = EXCLUDED.status, updated_at = now()
         RETURNING id::text`,
        [
          row.employeeCode,
          row.firstName,
          row.lastName,
          row.employeeType,
          row.designation,
          row.department,
          row.joinedOn,
          row.mobile,
          row.email,
          row.status,
        ],
      );
      const employeeId = e.rows[0]!.id;
      ids.push(employeeId);
      if (legacyYear) {
        await client.query(
          `INSERT INTO postings (school_id, employee_id, academic_year_id, department, designation, reports_to_employee_id, valid_from)
           SELECT app.current_school_id(), $1, y.id, $2, $3,
                  (SELECT em.id FROM employees em WHERE em.employee_code = $4 AND em.deleted_at IS NULL AND em.school_id = app.current_school_id() LIMIT 1), y.start_date
             FROM academic_years y WHERE y.school_id = app.current_school_id() AND (y.legacy_ref = $5 OR y.code = $5) LIMIT 1
           ON CONFLICT (employee_id, academic_year_id) DO UPDATE
             SET department = COALESCE(EXCLUDED.department, postings.department), designation = COALESCE(EXCLUDED.designation, postings.designation),
                 reports_to_employee_id = COALESCE(EXCLUDED.reports_to_employee_id, postings.reports_to_employee_id), updated_at = now()`,
          [employeeId, row.department, row.designation, row.reportsToEmpId, legacyYear],
        );
      }
    }
    return ids;
  }
}
