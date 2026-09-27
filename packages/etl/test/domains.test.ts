import { Client, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MemorySource,
  UsersLoader,
  YearsLoader,
  adminStep,
  employeeStep,
  guardianStep,
  provisioningRows,
  runStep,
  studentStep,
  tenancyStep,
  toProvisioningCsv,
  type PersonRow,
  type RawEmployee,
  type RawFyMaster,
  type RawStudent,
} from '../src';

const fy: RawFyMaster[] = [
  { srno: 1, financialyear: '2023', Status: 'Inactive', FinancialYearName: 'Session 2023-24' },
  { srno: 2, financialyear: '2024-25', Status: 'Inactive' },
  {
    srno: 3,
    financialyear: '2025-26',
    Status: 'Active',
    FinancialYearName: 'Academic Year 2025-26',
  },
  { srno: 4, financialyear: 'abc', Status: 0 },
];

const employees: RawEmployee[] = [
  {
    EmpId: 'E001',
    Name: 'Meena Iyer',
    MobileNo: '98765 43210',
    Email_Id: 'Meena@School.Org',
    role: 'Teacher',
    ClassTeacher: 'VI-A',
    FinancialYear: '2024',
  },
  {
    EmpId: 'E001',
    Name: 'Meena Iyer',
    MobileNo: '9876543210',
    Email_Id: 'meena@school.org',
    role: 'Teacher',
    ClassTeacher: 'VII-A',
    FinancialYear: '2025',
  },
  {
    EmpId: 'E002',
    Name: 'Rahul Verma',
    MobileNo: '+91 91234 56789',
    role: 'Admin',
    FinancialYear: '2025',
  },
  { EmpId: 'E003', Name: 'Old Staff', MobileNo: '', isTrash: 'Y', FinancialYear: '2025' },
  { EmpId: '', Name: 'No id', FinancialYear: '2025' },
];

const students: RawStudent[] = [
  {
    sadmission: 'R2401',
    sname: 'Aarav Sharma',
    fathername: 'Suresh Sharma',
    fathermobile: '9000000001',
    status: 'Active',
    FinancialYear: '2025',
  },
  {
    sadmission: 'R2402',
    sname: 'Diya Sharma',
    fathername: 'Suresh Sharma',
    fathermobile: '9000000001',
    status: 'Active',
    FinancialYear: '2025',
  },
  {
    sadmission: 'R2403',
    sname: 'Kavya Nair',
    mothername: 'Latha Nair',
    mothermobile: '9000000002',
    status: 'Active',
    FinancialYear: '2025',
  },
  { sadmission: 'R2404', sname: 'Orphan Row', status: 'Active', FinancialYear: '2025' },
];

describe('tenancy domain (FYmaster to years)', () => {
  it('maps legacy year strings, session dates and status; rejects garbage', () => {
    const rows = fy.map((r) => tenancyStep.transform(r));
    const ok = rows.filter((r) => !Array.isArray(r)) as Array<{
      row: { code: string; status: string; startDate: string; endDate: string; name: string };
    }>;
    expect(ok.map((r) => r.row.code)).toEqual(['2023-24', '2024-25', '2025-26']);
    expect(ok.map((r) => r.row.status)).toEqual(['closed', 'closed', 'active']);
    expect(ok[0]!.row).toMatchObject({
      startDate: '2023-04-01',
      endDate: '2024-03-31',
      name: 'Session 2023-24',
    });
    expect(ok[1]!.row.name).toBe('Session 2024-25');
    const rejected = rows.filter(Array.isArray);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]![0]).toMatchObject({
      reason: 'year.unparseable',
      blocking: true,
      column: 'financialyear',
    });
  });
});

