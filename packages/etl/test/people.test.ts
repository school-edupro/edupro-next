import { Client, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EmployeesLoader,
  MemorySource,
  StudentsLoader,
  employeeRecordStep,
  runStep,
  studentRecordStep,
  tenancyStep,
  YearsLoader,
  type EmployeeRecord,
  type RawEmployeeFull,
  type RawStudentFull,
  type StudentRecord,
} from '../src';

const students: RawStudentFull[] = [
  {
    sadmission: 'R2401',
    sname: 'Aarav Kumar Sharma',
    DOB: '14/06/2015',
    Sex: 'M',
    Category: 'GEN',
    sclass: 'VI-A',
    srollno: 7,
    fathername: 'Suresh Sharma',
    fathermobile: '98765 43210',
    status: 'Active',
    FinancialYear: '2025',
  },
  {
    sadmission: 'R2402',
    sname: 'Diya Sharma',
    DOB: '2017-01-02',
    Sex: 'F',
    sclass: 'IV-B',
    srollno: '3',
    fathername: 'Suresh Sharma',
    fathermobile: '9876543210',
    status: 'Active',
    FinancialYear: '2025',
  },
  {
    sadmission: 'R2403',
    sname: 'Kavya',
    Sex: 'F',
    sclass: 'VI',
    mothername: 'Latha Nair',
    mothermobile: '9000000002',
    status: 'Inactive',
    isTrash: 'N',
    FinancialYear: '2025',
  },
  { sadmission: '', sname: 'No admission', FinancialYear: '2025' },
];

const employees: RawEmployeeFull[] = [
  {
    EmpId: 'E001',
    Name: 'Meena Iyer',
    Designation: 'Principal',
    Department: 'Administration',
    employeetype: 'Non Teaching',
    DOJ: '01/04/2010',
    MobileNo: '9123456789',
    FinancialYear: '2025',
  },
  {
    EmpId: 'E002',
    Name: 'Rahul Verma',
    Designation: 'PGT Maths',
    Department: 'Science',
    employeetype: 'Teaching',
    L1_Approver_Id: 'E001',
    MobileNo: '9111111111',
    FinancialYear: '2025',
  },
];

describe('people domain transforms', () => {
  it('splits names, maps gender, dates, sections, guardians and roll numbers', () => {
    const rows = students.map((r) => studentRecordStep.transform(r));
    const ok = rows.filter((r) => !Array.isArray(r)) as Array<{
      row: StudentRecord;
      legacyYear?: string;
    }>;
    expect(ok).toHaveLength(3);
    expect(ok[0]!.row).toMatchObject({
      admissionNo: 'R2401',
      firstName: 'Aarav Kumar',
      lastName: 'Sharma',
      dob: '2015-06-14',
      gender: 'male',
      category: 'GEN',
      rollNo: 7,
      section: { classCode: 'VI', section: 'A' },
    });
    expect(ok[0]!.row.guardian).toMatchObject({
      firstName: 'Suresh',
      lastName: 'Sharma',
      mobile: '9876543210',
      relation: 'father',
    });
    expect(ok[1]!.row).toMatchObject({ rollNo: 3, section: { classCode: 'IV', section: 'B' } });
    expect(ok[2]!.row).toMatchObject({
      firstName: 'Kavya',
      lastName: null,
      status: 'inactive',
      section: { classCode: 'VI', section: null },
      guardian: { relation: 'mother', mobile: '9000000002' },
    });
    expect(rows.filter(Array.isArray)).toHaveLength(1);
  });

  it('classifies employees and keeps the approver as the reporting line', () => {
    const rows = employees.map((r) => employeeRecordStep.transform(r)) as Array<{
      row: EmployeeRecord;
    }>;
    expect(rows[0]!.row).toMatchObject({
      employeeCode: 'E001',
      employeeType: 'non_teaching',
      joinedOn: '2010-04-01',
      reportsToEmpId: null,
    });
    expect(rows[1]!.row).toMatchObject({
      employeeCode: 'E002',
      employeeType: 'teaching',
      reportsToEmpId: 'E001',
      mobile: '9111111111',
    });
  });
});

const MIGRATOR_URL = process.env.DATABASE_MIGRATOR_URL;

