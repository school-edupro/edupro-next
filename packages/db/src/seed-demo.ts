/**
 * Demo seed: realistic sample data for two schools plus one developer login per role, so every screen
 * can be checked from the viewpoint of an administrator, a coordinator, a class teacher, a subject
 * teacher, an auditor, a support engineer, a front-office clerk, a parent and a student.
 *
 * Runs as the migrator (bypasses row-level security through the migrator policies). Idempotent: rerunning
 * refreshes users, roles and settings and leaves existing people data untouched. Never run outside
 * development; it refuses when NODE_ENV=production.
 *
 * Usage: DATABASE_MIGRATOR_URL=postgresql://... tsx src/seed-demo.ts
 * Sign in with the development bypass using the subjects printed at the end (dev-admin, dev-teacher, ...).
 */
import { Client } from 'pg';

interface DemoUser {
  sub: string;
  name: string;
  mobile: string;
  email: string;
  personType: 'employee' | 'guardian' | 'student' | 'external';
  /** Template or school role codes per school code. */
  roles: Record<string, string[]>;
  description: string;
}

const DEMO_USERS: DemoUser[] = [
  {
    sub: 'dev-admin',
    name: 'Dev Admin',
    mobile: '9999999999',
    email: 'dev-admin@example.test',
    personType: 'employee',
    roles: { ALPHA: ['school_admin'], BETA: ['school_admin'] },
    description: 'School Admin of both schools (everything except audit export and impersonation)',
  },
  {
    sub: 'dev-group',
    name: 'Gita Group Admin',
    mobile: '9999999901',
    email: 'group@example.test',
    personType: 'employee',
    roles: { ALPHA: ['group_admin'], BETA: ['group_admin'] },
    description:
      'Group Admin: all platform and access permissions in both schools, may impersonate',
  },
  {
    sub: 'dev-principal',
    name: 'Meena Iyer',
    mobile: '9999999902',
    email: 'principal@alpha.example.test',
    personType: 'employee',
    roles: { ALPHA: ['school_admin'] },
    description: 'Principal of Alpha (School Admin), linked to employee E001',
  },
  {
    sub: 'dev-coordinator',
    name: 'Rajesh Kulkarni',
    mobile: '9999999903',
    email: 'coordinator@alpha.example.test',
    personType: 'employee',
    roles: { ALPHA: ['academic_coordinator'] },
    description: 'Academic Coordinator: classes, students, enrolments, exports',
  },
  {
    sub: 'dev-teacher',
    name: 'Anita Deshmukh',
    mobile: '9999999904',
    email: 'anita@alpha.example.test',
    personType: 'employee',
    roles: { ALPHA: ['class_teacher'] },
    description: 'Class Teacher of VI-A only (class_section scope on the role)',
  },
  {
    sub: 'dev-subject',
    name: 'Suresh Nair',
    mobile: '9999999905',
    email: 'suresh@alpha.example.test',
    personType: 'employee',
    roles: { ALPHA: ['subject_teacher'] },
    description: 'Subject Teacher scoped to VI-A and VI-B',
  },
  {
    sub: 'dev-auditor',
    name: 'Priya Auditor',
    mobile: '9999999906',
    email: 'auditor@alpha.example.test',
    personType: 'employee',
    roles: { ALPHA: ['auditor'] },
    description: 'Auditor: read everything, export the audit log (MFA), no writes',
  },
  {
    sub: 'dev-support',
    name: 'Sam Support',
    mobile: '9999999907',
    email: 'support@mobilise.example.test',
    personType: 'external',
    roles: { ALPHA: ['support_engineer'], BETA: ['support_engineer'] },
    description: 'Support Engineer: platform and access views, jobs, security page',
  },
  {
    sub: 'dev-clerk',
    name: 'Kavita Front Office',
    mobile: '9999999908',
    email: 'frontoffice@alpha.example.test',
    personType: 'employee',
    roles: { ALPHA: ['front_office'] },
    description:
      'Front office (school role): students, guardians, enrolments, search, exports, send notifications',
  },
  {
    sub: 'dev-parent',
    name: 'Suresh Sharma',
    mobile: '9876543210',
    email: 'suresh.sharma@example.test',
    personType: 'guardian',
    roles: { ALPHA: ['parent'] },
    description: 'Guardian of two siblings in Alpha (parent app); no admin permissions',
  },
  {
    sub: 'dev-student',
    name: 'Aarav Sharma',
    mobile: '',
    email: '',
    personType: 'student',
    roles: { ALPHA: ['student'] },
    description: 'Student in VI-A (student app); no admin permissions',
  },
  {
    sub: 'dev-nobody',
    name: 'Nobody Member',
    mobile: '9999999910',
    email: 'nobody@alpha.example.test',
    personType: 'external',
    roles: { ALPHA: [] },
    description: 'Member with no roles: shows deny-by-default (empty navigation)',
  },
];