describe('identity domain (people to users and memberships)', () => {
  it('normalises employees, keys them by mobile, keeps per-year rows idempotent and suggests roles', () => {
    const step = employeeStep('ALPHA');
    const out = employees.map((r) => step.transform(r));
    const ok = out.filter((r) => !Array.isArray(r)) as Array<{
      row: PersonRow;
      legacyYear?: string;
    }>;
    expect(ok).toHaveLength(4);
    expect(ok[0]!.row).toMatchObject({
      oneauthSub: 'pending:9876543210',
      email: 'meena@school.org',
      suggestedRole: 'class_teacher',
      status: 'active',
    });
    expect(ok[1]!.row.oneauthSub).toBe(ok[0]!.row.oneauthSub);
    expect(ok[1]!.legacyYear).toBe('2025');
    expect(ok[2]!.row).toMatchObject({ mobile: '9123456789', suggestedRole: 'school_admin' });
    expect(ok[3]!.row).toMatchObject({
      oneauthSub: 'legacy:ALPHA:employee_master:E003',
      status: 'inactive',
      mobile: null,
    });
    const rejected = out.filter(Array.isArray);
    expect(rejected[0]![0]).toMatchObject({ reason: 'employee.empid_missing', blocking: true });
  });

  it('creates students without a login of their own and one guardian per mobile', () => {
    const s = students
      .map((r) => studentStep('ALPHA').transform(r))
      .filter((r) => !Array.isArray(r)) as Array<{ row: PersonRow }>;
    expect(s.map((x) => x.row.oneauthSub)).toEqual([
      'legacy:ALPHA:student_master:R2401',
      'legacy:ALPHA:student_master:R2402',
      'legacy:ALPHA:student_master:R2403',
      'legacy:ALPHA:student_master:R2404',
    ]);
    const g = students.map((r) => guardianStep('ALPHA').transform(r));
    const guardians = g.filter((r) => !Array.isArray(r)) as Array<{ row: PersonRow }>;
    expect(guardians.map((x) => x.row.oneauthSub)).toEqual([
      'pending:9000000001',
      'pending:9000000001',
      'pending:9000000002',
    ]);
    expect(guardians[0]!.row).toMatchObject({
      displayName: 'Suresh Sharma',
      personType: 'guardian',
      suggestedRole: 'parent',
    });
    const missing = g.filter(Array.isArray);
    expect(missing[0]![0]).toMatchObject({ reason: 'guardian.mobile_missing', blocking: false });
  });

  it('produces the One Auth provisioning list without duplicates', () => {
    const rows: PersonRow[] = [
      ...(
        employees
          .map((r) => employeeStep('ALPHA').transform(r))
          .filter((r) => !Array.isArray(r)) as Array<{ row: PersonRow }>
      ).map((x) => x.row),
      ...(
        students
          .map((r) => guardianStep('ALPHA').transform(r))
          .filter((r) => !Array.isArray(r)) as Array<{ row: PersonRow }>
      ).map((x) => x.row),
    ];
    const list = provisioningRows(rows);
    expect(list.map((r) => r.mobile)).toEqual([
      '9876543210',
      '9123456789',
      '',
      '9000000001',
      '9000000002',
    ]);
    const csv = toProvisioningCsv(list);
    expect(csv).toContain(
      'legacy_table,legacy_key,display_name,mobile,email,person_type,suggested_role,status',
    );
    expect(csv).toContain(
      'employee_master,EmpId=E001,Meena Iyer,9876543210,meena@school.org,employee,class_teacher,active',
    );
  });
});

const MIGRATOR_URL = process.env.DATABASE_MIGRATOR_URL;

describe.skipIf(!MIGRATOR_URL)('identity domain against PostgreSQL', () => {
  let pg: Client;
  let schoolId: string;
  const code = `ETL${Date.now().toString(36).toUpperCase()}`;

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
  });
  afterAll(() => pg.end());

  it('loads years and people idempotently with legacy map and reconciliation bookkeeping', async () => {
    const source = new MemorySource<Record<string, unknown>>({
      FYmaster: fy,
      admin: [{ suser: 'principal', sname: 'Principal', smobile: '9111111111' }],
      employee_master: employees,
      student_master: students,
    });
    const opts = {
      schoolId,
      domain: 'identity',
      sourceLabel: 'fixture',
      withTenant,
      withBookkeeping: withTenant,
    };
    const years = await runStep(source, tenancyStep, new YearsLoader('academic'), opts);
    expect(years).toMatchObject({ extracted: 4, loaded: 3, rejected: 1, blockingRejects: 1 });
    const loader = new UsersLoader();
    await runStep(source, adminStep(code), loader, opts);
    const emp = await runStep(source, employeeStep(code), loader, opts);
    expect(emp).toMatchObject({ extracted: 5, loaded: 4, rejected: 1 });
    await runStep(source, studentStep(code), loader, opts);
    const guardians = await runStep(source, guardianStep(code), loader, opts);
    expect(guardians).toMatchObject({ extracted: 4, loaded: 3, rejected: 1, blockingRejects: 0 });

    const counts = async () =>
      (
        await pg.query<{ person_type: string; n: string }>(
          'SELECT person_type::text, count(*)::text AS n FROM user_school_memberships WHERE school_id = $1 GROUP BY 1 ORDER BY 1',
          [schoolId],
        )
      ).rows;
    const first = await counts();
    expect(first).toEqual([
      { person_type: 'employee', n: '4' },
      { person_type: 'guardian', n: '2' },
      { person_type: 'student', n: '4' },
    ]);
    // second run: same counts, updated legacy map
    await runStep(source, employeeStep(code), loader, opts);
    await runStep(source, guardianStep(code), loader, opts);
    expect(await counts()).toEqual(first);
    const map = await pg.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM etl.legacy_map WHERE school_id = $1 AND legacy_table = 'employee_master'",
      [schoolId],
    );
    expect(Number(map.rows[0]!.n)).toBe(4); // E001 in two legacy years, E002, E003; the rejected row has no entry
    const runs = await pg.query<{ status: string }>(
      'SELECT status FROM etl.runs WHERE school_id = $1',
      [schoolId],
    );
    expect(runs.rows.every((r) => r.status === 'succeeded')).toBe(true);
    const yearRows = await pg.query<{ code: string; status: string }>(
      'SELECT code, status::text FROM academic_years WHERE school_id = $1 ORDER BY code',
      [schoolId],
    );
    expect(yearRows.rows).toEqual([
      { code: '2023-24', status: 'closed' },
      { code: '2024-25', status: 'closed' },
      { code: '2025-26', status: 'active' },
    ]);
  });
});