describe.skipIf(!MIGRATOR_URL)('people domain against PostgreSQL', () => {
  let pg: Client;
  let schoolId: string;
  const code = `ETP${Date.now().toString(36).toUpperCase()}`;

  const withTenant = async <T>(fn: (c: PoolClient) => Promise<T>): Promise<T> => {
    await pg.query('BEGIN');
    try {
      await pg.query(
        "SELECT set_config('app.school_id', $1, true), set_config('app.allowed_school_ids', $2, true)",
        [schoolId, `{${schoolId}}`],
      );
      const out = await fn(pg as unknown as PoolClient);
      await pg.query('COMMIT');
      return out;
    } catch (error) {
      await pg.query('ROLLBACK');
      throw error;
    }
  };

  beforeAll(async () => {
    pg = new Client({ connectionString: MIGRATOR_URL });
    await pg.connect();
    const r = await pg.query<{ id: string }>(
      'INSERT INTO schools (code, name, short_name) VALUES ($1, $1, $1) RETURNING id::text',
      [code],
    );
    schoolId = r.rows[0]!.id;
    // Target structure the ETL maps onto: classes VI and IV with sections A and B in the legacy year 2025.
    const opts = {
      schoolId,
      domain: 'tenancy',
      sourceLabel: 'fixture',
      withTenant,
      withBookkeeping: withTenant,
    };
    await runStep(
      new MemorySource<Record<string, unknown>>({
        FYmaster: [{ financialyear: '2025', Status: 'Active' }],
      }),
      tenancyStep,
      new YearsLoader('academic'),
      opts,
    );
    await withTenant(async (c) => {
      const y = await c.query<{ id: string }>(
        "SELECT id::text FROM academic_years WHERE legacy_ref = '2025' AND school_id = app.current_school_id()",
      );
      for (const [cls, order] of [
        ['VI', 6],
        ['IV', 4],
      ] as const) {
        const k = await c.query<{ id: string }>(
          'INSERT INTO classes (school_id, code, name, display_order) VALUES (app.current_school_id(), $1, $2, $3) RETURNING id::text',
          [cls, `Class ${cls}`, order],
        );
        for (const sec of ['A', 'B'])
          await c.query(
            'INSERT INTO class_sections (school_id, academic_year_id, class_id, name) VALUES (app.current_school_id(), $1, $2, $3)',
            [y.rows[0]!.id, k.rows[0]!.id, sec],
          );
      }
    });
  });
  afterAll(() => pg.end());

  it('loads students with guardians and enrolments, employees with postings, and reports unresolved sections', async () => {
    const source = new MemorySource<Record<string, unknown>>({
      student_master: students,
      employee_master: employees,
    });
    const opts = {
      schoolId,
      domain: 'people',
      sourceLabel: 'fixture',
      withTenant,
      withBookkeeping: withTenant,
    };
    const loader = new StudentsLoader();
    const report = await runStep(source, studentRecordStep, loader, opts);
    expect(report).toMatchObject({ extracted: 4, loaded: 3, rejected: 1 });
    expect([...loader.unresolvedSections.entries()]).toEqual([['2025:VI', 1]]); // Kavya has a class but no section
    const counts = await pg.query<{
      students: string;
      guardians: string;
      enrolments: string;
      links: string;
    }>(
      `SELECT (SELECT count(*) FROM students WHERE school_id = $1)::text AS students,
              (SELECT count(*) FROM guardians WHERE school_id = $1)::text AS guardians,
              (SELECT count(*) FROM enrolments WHERE school_id = $1)::text AS enrolments,
              (SELECT count(*) FROM student_guardians WHERE school_id = $1)::text AS links`,
      [schoolId],
    );
    expect(counts.rows[0]).toEqual({ students: '3', guardians: '2', enrolments: '2', links: '3' });
    const siblings = await pg.query(
      'SELECT count(*)::int AS n FROM student_siblings WHERE school_id = $1',
      [schoolId],
    );
    expect(siblings.rows[0].n).toBe(2);

    const emp = await runStep(source, employeeRecordStep, new EmployeesLoader(), opts);
    expect(emp).toMatchObject({ extracted: 2, loaded: 2, rejected: 0 });
    const postings = await pg.query<{ code: string; reports_to: string | null }>(
      `SELECT em.employee_code AS code, mgr.employee_code AS reports_to FROM postings p JOIN employees em ON em.id = p.employee_id
         LEFT JOIN employees mgr ON mgr.id = p.reports_to_employee_id WHERE p.school_id = $1 ORDER BY em.employee_code`,
      [schoolId],
    );
    expect(postings.rows).toEqual([
      { code: 'E001', reports_to: null },
      { code: 'E002', reports_to: 'E001' },
    ]);

    // Rerun is idempotent.
    await runStep(source, studentRecordStep, new StudentsLoader(), opts);
    await runStep(source, employeeRecordStep, new EmployeesLoader(), opts);
    const again = await pg.query(
      'SELECT (SELECT count(*) FROM students WHERE school_id = $1)::int AS s, (SELECT count(*) FROM enrolments WHERE school_id = $1)::int AS e, (SELECT count(*) FROM postings WHERE school_id = $1)::int AS p',
      [schoolId],
    );
    expect(again.rows[0]).toEqual({ s: 3, e: 2, p: 2 });
  });
});