const FIRST_M = [
  'Aarav',
  'Vivaan',
  'Aditya',
  'Vihaan',
  'Arjun',
  'Sai',
  'Reyansh',
  'Ayaan',
  'Krishna',
  'Ishaan',
  'Rohan',
  'Kabir',
  'Dhruv',
  'Yash',
  'Atharv',
  'Rudra',
  'Shaurya',
  'Parth',
  'Nikhil',
  'Manav',
];
const FIRST_F = [
  'Diya',
  'Ananya',
  'Aadhya',
  'Kavya',
  'Saanvi',
  'Anika',
  'Myra',
  'Ira',
  'Riya',
  'Pari',
  'Navya',
  'Sara',
  'Aarohi',
  'Tara',
  'Meera',
  'Nitya',
  'Isha',
  'Kiara',
  'Avni',
  'Zara',
];
const LAST = [
  'Sharma',
  'Verma',
  'Patel',
  'Nair',
  'Iyer',
  'Gupta',
  'Singh',
  'Khan',
  'Reddy',
  'Mehta',
  'Joshi',
  'Kulkarni',
  'Deshmukh',
  'Chauhan',
  'Bhat',
  'Mishra',
  'Das',
  'Roy',
  'Pillai',
  'Rao',
];
const CLASSES = [
  ['I', 'Class I', 1],
  ['II', 'Class II', 2],
  ['III', 'Class III', 3],
  ['IV', 'Class IV', 4],
  ['V', 'Class V', 5],
  ['VI', 'Class VI', 6],
  ['VII', 'Class VII', 7],
  ['VIII', 'Class VIII', 8],
  ['IX', 'Class IX', 9],
  ['X', 'Class X', 10],
] as const;
const DESIGNATIONS: Array<[string, string, string]> = [
  ['E001', 'Principal', 'Administration'],
  ['E002', 'Vice Principal', 'Administration'],
  ['E003', 'Academic Coordinator', 'Academics'],
  ['E004', 'PGT Mathematics', 'Mathematics'],
  ['E005', 'PGT Physics', 'Science'],
  ['E006', 'TGT English', 'English'],
  ['E007', 'TGT Hindi', 'Hindi'],
  ['E008', 'TGT Social Science', 'Social Science'],
  ['E009', 'PRT', 'Primary'],
  ['E010', 'PRT', 'Primary'],
  ['E011', 'PRT', 'Primary'],
  ['E012', 'PET', 'Sports'],
  ['E013', 'Librarian', 'Library'],
  ['E014', 'Counsellor', 'Wellbeing'],
  ['E015', 'Accountant', 'Accounts'],
  ['E016', 'Front Office Executive', 'Administration'],
  ['E017', 'Transport In-charge', 'Transport'],
  ['E018', 'Lab Assistant', 'Science'],
  ['E019', 'IT Administrator', 'IT'],
  ['E020', 'Nurse', 'Wellbeing'],
];

const pick = <T>(arr: readonly T[], i: number): T => arr[i % arr.length]!;
const pad = (n: number, w: number) => String(n).padStart(w, '0');

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production')
    throw new Error('seed-demo refuses to run in production');
  const url = process.env.DATABASE_MIGRATOR_URL;
  if (!url) throw new Error('DATABASE_MIGRATOR_URL is required');
  const c = new Client({ connectionString: url, application_name: 'edupro-seed-demo' });
  await c.connect();
  try {
    await c.query('BEGIN');

    // ---- schools, years, campuses -----------------------------------------------------------------
    const group = await c.query<{ id: string }>(
      `INSERT INTO school_groups (code, name) VALUES ('DEVGRP', 'Development Group') ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id::text`,
    );
    const schools: Record<string, { id: string; yearId: string; campusId: string }> = {};
    for (const [code, name, city] of [
      ['ALPHA', 'Alpha Public School', 'Pune'],
      ['BETA', 'Beta Public School', 'Nagpur'],
    ] as const) {
      const s = await c.query<{ id: string }>(
        `INSERT INTO schools (group_id, code, name, short_name, board, address, contact)
         VALUES ($1, $2, $3, $3, 'CBSE', $4::jsonb, $5::jsonb)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, address = EXCLUDED.address, contact = EXCLUDED.contact RETURNING id::text`,
        [
          group.rows[0]!.id,
          code,
          name,
          JSON.stringify({
            line1: `${code === 'ALPHA' ? '12 MG Road' : '4 Civil Lines'}`,
            city,
            state: 'Maharashtra',
            pincode: code === 'ALPHA' ? '411001' : '440001',
          }),
          JSON.stringify({
            phone: code === 'ALPHA' ? '020-26123456' : '0712-2523456',
            email: `office@${code.toLowerCase()}.example.test`,
            website: `https://${code.toLowerCase()}.example.test`,
          }),
        ],
      );
      const id = s.rows[0]!.id;
      const campus = await c.query<{ id: string }>(
        `INSERT INTO campuses (school_id, code, name) VALUES ($1, 'MAIN', 'Main Campus') ON CONFLICT (school_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id::text`,
        [id],
      );
      for (const [ycode, yname, start, end, status, legacy] of [
        ['2025-26', 'Session 2025-26', '2025-04-01', '2026-03-31', 'closed', '2025'],
        ['2026-27', 'Session 2026-27', '2026-04-01', '2027-03-31', 'active', '2026'],
        ['2027-28', 'Session 2027-28', '2027-04-01', '2028-03-31', 'planned', '2027'],
      ] as const) {
        await c.query(
          `INSERT INTO academic_years (school_id, code, name, start_date, end_date, status, legacy_ref) VALUES ($1, $2, $3, $4, $5, $6::year_status, $7) ON CONFLICT (school_id, code) DO UPDATE SET status = EXCLUDED.status`,
          [id, ycode, yname, start, end, status, legacy],
        );
      }
      await c.query(
        `INSERT INTO financial_years (school_id, code, name, start_date, end_date, status) VALUES ($1, 'FY2026-27', 'Financial Year 2026-27', '2026-04-01', '2027-03-31', 'active') ON CONFLICT (school_id, code) DO NOTHING`,
        [id],
      );
      const year = await c.query<{ id: string }>(
        `SELECT id::text FROM academic_years WHERE school_id = $1 AND code = '2026-27'`,
        [id],
      );
      schools[code] = { id, yearId: year.rows[0]!.id, campusId: campus.rows[0]!.id };
      for (const [key, value] of [
        ['fees.late_fee_mode', '"daywise"'],
        ['security.break_glass_email', '"security-lead@example.test"'],
        [
          'compat.holidays',
          JSON.stringify([
            { date: '2026-10-02', name: 'Gandhi Jayanti' },
            { date: '2026-10-20', name: 'Dussehra' },
            { date: '2026-11-08', name: 'Diwali' },
            { date: '2026-12-25', name: 'Christmas' },
            { date: '2027-01-26', name: 'Republic Day' },
          ]),
        ],
      ] as const) {
        await c.query(
          `INSERT INTO school_settings (school_id, key, value) SELECT $1, $2, $3::jsonb WHERE NOT EXISTS (SELECT 1 FROM school_settings WHERE school_id = $1 AND key = $2)`,
          [id, key, value],
        );
      }
    }

    // ---- school role: front office ------------------------------------------------------------------
    const frontOffice = await c.query<{ id: string }>(
      `INSERT INTO roles (school_id, code, name, kind, is_system, description) VALUES ($1, 'front_office', 'Front Office', 'module', false, 'Admissions desk: people, enrolments, search, exports, notifications')
       ON CONFLICT (school_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id::text`,
      [schools.ALPHA!.id],
    );
    await c.query(
      `INSERT INTO role_permissions (role_id, permission_code) SELECT $1, code FROM permissions WHERE code IN
        ('people.student.view','people.student.create','people.student.edit','people.guardian.view','people.guardian.edit','people.enrolment.manage','people.employee.view','people.document.view','people.person.search',
         'academics.class.view','academics.class_section.view','comms.message.send','comms.template.view','reports.export.create','reports.export.view','platform.files.upload','platform.files.view')
       ON CONFLICT DO NOTHING`,
      [frontOffice.rows[0]!.id],
    );

    // ---- users, memberships, roles ------------------------------------------------------------------
    const userIds: Record<string, string> = {};
    for (const u of DEMO_USERS) {
      const r = await c.query<{ id: string }>(
        `INSERT INTO users (oneauth_sub, email, mobile, display_name) VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), $4)
         ON CONFLICT (oneauth_sub) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email, mobile = EXCLUDED.mobile RETURNING id::text`,
        [u.sub, u.email, u.mobile, u.name],
      );
      userIds[u.sub] = r.rows[0]!.id;
      for (const [schoolCode, roleCodes] of Object.entries(u.roles)) {
        const school = schools[schoolCode]!;
        await c.query(
          `INSERT INTO user_school_memberships (school_id, user_id, person_type) VALUES ($1, $2, $3::person_type) ON CONFLICT (school_id, user_id, person_type) DO UPDATE SET status = 'active', deleted_at = NULL`,
          [school.id, r.rows[0]!.id, u.personType],
        );
        for (const roleCode of roleCodes) {
          const role = await c.query<{ id: string }>(
            `SELECT id::text FROM roles WHERE code = $1 AND (school_id IS NULL OR school_id = $2) ORDER BY school_id NULLS LAST LIMIT 1`,
            [roleCode, school.id],
          );
          if (!role.rows[0]) throw new Error(`role ${roleCode} not found`);
          await c.query(
            `INSERT INTO user_roles (school_id, user_id, role_id, reason) SELECT $1, $2, $3, 'demo seed'
             WHERE NOT EXISTS (SELECT 1 FROM user_roles WHERE school_id = $1 AND user_id = $2 AND role_id = $3 AND revoked_at IS NULL)`,
            [school.id, r.rows[0]!.id, role.rows[0].id],
          );
        }
      }
    }

    // ---- classes and sections ----------------------------------------------------------------------
    const sections: Record<string, Record<string, string>> = { ALPHA: {}, BETA: {} };
    for (const [schoolCode, school] of Object.entries(schools)) {
      const classList = schoolCode === 'ALPHA' ? CLASSES : CLASSES.slice(0, 5);
      const sectionNames = schoolCode === 'ALPHA' ? ['A', 'B'] : ['A'];
      for (const [code, name, order] of classList) {
        const cls = await c.query<{ id: string }>(
          `INSERT INTO classes (school_id, code, name, display_order) VALUES ($1, $2, $3, $4) ON CONFLICT (school_id, code) WHERE deleted_at IS NULL DO UPDATE SET name = EXCLUDED.name RETURNING id::text`,
          [school.id, code, name, order],
        );
        for (const sec of sectionNames) {
          const s = await c.query<{ id: string }>(
            `INSERT INTO class_sections (school_id, academic_year_id, class_id, campus_id, name, capacity, legacy_ref) VALUES ($1, $2, $3, $4, $5, 40, $6)
             ON CONFLICT DO NOTHING RETURNING id::text`,
            [school.id, school.yearId, cls.rows[0]!.id, school.campusId, sec, `${code}-${sec}`],
          );
          const sid =
            s.rows[0]?.id ??
            (
              await c.query<{ id: string }>(
                `SELECT id::text FROM class_sections WHERE school_id = $1 AND academic_year_id = $2 AND class_id = $3 AND name = $4`,
                [school.id, school.yearId, cls.rows[0]!.id, sec],
              )
            ).rows[0]!.id;
          sections[schoolCode]![`${code}-${sec}`] = sid;
        }
      }
    }

    // ---- people (only when the school has no students yet) -------------------------------------
    for (const [schoolCode, school] of Object.entries(schools)) {
      const existing = await c.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM students WHERE school_id = $1',
        [school.id],
      );
      if (Number(existing.rows[0]!.n) > 0) continue;
      const sectionKeys = Object.keys(sections[schoolCode]!);
      let serial = 1;
      let guardianSerial = 1;
      let lastGuardianId: string | null = null;
      for (const key of sectionKeys) {
        const classCode = key.split('-')[0]!;
        const classIndex = CLASSES.findIndex((k) => k[0] === classCode);
        const perSection = schoolCode === 'ALPHA' ? 8 : 6;
        for (let roll = 1; roll <= perSection; roll += 1) {
          const female = serial % 2 === 0;
          const isSibling = serial % 6 === 0 && lastGuardianId !== null; // every sixth student shares the previous guardian
          const last = isSibling ? null : pick(LAST, serial * 7 + classIndex);
          const lastName =
            last ??
            (
              await c.query<{ last_name: string }>(
                'SELECT last_name FROM guardians WHERE id = $1',
                [lastGuardianId],
              )
            ).rows[0]!.last_name;
          const first = female ? pick(FIRST_F, serial * 3) : pick(FIRST_M, serial * 5);
          const admission = `${schoolCode === 'ALPHA' ? 'A' : 'B'}${pad(2400 + serial, 4)}`;
          const dobYear = 2026 - (5 + classIndex);
          const isDevStudent = schoolCode === 'ALPHA' && key === 'VI-A' && roll === 1;
          const s = await c.query<{ id: string }>(
            `INSERT INTO students (school_id, admission_no, first_name, last_name, dob, gender, category, blood_group, house, admitted_on, user_id, legacy_ref)
             VALUES ($1, $2, $3, $4, $5::date, $6::gender, $7, $8, $9, $10::date, $11, $2) RETURNING id::text`,
            [
              school.id,
              admission,
              isDevStudent ? 'Aarav' : first,
              isDevStudent ? 'Sharma' : lastName,
              `${dobYear}-${pad(1 + (serial % 12), 2)}-${pad(1 + (serial % 27), 2)}`,
              female ? 'female' : 'male',
              pick(['GEN', 'GEN', 'OBC', 'SC', 'EWS'], serial),
              pick(['A+', 'B+', 'O+', 'AB+', 'O-'], serial),
              pick(['Red', 'Blue', 'Green', 'Yellow'], serial),
              `${2026 - classIndex}-04-05`,
              isDevStudent ? userIds['dev-student'] : null,
            ],
          );
          const studentId = s.rows[0]!.id;
          let guardianId: string;
          if (isSibling && lastGuardianId) guardianId = lastGuardianId;
          else if (isDevStudent) {
            const g = await c.query<{ id: string }>(
              `INSERT INTO guardians (school_id, first_name, last_name, mobile, email, occupation, user_id) VALUES ($1, 'Suresh', 'Sharma', '9876543210', 'suresh.sharma@example.test', 'Engineer', $2) RETURNING id::text`,
              [school.id, userIds['dev-parent']],
            );
            guardianId = g.rows[0]!.id;
          } else {
            const gFirst = pick(FIRST_M, serial * 11 + 3);
            const g = await c.query<{ id: string }>(
              `INSERT INTO guardians (school_id, first_name, last_name, mobile, email, occupation) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text`,
              [
                school.id,
                gFirst,
                lastName,
                `9${pad(100000000 + guardianSerial * 7919 + (schoolCode === 'ALPHA' ? 0 : 500000), 9)}`,
                `${gFirst.toLowerCase()}.${lastName.toLowerCase()}${guardianSerial}@example.test`,
                pick(
                  ['Engineer', 'Teacher', 'Business', 'Doctor', 'Farmer', 'Clerk', 'Driver'],
                  guardianSerial,
                ),
              ],
            );
            guardianId = g.rows[0]!.id;
            guardianSerial += 1;
          }
          lastGuardianId = guardianId;
          await c.query(
            `INSERT INTO student_guardians (school_id, student_id, guardian_id, relation, is_primary) VALUES ($1, $2, $3, 'father', true) ON CONFLICT DO NOTHING`,
            [school.id, studentId, guardianId],
          );
          await c.query(
            `INSERT INTO enrolments (school_id, student_id, academic_year_id, class_section_id, roll_no, joined_on) VALUES ($1, $2, $3, $4, $5, $6::date)`,
            [school.id, studentId, school.yearId, sections[schoolCode]![key], roll, '2026-04-06'],
          );
          serial += 1;
        }
      }
      // The dev parent's second child: sibling of Aarav in class IV-A.
      if (schoolCode === 'ALPHA') {
        const g = await c.query<{ id: string }>(
          `SELECT id::text FROM guardians WHERE school_id = $1 AND mobile = '9876543210'`,
          [school.id],
        );
        const diya = await c.query<{ id: string }>(
          `INSERT INTO students (school_id, admission_no, first_name, last_name, dob, gender, category, blood_group, house, admitted_on, legacy_ref)
           VALUES ($1, 'A2599', 'Diya', 'Sharma', '2017-09-12', 'female', 'GEN', 'B+', 'Blue', '2024-04-05', 'A2599') RETURNING id::text`,
          [school.id],
        );
        await c.query(
          `INSERT INTO student_guardians (school_id, student_id, guardian_id, relation, is_primary) VALUES ($1, $2, $3, 'father', true)`,
          [school.id, diya.rows[0]!.id, g.rows[0]!.id],
        );
        await c.query(
          `INSERT INTO enrolments (school_id, student_id, academic_year_id, class_section_id, roll_no, joined_on) VALUES ($1, $2, $3, $4, 9, '2026-04-06')`,
          [school.id, diya.rows[0]!.id, school.yearId, sections.ALPHA!['IV-A']],
        );
      }

      // employees with postings and reporting lines
      const empList = schoolCode === 'ALPHA' ? DESIGNATIONS : DESIGNATIONS.slice(0, 8);
      const employeeIds: Record<string, string> = {};
      const linked: Record<string, string> = {
        E001: 'dev-principal',
        E003: 'dev-coordinator',
        E006: 'dev-teacher',
        E004: 'dev-subject',
        E016: 'dev-clerk',
      };
      for (const [i, [code, designation, department]] of empList.entries()) {
        const female = i % 2 === 1;
        const first = female ? pick(FIRST_F, i * 7 + 1) : pick(FIRST_M, i * 3 + 2);
        const last = pick(LAST, i * 5 + 4);
        const linkedSub = schoolCode === 'ALPHA' ? linked[code] : undefined;
        const demo = linkedSub ? DEMO_USERS.find((u) => u.sub === linkedSub)! : null;
        const [dFirst, ...dRest] = (demo?.name ?? '').split(' ');
        const e = await c.query<{ id: string }>(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name, dob, gender, employee_type, designation, department, joined_on, mobile, email, user_id, legacy_ref)
           VALUES ($1, $2, $3, $4, $5::date, $6::gender, $7::employee_type, $8, $9, $10::date, $11, $12, $13, $2)
           ON CONFLICT (school_id, employee_code) DO UPDATE SET designation = EXCLUDED.designation RETURNING id::text`,
          [
            school.id,
            code,
            demo ? dFirst : first,
            demo ? dRest.join(' ') : last,
            `${1970 + ((i * 3) % 25)}-${pad(1 + (i % 12), 2)}-${pad(1 + (i % 27), 2)}`,
            female ? 'female' : 'male',
            /PGT|TGT|PRT|PET|Coordinator|Principal/.test(designation) ? 'teaching' : 'non_teaching',
            designation,
            department,
            `${2005 + ((i * 2) % 18)}-${pad(1 + (i % 12), 2)}-01`,
            demo?.mobile ||
              `8${pad(100000000 + i * 104729 + (schoolCode === 'ALPHA' ? 0 : 300000), 9)}`,
            demo?.email || `${code.toLowerCase()}@${schoolCode.toLowerCase()}.example.test`,
            demo ? userIds[demo.sub] : null,
          ],
        );
        employeeIds[code] = e.rows[0]!.id;
      }
      for (const [i, [code, designation, department]] of empList.entries()) {
        const reportsTo =
          code === 'E001'
            ? null
            : code === 'E002' ||
                code === 'E003' ||
                code === 'E015' ||
                code === 'E016' ||
                code === 'E019'
              ? employeeIds.E001
              : /PGT|TGT|PRT|PET|Lab/.test(designation)
                ? (employeeIds.E003 ?? employeeIds.E001)
                : (employeeIds.E002 ?? employeeIds.E001);
        await c.query(
          `INSERT INTO postings (school_id, employee_id, academic_year_id, campus_id, department, designation, reports_to_employee_id, valid_from)
           VALUES ($1, $2, $3, $4, $5, $6, $7, '2026-04-01') ON CONFLICT (employee_id, academic_year_id) DO UPDATE SET reports_to_employee_id = EXCLUDED.reports_to_employee_id`,
          [
            school.id,
            employeeIds[code],
            school.yearId,
            school.campusId,
            department,
            designation,
            reportsTo ?? null,
          ],
        );
        void i;
      }
    }

    // ---- scopes for the class teacher and subject teacher (Alpha) ---------------------------------
    const scopeFor = async (sub: string, roleCode: string, sectionKeys: string[]) => {
      const ur = await c.query<{ id: string }>(
        `SELECT ur.id::text FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.school_id = $1 AND ur.user_id = $2 AND r.code = $3 AND ur.revoked_at IS NULL LIMIT 1`,
        [schools.ALPHA!.id, userIds[sub], roleCode],
      );
      if (!ur.rows[0]) return;
      for (const key of sectionKeys) {
        await c.query(
          `INSERT INTO user_role_scopes (school_id, user_role_id, scope_type, scope_id) VALUES ($1, $2, 'class_section', $3) ON CONFLICT DO NOTHING`,
          [schools.ALPHA!.id, ur.rows[0].id, sections.ALPHA![key]],
        );
      }
    };
    await scopeFor('dev-teacher', 'class_teacher', ['VI-A']);
    await scopeFor('dev-subject', 'subject_teacher', ['VI-A', 'VI-B']);

    // ---- delegation: the coordinator covers for the class teacher for a week --------------------
    const coordRole = await c.query<{ id: string }>(
      `SELECT id::text FROM roles WHERE code = 'academic_coordinator' AND school_id IS NULL`,
    );
    await c.query(
      `INSERT INTO delegations (school_id, from_user_id, to_user_id, role_id, starts_at, ends_at, reason)
       SELECT $1, $2, $3, $4, now() - interval '1 day', now() + interval '6 days', 'Leave cover during the sports week'
       WHERE NOT EXISTS (SELECT 1 FROM delegations WHERE school_id = $1 AND from_user_id = $2 AND to_user_id = $3 AND revoked_at IS NULL)`,
      [
        schools.ALPHA!.id,
        userIds['dev-coordinator'],
        userIds['dev-teacher'],
        coordRole.rows[0]!.id,
      ],
    );

    // ---- notification templates and a delivery log ---------------------------------------------
    const alpha = schools.ALPHA!;
    const templates: Array<
      [string, string, string, string | null, string, string | null, string | null]
    > = [
      [
        'fee_due',
        'sms',
        'Fee reminder',
        null,
        'Dear {{guardian_name}}, fees of {{amount}} for {{student_name}} are due on {{due_date}}. - {{school}}',
        '1107160000000000101',
        '1101000000000000001',
      ],
      [
        'absent_alert',
        'whatsapp',
        'Absent alert',
        null,
        '{{student_name}} ({{section}}) was marked absent today, {{date}}. Please contact the class teacher if this is unexpected.',
        null,
        null,
      ],
      [
        'welcome',
        'email',
        'Welcome email',
        'Welcome to {{school}}',
        'Dear {{guardian_name}},\n\nWelcome to {{school}}. {{student_name}} has been admitted to {{section}}. Sign in to the parent app with this mobile number.\n\nWarm regards,\nThe Principal',
        null,
        null,
      ],
      ['notice', 'push', 'General notice', null, '{{title}}: {{body}}', null, null],
    ];
    const templateIds: Record<string, string> = {};
    for (const [code, channel, name, subject, body, dlt, entity] of templates) {
      const t = await c.query<{ id: string }>(
        `INSERT INTO comms_templates (school_id, code, channel, name, subject, body, variables, dlt_template_id, dlt_entity_id, sender_id)
         VALUES ($1, $2, $3::comms_channel, $4, $5, $6, $7::jsonb, $8, $9, $10)
         ON CONFLICT (school_id, code, channel) DO UPDATE SET body = EXCLUDED.body RETURNING id::text`,
        [
          alpha.id,
          code,
          channel,
          name,
          subject,
          body,
          JSON.stringify([...body.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1])),
          dlt,
          entity,
          channel === 'email' ? 'no-reply@alpha.example.test' : channel === 'sms' ? 'ALPHPS' : null,
        ],
      );
      templateIds[code] = t.rows[0]!.id;
    }
    const existingMessages = await c.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM comms_messages WHERE school_id = $1',
      [alpha.id],
    );
    if (Number(existingMessages.rows[0]!.n) === 0) {
      const guardians = await c.query<{
        id: string;
        name: string;
        mobile: string;
        student: string;
        section: string;
      }>(
        `SELECT g.id::text, g.display_name AS name, g.mobile, s.display_name AS student, c.code || '-' || cs.name AS section
           FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id JOIN students s ON s.id = sg.student_id
           JOIN enrolments e ON e.student_id = s.id JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes c ON c.id = cs.class_id
          WHERE sg.school_id = $1 AND g.mobile IS NOT NULL ORDER BY s.id LIMIT 24`,
        [alpha.id],
      );
      for (const [i, g] of guardians.rows.entries()) {
        const status = pick(['delivered', 'delivered', 'sent', 'failed', 'queued', 'delivered'], i);
        const isFee = i % 2 === 0;
        await c.query(
          `INSERT INTO comms_messages (school_id, template_id, channel, recipient_address, body, variables, status, provider, provider_message_id, attempts, last_error, sent_at, delivered_at, failed_at, created_at)
           VALUES ($1, $2, $3::comms_channel, $4, $5, $6::jsonb, $7::comms_message_status, $8, $9, $10, $11, $12, $13, $14, now() - ($15 || ' hours')::interval)`,
          [
            alpha.id,
            isFee ? templateIds.fee_due : templateIds.absent_alert,
            isFee ? 'sms' : 'whatsapp',
            g.mobile,
            isFee
              ? `Dear ${g.name}, fees of ₹12,500 for ${g.student} are due on 10 Oct 2026. - Alpha Public School`
              : `${g.student} (${g.section}) was marked absent today, 26 Sep 2026. Please contact the class teacher if this is unexpected.`,
            JSON.stringify(
              isFee
                ? {
                    guardian_name: g.name,
                    amount: '₹12,500',
                    student_name: g.student,
                    due_date: '10 Oct 2026',
                    school: 'Alpha Public School',
                  }
                : { student_name: g.student, section: g.section, date: '26 Sep 2026' },
            ),
            status,
            status === 'queued' ? null : 'http-sms',
            status === 'queued' ? null : `prov-${1000 + i}`,
            status === 'queued' ? 0 : status === 'failed' ? 3 : 1,
            status === 'failed' ? 'provider responded 502' : null,
            status === 'queued' ? null : new Date(Date.now() - i * 3600e3),
            status === 'delivered' ? new Date(Date.now() - i * 3600e3 + 60e3) : null,
            status === 'failed' ? new Date(Date.now() - i * 3600e3 + 120e3) : null,
            String(i + 2),
          ],
        );
      }
    }

    // ---- sample security history: an ended impersonation and a closed break-glass window ----------
    await c.query(
      `INSERT INTO impersonation_sessions (school_id, actor_user_id, target_user_id, reason, started_at, expires_at, ended_at, ended_by)
       SELECT $1, $2, $3, 'Ticket 4711: timetable did not load for the class teacher', now() - interval '2 days', now() - interval '2 days' + interval '30 minutes', now() - interval '2 days' + interval '12 minutes', $2
       WHERE NOT EXISTS (SELECT 1 FROM impersonation_sessions WHERE school_id = $1)`,
      [alpha.id, userIds['dev-support'], userIds['dev-teacher']],
    );
    const adminRole = await c.query<{ id: string }>(
      `SELECT id::text FROM roles WHERE code = 'school_admin' AND school_id IS NULL`,
    );
    const bgGrant = await c.query<{ id: string }>(
      `INSERT INTO user_roles (school_id, user_id, role_id, valid_from, valid_to, reason, revoked_at)
       SELECT $1, $2, $3, CURRENT_DATE - 3, CURRENT_DATE - 3, 'break-glass: fee posting stuck during the audit visit', now() - interval '3 days' + interval '4 hours'
       WHERE NOT EXISTS (SELECT 1 FROM break_glass_events WHERE school_id = $1) RETURNING id::text`,
      [alpha.id, userIds['dev-principal'], adminRole.rows[0]!.id],
    );
    if (bgGrant.rows[0]) {
      await c.query(
        `INSERT INTO break_glass_events (school_id, user_id, role_id, user_role_id, reason, started_at, expires_at, revoked_at, report_sent_at)
         VALUES ($1, $2, $3, $4, 'Fee posting stuck during the audit visit; needed settings access', now() - interval '3 days', now() - interval '3 days' + interval '4 hours', now() - interval '3 days' + interval '4 hours', now() - interval '3 days' + interval '4 hours 5 minutes')`,
        [alpha.id, userIds['dev-principal'], adminRole.rows[0]!.id, bgGrant.rows[0].id],
      );
    }

    // ---- audit trail sample (so the viewer has history before anyone clicks) ----------------------
    const auditCount = await c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_logs WHERE school_id = $1 AND source = 'migration'`,
      [alpha.id],
    );
    if (Number(auditCount.rows[0]!.n) === 0) {
      const events: Array<[string, string, string, number]> = [
        ['dev-admin', 'platform.settings.edit', 'school_settings', 30],
        ['dev-admin', 'access.role.create', 'roles', 29],
        ['dev-admin', 'access.assignment.grant', 'user_roles', 28],
        ['dev-coordinator', 'academics.class.create', 'classes', 27],
        ['dev-coordinator', 'academics.class_section.create', 'class_sections', 27],
        ['dev-clerk', 'people.student.create', 'students', 20],
        ['dev-clerk', 'people.enrolment.set', 'enrolments', 20],
        ['dev-principal', 'access.break_glass.start', 'break_glass_events', 3],
        ['dev-support', 'access.session.impersonate.start', 'impersonation_sessions', 2],
        ['dev-teacher', 'comms.message.send', 'comms_messages', 1],
        ['dev-admin', 'platform.year.lock', 'academic_years', 1],
      ];
      for (const [sub, action, entity, daysAgo] of events) {
        await c.query(
          `INSERT INTO audit_logs (occurred_at, school_id, actor_type, actor_user_id, action, entity_type, entity_id, diff, permission_code, source)
           VALUES (now() - ($1 || ' days')::interval, $2, 'user', $3, $4, $5, '1', '{"status": {"from": "planned", "to": "active"}}'::jsonb, $4, 'migration')`,
          [String(daysAgo), alpha.id, userIds[sub], action, entity],
        );
      }
    }

    await c.query('COMMIT');
    const counts = await c.query<{
      students: string;
      guardians: string;
      employees: string;
      messages: string;
    }>(
      `SELECT (SELECT count(*) FROM students)::text AS students, (SELECT count(*) FROM guardians)::text AS guardians, (SELECT count(*) FROM employees)::text AS employees, (SELECT count(*) FROM comms_messages)::text AS messages`,
    );
    process.stdout.write(
      `demo data ready: ${counts.rows[0]!.students} students, ${counts.rows[0]!.guardians} guardians, ${counts.rows[0]!.employees} employees, ${counts.rows[0]!.messages} messages\n\n`,
    );
    process.stdout.write('Developer sign-in subjects (login page, AUTH_DEV_BYPASS=1):\n');
    for (const u of DEMO_USERS)
      process.stdout.write(`  ${u.sub.padEnd(16)} ${u.name.padEnd(20)} ${u.description}\n`);
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    await c.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

export { DEMO_USERS };
