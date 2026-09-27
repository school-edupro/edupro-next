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
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Client } from 'pg';
import { DEFAULT_ADMISSION_FORM } from './admission-form';
import { DEFAULT_TEMPLATES } from './document-defaults';
import { templatePlaceholders } from './template-engine';

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
    sub: 'dev-accounts',
    name: 'Ravi Accounts',
    mobile: '9999999912',
    email: 'accounts@alpha.example.test',
    personType: 'employee',
    roles: { ALPHA: ['accountant'] },
    description: 'Accountant: fee masters, student fee profiles, demand generation',
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
         'academics.class.view','academics.class_section.view','academics.subject.view','academics.teacher_assignment.view','academics.timetable.view','people.import.run',
         'academics.daily_work.view','academics.notice.view','academics.calendar.view','academics.gallery.view','people.tc.view','people.tc.issue','people.withdrawal.view','people.withdrawal.manage','people.withdrawal.clear','platform.template.view','comms.message.send','comms.template.view','reports.export.create','reports.export.view','platform.files.upload','platform.files.view')
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
        E015: 'dev-accounts',
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
           ON CONFLICT (school_id, employee_code) DO UPDATE SET designation = EXCLUDED.designation, user_id = COALESCE(employees.user_id, EXCLUDED.user_id) RETURNING id::text`,
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

    // ---- Sprint 6: subjects, class-subject mapping, teacher assignments, periods and timetable ------
    const SUBJECTS: Array<[string, string, string, number]> = [
      ['ENG', 'English', 'language', 1],
      ['HIN', 'Hindi', 'language', 2],
      ['MAT', 'Mathematics', 'scholastic', 3],
      ['EVS', 'Environmental Studies', 'scholastic', 4],
      ['SCI', 'Science', 'scholastic', 5],
      ['SST', 'Social Science', 'scholastic', 6],
      ['CS', 'Computer Science', 'vocational', 7],
      ['ART', 'Art and Craft', 'co_scholastic', 8],
      ['PE', 'Physical Education', 'co_scholastic', 9],
      ['MUS', 'Music', 'co_scholastic', 10],
    ];
    const PRIMARY = ['ENG', 'HIN', 'MAT', 'EVS', 'ART', 'PE', 'MUS'];
    const SECONDARY = ['ENG', 'HIN', 'MAT', 'SCI', 'SST', 'CS', 'ART', 'PE'];
    const PERIODS: Array<[number, string, string, string, string]> = [
      [1, 'Assembly', '07:50', '08:10', 'assembly'],
      [2, 'Period 1', '08:10', '08:50', 'teaching'],
      [3, 'Period 2', '08:50', '09:30', 'teaching'],
      [4, 'Period 3', '09:30', '10:10', 'teaching'],
      [5, 'Break', '10:10', '10:30', 'break'],
      [6, 'Period 4', '10:30', '11:10', 'teaching'],
      [7, 'Period 5', '11:10', '11:50', 'teaching'],
      [8, 'Period 6', '11:50', '12:30', 'teaching'],
      [9, 'Period 7', '12:30', '13:10', 'teaching'],
    ];
    const classOrder = (sectionKey: string) =>
      CLASSES.findIndex(([code]) => code === sectionKey.split('-')[0]);
    for (const [schoolCode, school] of Object.entries(schools)) {
      const subjectIds: Record<string, string> = {};
      const subjectList =
        schoolCode === 'ALPHA' ? SUBJECTS : SUBJECTS.filter(([code]) => PRIMARY.includes(code));
      for (const [code, name, kind, order] of subjectList) {
        const r = await c.query<{ id: string }>(
          `INSERT INTO subjects (school_id, code, name, kind, display_order, legacy_ref) VALUES ($1, $2, $3, $4::subject_kind, $5, $2)
           ON CONFLICT (school_id, code) WHERE deleted_at IS NULL DO UPDATE SET name = EXCLUDED.name RETURNING id::text`,
          [school.id, code, name, kind, order],
        );
        subjectIds[code] = r.rows[0]!.id;
      }
      const classRows = await c.query<{ id: string; code: string }>(
        `SELECT id::text, code FROM classes WHERE school_id = $1 AND deleted_at IS NULL`,
        [school.id],
      );
      const classSubjects: Record<string, string[]> = {};
      for (const cls of classRows.rows) {
        const order = classOrder(cls.code);
        const codes = (order < 5 ? PRIMARY : SECONDARY).filter((code) => subjectIds[code]);
        classSubjects[cls.code] = codes;
        for (const code of codes) {
          await c.query(
            `INSERT INTO class_subjects (school_id, academic_year_id, class_id, subject_id, is_elective, periods_per_week)
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (academic_year_id, class_id, subject_id) DO NOTHING`,
            [
              school.id,
              school.yearId,
              cls.id,
              subjectIds[code],
              code === 'CS' && order >= 8,
              code === 'MAT' || code === 'ENG' ? 7 : ['ART', 'PE', 'MUS'].includes(code) ? 2 : 5,
            ],
          );
        }
      }
      const teachingPeriods: string[] = [];
      for (const [number, name, start, end, kind] of PERIODS) {
        const r = await c.query<{ id: string }>(
          `INSERT INTO timetable_periods (school_id, number, name, starts_at, ends_at, kind) VALUES ($1, $2, $3, $4::time, $5::time, $6::period_kind)
           ON CONFLICT (school_id, (COALESCE(campus_id, 0)), number) DO UPDATE SET name = EXCLUDED.name RETURNING id::text`,
          [school.id, number, name, start, end, kind],
        );
        if (kind === 'teaching') teachingPeriods.push(r.rows[0]!.id);
      }

      // teaching staff: E001 principal, E002 vice principal and E003 coordinator are not class teachers
      const staff = await c.query<{ id: string; code: string; user_id: string | null }>(
        `SELECT id::text, employee_code AS code, user_id::text FROM employees
          WHERE school_id = $1 AND employee_type = 'teaching' AND deleted_at IS NULL ORDER BY employee_code`,
        [school.id],
      );
      const byCode = Object.fromEntries(staff.rows.map((e) => [e.code, e.id]));
      const pool = staff.rows.filter(
        (e) =>
          !['E001', 'E002', 'E003'].includes(e.code) &&
          (schoolCode !== 'ALPHA' || e.code !== 'E004'),
      );
      const assign = async (
        employeeId: string,
        sectionId: string,
        kind: string,
        subjectId: string | null,
      ) => {
        await c.query(
          `INSERT INTO teacher_assignments (school_id, academic_year_id, employee_id, class_section_id, subject_id, kind, valid_from)
           SELECT $1, $2, $3, $4, $5::bigint, $6::teacher_assignment_kind, '2026-04-01'
            WHERE NOT EXISTS (SELECT 1 FROM teacher_assignments WHERE academic_year_id = $2 AND employee_id = $3 AND class_section_id = $4
                                 AND kind = $6::teacher_assignment_kind AND COALESCE(subject_id, 0) = COALESCE($5::bigint, 0) AND valid_to IS NULL)
              AND NOT ($6::teacher_assignment_kind = 'class_teacher' AND EXISTS (SELECT 1 FROM teacher_assignments WHERE academic_year_id = $2 AND class_section_id = $4 AND kind = 'class_teacher' AND valid_to IS NULL))`,
          [school.id, school.yearId, employeeId, sectionId, subjectId, kind],
        );
      };
      const sectionEntries = Object.entries(sections[schoolCode]!).sort(
        (a, b) => classOrder(a[0]) - classOrder(b[0]) || a[0].localeCompare(b[0]),
      );
      const classTeacher: Record<string, string> = {};
      let cursor = 0;
      for (const [key, sectionId] of sectionEntries) {
        let emp: string | undefined;
        if (schoolCode === 'ALPHA' && key === 'VI-A') emp = byCode.E006;
        else if (pool.length > 0) {
          for (let tries = 0; tries < pool.length && !emp; tries += 1) {
            const cand = pool[cursor % pool.length]!;
            cursor += 1;
            if (schoolCode === 'ALPHA' && cand.code === 'E006') continue;
            emp = cand.id;
          }
        }
        if (!emp) continue;
        classTeacher[key] = emp;
        await assign(emp, sectionId, 'class_teacher', null);
        if (byCode.E003 && classOrder(key) >= 5)
          await assign(byCode.E003, sectionId, 'coordinator', null);
        if (byCode.E002 && ['IX', 'X'].includes(key.split('-')[0]!))
          await assign(byCode.E002, sectionId, 'indicator', null);
      }
      // subject teachers for VI-A and VI-B (Alpha): the dev subject teacher takes Mathematics in both
      const subjectTeacher: Record<string, Record<string, string>> = {};
      if (schoolCode === 'ALPHA') {
        const st: Array<[string, string]> = [
          ['E004', 'MAT'],
          ['E005', 'SCI'],
          ['E007', 'HIN'],
          ['E008', 'SST'],
          ['E012', 'PE'],
        ];
        for (const key of ['VI-A', 'VI-B']) {
          subjectTeacher[key] = {};
          for (const [code, subj] of st) {
            if (!byCode[code] || !subjectIds[subj]) continue;
            subjectTeacher[key]![subj] = byCode[code]!;
            await assign(
              byCode[code]!,
              sections.ALPHA![key]!,
              'subject_teacher',
              subjectIds[subj]!,
            );
          }
        }
      }
      // roles and scopes follow the assignments (same routine the API uses), for staff who have a login
      await c.query(
        `SELECT set_config('app.school_id', $1, true), set_config('app.user_id', $2, true)`,
        [school.id, userIds['dev-admin']],
      );
      for (const e of staff.rows.filter((x) => x.user_id))
        await c.query(`SELECT app.sync_teacher_scopes($1, $2)`, [e.id, school.yearId]);
      await c.query(
        `SELECT set_config('app.school_id', '', true), set_config('app.user_id', '', true)`,
      );

      // a full week for every section; VI-A and VI-B first so their subject teachers keep their slots
      const slotCount = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM timetable_slots WHERE school_id = $1`,
        [school.id],
      );
      if (Number(slotCount.rows[0]!.n) === 0) {
        const slotOrder = [...sectionEntries].sort(
          (a, b) => Number(!a[0].startsWith('VI-')) - Number(!b[0].startsWith('VI-')),
        );
        for (const [k, [key, sectionId]] of slotOrder.entries()) {
          const codes = classSubjects[key.split('-')[0]!] ?? [];
          if (codes.length === 0) continue;
          for (let weekday = 1; weekday <= 6; weekday += 1) {
            const periodsToday = weekday === 6 ? teachingPeriods.slice(0, 4) : teachingPeriods;
            for (const [p, periodId] of periodsToday.entries()) {
              const subj = codes[(p + weekday + k) % codes.length]!;
              let employeeId: string | null =
                subjectTeacher[key]?.[subj] ?? classTeacher[key] ?? null;
              if (employeeId) {
                const busy = await c.query(
                  `SELECT 1 FROM timetable_slots WHERE academic_year_id = $1 AND employee_id = $2 AND weekday = $3 AND period_id = $4`,
                  [school.yearId, employeeId, weekday, periodId],
                );
                if (busy.rowCount) employeeId = null;
              }
              await c.query(
                `INSERT INTO timetable_slots (school_id, academic_year_id, class_section_id, weekday, period_id, subject_id, employee_id, room)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
                [
                  school.id,
                  school.yearId,
                  sectionId,
                  weekday,
                  periodId,
                  subjectIds[subj],
                  employeeId,
                  `Room ${key}`,
                ],
              );
            }
          }
        }
      }
    }

    // ---- status history: every student has a "created" entry; one student has left ----------------
    await c.query(
      `INSERT INTO student_status_history (school_id, student_id, from_status, to_status, reason, changed_at)
       SELECT s.school_id, s.id, NULL, 'active', 'created', s.created_at FROM students s
        WHERE NOT EXISTS (SELECT 1 FROM student_status_history h WHERE h.student_id = s.id)`,
    );
    const hasLeaver = await c.query(
      `SELECT 1 FROM students WHERE school_id = $1 AND status = 'inactive' LIMIT 1`,
      [alpha.id],
    );
    if (hasLeaver.rowCount === 0) {
      const leaver = await c.query<{ id: string }>(
        `SELECT s.id::text FROM students s JOIN enrolments e ON e.student_id = s.id
           JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes c ON c.id = cs.class_id
          WHERE s.school_id = $1 AND c.code = 'X' AND cs.name = 'B' AND s.status = 'active' ORDER BY e.roll_no DESC LIMIT 1`,
        [alpha.id],
      );
      if (leaver.rows[0]) {
        await c.query(
          `SELECT set_config('app.school_id', $1, true), set_config('app.user_id', $2, true),
                  set_config('app.status_reason', 'Family relocated to Bengaluru; transfer certificate issued', true)`,
          [alpha.id, userIds['dev-clerk']],
        );
        await c.query(
          `UPDATE students SET status = 'inactive', left_on = CURRENT_DATE - 10 WHERE id = $1`,
          [leaver.rows[0].id],
        );
        await c.query(
          `UPDATE enrolments SET status = 'left', ended_on = CURRENT_DATE - 10 WHERE student_id = $1 AND academic_year_id = $2`,
          [leaver.rows[0].id, alpha.yearId],
        );
        await c.query(
          `SELECT set_config('app.school_id', '', true), set_config('app.user_id', '', true), set_config('app.status_reason', '', true)`,
        );
      }
    }

    // ---- import history: one committed roll and one validation with a rejected row ----------------
    await c.query(
      `INSERT INTO imports (school_id, kind, file_name, status, total_rows, ok_rows, rejected_rows, report, payload, requested_by, created_at, committed_at)
       SELECT $1, 'students', 'class-vi-admissions-2026.csv', 'committed', 16, 16, 0, '[]', '[]', $2, now() - interval '20 days', now() - interval '20 days' + interval '3 minutes'
        WHERE NOT EXISTS (SELECT 1 FROM imports WHERE school_id = $1)`,
      [alpha.id, userIds['dev-clerk']],
    );
    await c.query(
      `INSERT INTO imports (school_id, kind, file_name, status, total_rows, ok_rows, rejected_rows, report, payload, requested_by, created_at)
       SELECT $1, 'employees', 'new-staff-sept.csv', 'validated', 3, 2, 1,
              '[{"row": 4, "field": "mobile", "message": "10 digits starting 6-9"}]'::jsonb,
              '[{"employee_code": "E021", "first_name": "Ritu", "last_name": "Menon", "employee_type": "teaching", "designation": "TGT Science", "mobile": "9822000001"},
                {"employee_code": "E022", "first_name": "Arjun", "last_name": "Pillai", "employee_type": "teaching", "designation": "PRT", "mobile": "9822000002"},
                {"employee_code": "E023", "first_name": "Zoya", "last_name": "Ali", "employee_type": "non_teaching", "designation": "Receptionist", "mobile": "12345"}]'::jsonb,
              $2, now() - interval '2 days'
        WHERE NOT EXISTS (SELECT 1 FROM imports WHERE school_id = $1 AND kind = 'employees')`,
      [alpha.id, userIds['dev-admin']],
    );

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

    // ---- Sprint 7: templates, daily work, notices, calendar, gallery, TC, withdrawal, promotions ----
    const withCtx = async (schoolId: string, sub: string) =>
      c.query(`SELECT set_config('app.school_id', $1, true), set_config('app.user_id', $2, true)`, [
        schoolId,
        userIds[sub],
      ]);
    const clearCtx = () =>
      c.query(`SELECT set_config('app.school_id', '', true), set_config('app.user_id', '', true)`);
    for (const school of Object.values(schools)) {
      for (const t of DEFAULT_TEMPLATES)
        await c.query(
          `INSERT INTO document_templates (school_id, code, name, kind, page_width, page_height, body_html, styles_css, variables)
           SELECT $1, $2, $3, $4::template_kind, $5, $6, $7, $8, $9::jsonb
            WHERE NOT EXISTS (SELECT 1 FROM document_templates WHERE school_id = $1 AND code = $2 AND deleted_at IS NULL)`,
          [
            school.id,
            t.code,
            t.name,
            t.kind,
            t.pageWidth,
            t.pageHeight,
            t.bodyHtml,
            t.stylesCss,
            JSON.stringify(templatePlaceholders(t.bodyHtml)),
          ],
        );
    }

    const subjectId = async (schoolId: string, code: string) =>
      (
        await c.query<{ id: string }>(
          `SELECT id::text FROM subjects WHERE school_id = $1 AND code = $2 AND deleted_at IS NULL`,
          [schoolId, code],
        )
      ).rows[0]?.id ?? null;
    const employeeId = async (schoolId: string, code: string) =>
      (
        await c.query<{ id: string }>(
          `SELECT id::text FROM employees WHERE school_id = $1 AND employee_code = $2`,
          [schoolId, code],
        )
      ).rows[0]?.id ?? null;
    const schoolDays = (count: number): string[] => {
      const days: string[] = [];
      const d = new Date();
      while (days.length < count) {
        if (d.getDay() !== 0) days.push(d.toISOString().slice(0, 10));
        d.setDate(d.getDate() - 1);
      }
      return days;
    };
    const addDays = (iso: string, n: number) => {
      const d = new Date(`${iso}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    };

    // daily work for VI-A, VI-B and IV-A (the dev parent's children are in VI-A and IV-A)
    const workCount = await c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM daily_work WHERE school_id = $1`,
      [alpha.id],
    );
    if (Number(workCount.rows[0]!.n) === 0) {
      const plan: Array<[string, string, string, string, string]> = [
        // section, subject, employee code, homework title, classwork title
        [
          'VI-A',
          'MAT',
          'E004',
          'Fractions: exercise 4.2, questions 1 to 10',
          'Adding fractions with unlike denominators',
        ],
        [
          'VI-A',
          'ENG',
          'E006',
          'Write a paragraph on "My school"',
          'Reading: The Banyan Tree, comprehension',
        ],
        [
          'VI-A',
          'SCI',
          'E005',
          'Draw and label the parts of a flower',
          'Photosynthesis: experiment with a leaf',
        ],
        [
          'VI-A',
          'HIN',
          'E007',
          'निबंध: मेरा प्रिय त्योहार (150 शब्द)',
          'व्याकरण: संज्ञा और सर्वनाम',
        ],
        ['VI-A', 'SST', 'E008', 'Map work: rivers of India', 'The Harappan civilisation'],
        [
          'VI-B',
          'MAT',
          'E004',
          'Fractions: exercise 4.2, questions 1 to 10',
          'Adding fractions with unlike denominators',
        ],
        ['VI-B', 'SCI', 'E005', 'Chapter 5 questions 1 to 6', 'Separation of substances'],
        [
          'IV-A',
          'EVS',
          null as unknown as string,
          'Collect five leaves and paste them in the scrapbook',
          'Plants around us',
        ],
        [
          'IV-A',
          'MAT',
          null as unknown as string,
          'Tables 12 to 15, write twice',
          'Multiplication by two-digit numbers',
        ],
      ];
      const days = schoolDays(6);
      for (const [i, [sectionKey, subj, emp, hwTitle, cwTitle]] of plan.entries()) {
        const sectionIdValue = sections.ALPHA![sectionKey]!;
        const teacher =
          emp !== null
            ? await employeeId(alpha.id, emp)
            : ((
                await c.query<{ id: string }>(
                  `SELECT employee_id::text AS id FROM teacher_assignments WHERE class_section_id = $1 AND kind = 'class_teacher' AND valid_to IS NULL LIMIT 1`,
                  [sectionIdValue],
                )
              ).rows[0]?.id ?? null);
        const subjId = await subjectId(alpha.id, subj);
        const day = days[i % days.length]!;
        await c.query(
          `INSERT INTO daily_work (school_id, academic_year_id, class_section_id, subject_id, kind, title, body, assigned_on, due_on, posted_by_employee_id)
           VALUES ($1, $2, $3, $4, 'homework', $5, $6, $7::date, $8::date, $9)`,
          [
            alpha.id,
            alpha.yearId,
            sectionIdValue,
            subjId,
            hwTitle,
            'Please complete in the class notebook. Parents may sign the diary.',
            day,
            addDays(day, 2),
            teacher,
          ],
        );
        await c.query(
          `INSERT INTO daily_work (school_id, academic_year_id, class_section_id, subject_id, kind, title, body, assigned_on, posted_by_employee_id)
           VALUES ($1, $2, $3, $4, 'classwork', $5, $6, $7::date, $8)`,
          [
            alpha.id,
            alpha.yearId,
            sectionIdValue,
            subjId,
            cwTitle,
            'Covered in class today.',
            day,
            teacher,
          ],
        );
      }
      const maths = await subjectId(alpha.id, 'MAT');
      const sci = await subjectId(alpha.id, 'SCI');
      await c.query(
        `INSERT INTO daily_work (school_id, academic_year_id, class_section_id, subject_id, kind, title, body, assigned_on, due_on, posted_by_employee_id)
         VALUES ($1, $2, $3, $4, 'assignment', 'Maths project: measure your room and draw a scaled floor plan', 'Submit on A3 sheet with scale 1:50. Marks: 10.', $5::date, $6::date, $7),
                ($1, $2, $3, $8, 'assignment', 'Science: model of the water cycle', 'Working or static model; group of three.', $5::date, $9::date, $10)`,
        [
          alpha.id,
          alpha.yearId,
          sections.ALPHA!['VI-A'],
          maths,
          days[3],
          addDays(days[0]!, 10),
          await employeeId(alpha.id, 'E004'),
          sci,
          addDays(days[0]!, 14),
          await employeeId(alpha.id, 'E005'),
        ],
      );
    }

    // notices and circulars
    const noticeCount = await c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM notices WHERE school_id = $1`,
      [alpha.id],
    );
    if (Number(noticeCount.rows[0]!.n) === 0) {
      const classIds = await c.query<{ id: string; code: string }>(
        `SELECT id::text, code FROM classes WHERE school_id = $1 AND deleted_at IS NULL`,
        [alpha.id],
      );
      const classId = (code: string) => classIds.rows.find((k) => k.code === code)!.id;
      const notice = async (
        sub: string,
        fields: {
          kind?: string;
          title: string;
          body: string;
          audience?: string;
          pinned?: boolean;
          publish: boolean;
          daysAgo: number;
          until?: string | null;
          targets?: Array<[string, string]>;
        },
      ) => {
        const r = await c.query<{ id: string }>(
          `INSERT INTO notices (school_id, academic_year_id, kind, title, body, audience, publish_from, publish_until, is_pinned, published_at, published_by, created_by)
           VALUES ($1, $2, $3::notice_kind, $4, $5, $6::audience_kind, CURRENT_DATE - $7::int, $8::date, $9,
                   CASE WHEN $10 THEN now() - make_interval(days => $7::int) END, CASE WHEN $10 THEN $11::bigint END, $11::bigint)
           RETURNING id::text`,
          [
            alpha.id,
            alpha.yearId,
            fields.kind ?? 'notice',
            fields.title,
            fields.body,
            fields.audience ?? 'everyone',
            fields.daysAgo,
            fields.until ?? null,
            fields.pinned ?? false,
            fields.publish,
            userIds[sub],
          ],
        );
        for (const [type, id] of fields.targets ?? [])
          await c.query(
            `INSERT INTO notice_targets (notice_id, school_id, target_type, target_id) VALUES ($1, $2, $3::notice_target_type, $4)`,
            [r.rows[0]!.id, alpha.id, type, id],
          );
      };
      await notice('dev-admin', {
        title: 'School reopens after the Dussehra break on Thursday, 22 October',
        body: 'Regular timings apply from 22 October. Buses run on the usual routes. Students must carry the almanac and the ID card.',
        pinned: true,
        publish: true,
        daysAgo: 5,
      });
      await notice('dev-clerk', {
        title: 'Second fee instalment due by 10 October',
        body: 'The second instalment of the annual fee is due by 10 October 2026. Pay online through the parent app or at the fee counter between 8:30 am and 1:00 pm. A late fee applies after the due date.',
        audience: 'students',
        publish: true,
        daysAgo: 8,
        until: '2026-10-15',
      });
      await notice('dev-coordinator', {
        title: 'Parent–teacher meeting for Classes VI to VIII',
        body: 'The PTM is on Saturday, 3 October, 9:00 am to 12:00 noon. Please meet the class teacher first and then the subject teachers. Report cards of the half-yearly examination will be shared.',
        publish: true,
        daysAgo: 3,
        targets: [
          ['class', classId('VI')],
          ['class', classId('VII')],
          ['class', classId('VIII')],
        ],
      });
      await notice('dev-teacher', {
        title: 'VI-A: bring material for the science project on Monday',
        body: 'Groups should bring a shoebox, chart paper, cotton and glue. The project will be assessed on Friday.',
        publish: true,
        daysAgo: 1,
        targets: [['class_section', sections.ALPHA!['VI-A']!]],
      });
      await notice('dev-principal', {
        kind: 'circular',
        title: 'Staff meeting on Friday at 3:00 pm',
        body: 'Agenda: half-yearly result analysis, annual day rehearsals, timetable substitutions during the sports week. Attendance is mandatory for all teaching staff.',
        audience: 'employees',
        publish: true,
        daysAgo: 2,
      });
      await notice('dev-coordinator', {
        title: 'Annual day rehearsal schedule (draft)',
        body: 'Rehearsals for the annual day will run from 1 December. The class-wise schedule will be published after the PTM.',
        publish: false,
        daysAgo: 0,
      });
      const beta = schools.BETA!;
      await c.query(
        `INSERT INTO notices (school_id, academic_year_id, kind, title, body, audience, publish_from, is_pinned, published_at, published_by, created_by)
         VALUES ($1, $2, 'notice', 'Winter uniform from 1 November', 'Students should wear the winter uniform from 1 November. Blazers are available at the school store.', 'everyone', CURRENT_DATE - 2, false, now() - interval '2 days', $3, $3)`,
        [beta.id, beta.yearId, userIds['dev-admin']],
      );
    }

    // holidays and almanac
    for (const school of Object.values(schools)) {
      const holidayCount = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM holidays WHERE school_id = $1`,
        [school.id],
      );
      if (Number(holidayCount.rows[0]!.n) === 0) {
        const holidays: Array<[string, string, string, string]> = [
          ['Independence Day', 'holiday', '2026-08-15', '2026-08-15'],
          ['Ganesh Chaturthi', 'holiday', '2026-09-14', '2026-09-14'],
          ['Gandhi Jayanti', 'holiday', '2026-10-02', '2026-10-02'],
          ['Dussehra break', 'vacation', '2026-10-19', '2026-10-21'],
          ['Diwali break', 'vacation', '2026-11-07', '2026-11-12'],
          ['Guru Nanak Jayanti', 'holiday', '2026-11-24', '2026-11-24'],
          ['Christmas', 'holiday', '2026-12-25', '2026-12-25'],
          ['Winter break', 'vacation', '2026-12-26', '2027-01-01'],
          ['Republic Day', 'holiday', '2027-01-26', '2027-01-26'],
          ['Holi', 'holiday', '2027-03-03', '2027-03-04'],
        ];
        for (const [name, kind, from, to] of holidays)
          await c.query(
            `INSERT INTO holidays (school_id, academic_year_id, name, kind, starts_on, ends_on) VALUES ($1, $2, $3, $4::holiday_kind, $5::date, $6::date)`,
            [school.id, school.yearId, name, kind, from, to],
          );
        await c.query(
          `INSERT INTO holidays (school_id, academic_year_id, name, kind, starts_on, ends_on, applies_to) VALUES ($1, $2, 'Autumn break (students)', 'vacation', '2026-10-22', '2026-10-24', 'students')`,
          [school.id, school.yearId],
        );
      }
      const eventCount = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM almanac_events WHERE school_id = $1`,
        [school.id],
      );
      if (Number(eventCount.rows[0]!.n) === 0) {
        const events: Array<[string, string, string, string, string | null, string]> = [
          ['Half-yearly examinations', 'exam', '2026-09-21', '2026-09-30', null, 'everyone'],
          [
            'Parent–teacher meeting (VI to VIII)',
            'meeting',
            '2026-10-03',
            '2026-10-03',
            '09:00',
            'everyone',
          ],
          ['Report card distribution', 'deadline', '2026-10-09', '2026-10-09', null, 'students'],
          [
            'Staff development workshop',
            'meeting',
            '2026-10-17',
            '2026-10-17',
            '10:00',
            'employees',
          ],
          ['Inter-house sports week', 'activity', '2026-11-16', '2026-11-20', null, 'everyone'],
          ['Sports day', 'activity', '2026-12-15', '2026-12-15', '08:00', 'everyone'],
          ['Annual day', 'event', '2026-12-20', '2026-12-20', '17:00', 'everyone'],
          ['Pre-board examinations (X)', 'exam', '2027-01-11', '2027-01-22', null, 'students'],
          ['Annual examinations', 'exam', '2027-03-08', '2027-03-20', null, 'everyone'],
        ];
        for (const [title, kind, from, to, at, audience] of events)
          await c.query(
            `INSERT INTO almanac_events (school_id, academic_year_id, title, kind, starts_on, ends_on, starts_at, audience)
             VALUES ($1, $2, $3, $4::almanac_kind, $5::date, $6::date, $7::time, $8::audience_kind)`,
            [school.id, school.yearId, title, kind, from, to, at, audience],
          );
      }
    }

    // gallery: one album with placeholder images stored through the local driver
    const albumCount = await c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM gallery_albums WHERE school_id = $1`,
      [alpha.id],
    );
    if (Number(albumCount.rows[0]!.n) === 0) {
      const uploads = resolve(
        __dirname,
        '..',
        '..',
        '..',
        process.env.STORAGE_LOCAL_DIR ?? '.data/uploads',
      );
      const png = (r: number, g: number, b: number): Buffer => {
        // 1x1 PNG built by hand: signature, IHDR, IDAT (stored deflate block), IEND
        const crcTable = Array.from({ length: 256 }, (_, n) => {
          let cc = n;
          for (let k = 0; k < 8; k += 1) cc = cc & 1 ? 0xedb88320 ^ (cc >>> 1) : cc >>> 1;
          return cc >>> 0;
        });
        const crc = (buf: Buffer) => {
          let cc = 0xffffffff;
          for (const byte of buf) cc = crcTable[(cc ^ byte) & 0xff]! ^ (cc >>> 8);
          return (cc ^ 0xffffffff) >>> 0;
        };
        const chunk = (type: string, data: Buffer) => {
          const len = Buffer.alloc(4);
          len.writeUInt32BE(data.length);
          const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
          const cr = Buffer.alloc(4);
          cr.writeUInt32BE(crc(td));
          return Buffer.concat([len, td, cr]);
        };
        const ihdr = Buffer.alloc(13);
        ihdr.writeUInt32BE(1, 0);
        ihdr.writeUInt32BE(1, 4);
        ihdr[8] = 8;
        ihdr[9] = 2;
        const raw = Buffer.from([0, r, g, b]);
        const adler = (() => {
          let a = 1;
          let bb = 0;
          for (const byte of raw) {
            a = (a + byte) % 65521;
            bb = (bb + a) % 65521;
          }
          return ((bb << 16) | a) >>> 0;
        })();
        const stored = Buffer.concat([
          Buffer.from([
            0x78,
            0x01,
            0x01,
            raw.length & 0xff,
            (raw.length >> 8) & 0xff,
            ~raw.length & 0xff,
            (~raw.length >> 8) & 0xff,
          ]),
          raw,
          (() => {
            const b4 = Buffer.alloc(4);
            b4.writeUInt32BE(adler);
            return b4;
          })(),
        ]);
        return Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          chunk('IHDR', ihdr),
          chunk('IDAT', stored),
          chunk('IEND', Buffer.alloc(0)),
        ]);
      };
      const fileIds: string[] = [];
      const colours: Array<[string, number, number, number]> = [
        ['flag-hoisting.png', 0, 38, 93],
        ['march-past.png', 0, 160, 198],
        ['cultural-programme.png', 240, 128, 0],
      ];
      for (const [i, [name, r, g, b]] of colours.entries()) {
        const bytes = png(r, g, b);
        const objectKey = `school-${alpha.id}/2026/08/seed-gallery-${i + 1}.png`;
        const full = resolve(uploads, objectKey);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, bytes);
        const f = await c.query<{ id: string }>(
          `INSERT INTO files (school_id, bucket, object_key, content_type, size_bytes, original_name, classification, status, storage_driver, created_by)
           VALUES ($1, 'local', $2, 'image/png', $3, $4, 'public', 'ready', 'local', $5)
           ON CONFLICT (bucket, object_key) DO UPDATE SET status = 'ready' RETURNING id::text`,
          [alpha.id, objectKey, bytes.length, name, userIds['dev-admin']],
        );
        fileIds.push(f.rows[0]!.id);
      }
      const album = await c.query<{ id: string }>(
        `INSERT INTO gallery_albums (school_id, academic_year_id, title, description, event_on, cover_file_id, created_by)
         VALUES ($1, $2, 'Independence Day 2026', 'Flag hoisting, march past and the cultural programme.', '2026-08-15', $3, $4) RETURNING id::text`,
        [alpha.id, alpha.yearId, fileIds[0], userIds['dev-admin']],
      );
      for (const [i, fileId] of fileIds.entries())
        await c.query(
          `INSERT INTO gallery_items (school_id, album_id, file_id, caption, sort_order) VALUES ($1, $2, $3, $4, $5)`,
          [
            alpha.id,
            album.rows[0]!.id,
            fileId,
            colours[i]![0].replace('.png', '').replace('-', ' '),
            i,
          ],
        );
    }

    // transfer certificate for the student who left (issued by the front office)
    const tcCount = await c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM transfer_certificates WHERE school_id = $1`,
      [alpha.id],
    );
    if (Number(tcCount.rows[0]!.n) === 0) {
      const leaver = await c.query<{ id: string; snapshot: unknown; last_class: string | null }>(
        `SELECT s.id::text,
                (SELECT c.code || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes c ON c.id = cs.class_id
                  WHERE e.student_id = s.id ORDER BY e.academic_year_id DESC LIMIT 1) AS last_class,
                jsonb_build_object('name', s.display_name, 'admissionNo', s.admission_no, 'dob', to_char(s.dob, 'DD Mon YYYY'), 'gender', s.gender::text,
                  'category', s.category, 'admittedOn', to_char(s.admitted_on, 'DD Mon YYYY'), 'house', s.house,
                  'guardianName', (SELECT g.display_name FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id WHERE sg.student_id = s.id ORDER BY sg.is_primary DESC LIMIT 1),
                  'guardianMobile', (SELECT g.mobile FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id WHERE sg.student_id = s.id ORDER BY sg.is_primary DESC LIMIT 1)) AS snapshot
           FROM students s WHERE s.school_id = $1 AND s.status = 'inactive' ORDER BY s.id LIMIT 1`,
        [alpha.id],
      );
      if (leaver.rows[0]) {
        await withCtx(alpha.id, 'dev-clerk');
        const no = await c.query<{ tc_no: string; serial: number }>(
          `SELECT * FROM app.next_tc_no('2026-27')`,
        );
        const template = await c.query<{ id: string }>(
          `SELECT id::text FROM document_templates WHERE school_id = $1 AND kind = 'transfer_certificate' AND deleted_at IS NULL LIMIT 1`,
          [alpha.id],
        );
        await c.query(
          `INSERT INTO transfer_certificates (school_id, student_id, academic_year_id, tc_no, serial, issued_on, reason, last_class, conduct, promotion_status, dues_cleared, remarks, snapshot, template_id, issued_by)
           VALUES ($1, $2, $3, $4, $5, CURRENT_DATE - 9, 'Family relocated to Bengaluru', $6, 'Good', 'Eligible for promotion to the next class', true, 'All library books returned; no dues.', $7::jsonb, $8, $9)`,
          [
            alpha.id,
            leaver.rows[0].id,
            alpha.yearId,
            no.rows[0]!.tc_no,
            no.rows[0]!.serial,
            leaver.rows[0].last_class,
            JSON.stringify(leaver.rows[0].snapshot),
            template.rows[0]?.id ?? null,
            userIds['dev-clerk'],
          ],
        );
        await clearCtx();
      }
    }

    // a withdrawal in progress: two departments cleared, transport on hold, academics pending
    const withdrawalCount = await c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM student_withdrawals WHERE school_id = $1`,
      [alpha.id],
    );
    if (Number(withdrawalCount.rows[0]!.n) === 0) {
      const candidate = await c.query<{ id: string }>(
        `SELECT s.id::text FROM students s JOIN enrolments e ON e.student_id = s.id AND e.status = 'active'
          WHERE s.school_id = $1 AND s.status = 'active' AND e.class_section_id = $2 ORDER BY e.roll_no DESC LIMIT 1`,
        [alpha.id, sections.ALPHA!['IX-B']],
      );
      if (candidate.rows[0]) {
        const w = await c.query<{ id: string }>(
          `INSERT INTO student_withdrawals (school_id, student_id, academic_year_id, requested_on, leaving_on, reason, requested_by)
           VALUES ($1, $2, $3, CURRENT_DATE - 4, CURRENT_DATE + 20, 'Father transferred to Hyderabad', $4) RETURNING id::text`,
          [alpha.id, candidate.rows[0].id, alpha.yearId, userIds['dev-clerk']],
        );
        const clearances: Array<[string, string, string, string | null, string | null]> = [
          ['fees', 'cleared', '0', 'No dues after the second instalment', 'dev-admin'],
          ['library', 'cleared', '0', 'Two books returned on 24 Sep', 'dev-admin'],
          [
            'transport',
            'hold',
            '1500.00',
            'Bus pass not returned; refundable deposit pending',
            'dev-clerk',
          ],
          ['academics', 'pending', '0', null, null],
        ];
        for (const [department, status, dues, remarks, by] of clearances)
          await c.query(
            `INSERT INTO withdrawal_clearances (school_id, withdrawal_id, department, status, dues, remarks, acted_by, acted_at)
             VALUES ($1, $2, $3, $4::clearance_status, $5, $6, $7, CASE WHEN $7::bigint IS NULL THEN NULL ELSE now() - interval '1 day' END)`,
            [alpha.id, w.rows[0]!.id, department, status, dues, remarks, by ? userIds[by] : null],
          );
      }
    }

    // promotion decisions: sections for 2027-28 and decisions for IX-A (promote/retain) and X-A (graduate)
    const nextYear = await c.query<{ id: string }>(
      `SELECT id::text FROM academic_years WHERE school_id = $1 AND code = '2027-28'`,
      [alpha.id],
    );
    if (nextYear.rows[0]) {
      const nextYearId = nextYear.rows[0].id;
      const classRows = await c.query<{ id: string; code: string }>(
        `SELECT id::text, code FROM classes WHERE school_id = $1 AND deleted_at IS NULL`,
        [alpha.id],
      );
      for (const cls of classRows.rows)
        for (const sec of ['A', 'B'])
          await c.query(
            `INSERT INTO class_sections (school_id, academic_year_id, class_id, campus_id, name, capacity)
             SELECT $1, $2, $3, $4, $5, 40 WHERE NOT EXISTS (SELECT 1 FROM class_sections WHERE academic_year_id = $2 AND class_id = $3 AND name = $5)`,
            [alpha.id, nextYearId, cls.id, alpha.campusId, sec],
          );
      const decisionCount = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM promotion_decisions WHERE school_id = $1`,
        [alpha.id],
      );
      if (Number(decisionCount.rows[0]!.n) === 0) {
        const nextSection = async (classCode: string, name: string) =>
          (
            await c.query<{ id: string }>(
              `SELECT cs.id::text FROM class_sections cs JOIN classes c ON c.id = cs.class_id WHERE cs.academic_year_id = $1 AND c.code = $2 AND cs.name = $3`,
              [nextYearId, classCode, name],
            )
          ).rows[0]!.id;
        const ixA = await c.query<{ id: string; enrolment_id: string; roll_no: number }>(
          `SELECT s.id::text, e.id::text AS enrolment_id, e.roll_no FROM enrolments e JOIN students s ON s.id = e.student_id
            WHERE e.class_section_id = $1 AND e.status = 'active' ORDER BY e.roll_no`,
          [sections.ALPHA!['IX-A']],
        );
        const xA = await nextSection('X', 'A');
        const ixANext = await nextSection('IX', 'A');
        for (const st of ixA.rows)
          await c.query(
            `INSERT INTO promotion_decisions (school_id, from_year_id, to_year_id, student_id, from_enrolment_id, decision, to_class_section_id, remarks, decided_by)
             VALUES ($1, $2, $3, $4, $5, $6::promotion_decision, $7, $8, $9)`,
            [
              alpha.id,
              alpha.yearId,
              nextYearId,
              st.id,
              st.enrolment_id,
              st.roll_no === 8 ? 'retain' : 'promote',
              st.roll_no === 8 ? ixANext : xA,
              st.roll_no === 8
                ? 'Below 33% in three subjects; retained after the parent meeting'
                : null,
              userIds['dev-coordinator'],
            ],
          );
        const xAStudents = await c.query<{ id: string; enrolment_id: string }>(
          `SELECT s.id::text, e.id::text AS enrolment_id FROM enrolments e JOIN students s ON s.id = e.student_id
            WHERE e.class_section_id = $1 AND e.status = 'active' ORDER BY e.roll_no LIMIT 4`,
          [sections.ALPHA!['X-A']],
        );
        for (const st of xAStudents.rows)
          await c.query(
            `INSERT INTO promotion_decisions (school_id, from_year_id, to_year_id, student_id, from_enrolment_id, decision, decided_by)
             VALUES ($1, $2, $3, $4, $5, 'graduate', $6)`,
            [
              alpha.id,
              alpha.yearId,
              nextYearId,
              st.id,
              st.enrolment_id,
              userIds['dev-coordinator'],
            ],
          );
      }
    }

    // ---- Sprint 8: fee masters, student fee profiles and demands; admission cycles and applications ---
    const feeHeadIds: Record<string, Record<string, string>> = {};
    for (const [schoolCode, school] of Object.entries(schools)) {
      feeHeadIds[schoolCode] = {};
      const heads: Array<[string, string, string, number]> = [
        ['TUI', 'Tuition fee', 'regular', 1],
        ['DEV', 'Development fee', 'regular', 2],
        ['COMP', 'Computer fee', 'regular', 3],
        ['ANN', 'Annual charges', 'regular', 4],
        ['EXAM', 'Examination fee', 'regular', 5],
        ['TRN', 'Transport fee', 'transport', 6],
        ['OPB', 'Opening balance', 'opening_balance', 7],
        ['LATE', 'Late fee', 'late_fee', 8],
      ];
      for (const [code, name, kind, order] of heads) {
        const r = await c.query<{ id: string }>(
          `INSERT INTO fee_heads (school_id, code, name, kind, sort_order, legacy_ref) VALUES ($1, $2, $3, $4::fee_head_kind, $5, $2)
           ON CONFLICT (school_id, code) WHERE deleted_at IS NULL DO UPDATE SET name = EXCLUDED.name RETURNING id::text`,
          [school.id, code, name, kind, order],
        );
        feeHeadIds[schoolCode]![code] = r.rows[0]!.id;
      }
      const periodCount = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM fee_periods WHERE academic_year_id = $1`,
        [school.yearId],
      );
      if (Number(periodCount.rows[0]!.n) === 0) {
        const monthNames = [
          'January',
          'February',
          'March',
          'April',
          'May',
          'June',
          'July',
          'August',
          'September',
          'October',
          'November',
          'December',
        ];
        for (let i = 0; i < 12; i += 1) {
          const m0 = 3 + i; // April = index 3
          const month = (m0 % 12) + 1;
          const year = 2026 + Math.floor(m0 / 12);
          const first = i - (i % 3);
          const dueYear = 2026 + Math.floor((3 + first) / 12);
          const dueMonth = ((3 + first) % 12) + 1;
          await c.query(
            `INSERT INTO fee_periods (school_id, academic_year_id, sequence, name, month, year, instalment, due_on) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date)`,
            [
              school.id,
              school.yearId,
              i + 1,
              `${monthNames[month - 1]} ${year}`,
              month,
              year,
              Math.floor(i / 3) + 1,
              `${dueYear}-${pad(dueMonth, 2)}-10`,
            ],
          );
        }
      }
      const classRows = await c.query<{ id: string; code: string }>(
        `SELECT id::text, code FROM classes WHERE school_id = $1 AND deleted_at IS NULL`,
        [school.id],
      );
      for (const cls of classRows.rows) {
        const order = CLASSES.findIndex(([code]) => code === cls.code) + 1;
        const entries: Array<[string, number, string]> = [
          ['TUI', 1500 + 100 * order, 'monthly'],
          ['DEV', 1000, 'quarterly'],
          ['COMP', order >= 6 ? 300 : 200, 'monthly'],
          ['ANN', 3000, 'annual'],
          ['EXAM', 300, 'half_yearly'],
        ];
        for (const [code, amount, frequency] of entries)
          await c.query(
            `INSERT INTO fee_structures (school_id, academic_year_id, class_id, head_id, fee_group, student_type, amount, frequency)
             VALUES ($1, $2, $3, $4, 'general', 'all', $5, $6::fee_frequency) ON CONFLICT (academic_year_id, class_id, head_id, fee_group, student_type) DO NOTHING`,
            [school.id, school.yearId, cls.id, feeHeadIds[schoolCode]![code], amount, frequency],
          );
      }
      const slabs: Array<[string, string, number, number, number]> = [
        ['S1', 'Up to 3 km', 0, 3, 1200],
        ['S2', '3 to 8 km', 3, 8, 1500],
        ['S3', '8 to 15 km', 8, 15, 1800],
      ];
      for (const [code, name, from, to, amount] of slabs)
        await c.query(
          `INSERT INTO transport_slabs (school_id, academic_year_id, code, name, distance_from_km, distance_to_km, monthly_amount) VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (academic_year_id, code) DO NOTHING`,
          [school.id, school.yearId, code, name, from, to, amount],
        );
      const discounts: Array<[string, string, string | null, number]> = [
        ['SIB', 'Sibling (50% tuition)', 'TUI', 50],
        ['STAFF', 'Staff ward (100%)', null, 100],
        ['EWS', 'EWS (25%)', null, 25],
      ];
      for (const [code, name, head, percent] of discounts)
        await c.query(
          `INSERT INTO fee_discounts (school_id, academic_year_id, code, name, head_id, percent) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (academic_year_id, code) DO NOTHING`,
          [
            school.id,
            school.yearId,
            code,
            name,
            head ? feeHeadIds[schoolCode]![head] : null,
            percent,
          ],
        );
      await c.query(
        `INSERT INTO school_settings (school_id, key, value) SELECT $1, 'fees.transport_for_discounted', 'true'::jsonb WHERE NOT EXISTS (SELECT 1 FROM school_settings WHERE school_id = $1 AND key = 'fees.transport_for_discounted')`,
        [school.id],
      );
    }
    // profiles and demands for VI-A and VI-B (Alpha), generated as the accountant
    {
      const slabIds = Object.fromEntries(
        (
          await c.query<{ code: string; id: string }>(
            `SELECT code, id::text FROM transport_slabs WHERE academic_year_id = $1`,
            [alpha.yearId],
          )
        ).rows.map((x) => [x.code, x.id]),
      );
      const discountIds = Object.fromEntries(
        (
          await c.query<{ code: string; id: string }>(
            `SELECT code, id::text FROM fee_discounts WHERE academic_year_id = $1`,
            [alpha.yearId],
          )
        ).rows.map((x) => [x.code, x.id]),
      );
      const pupils = await c.query<{ id: string; is_new: boolean }>(
        `SELECT s.id::text, (s.admitted_on >= y.start_date) AS is_new FROM enrolments e JOIN students s ON s.id = e.student_id JOIN academic_years y ON y.id = e.academic_year_id
          WHERE e.academic_year_id = $1 AND e.class_section_id = ANY($2::bigint[]) AND e.status = 'active' AND s.status = 'active' ORDER BY e.class_section_id, e.roll_no`,
        [alpha.yearId, [sections.ALPHA!['VI-A'], sections.ALPHA!['VI-B']]],
      );
      await withCtx(alpha.id, 'dev-accounts');
      for (const [i, p] of pupils.rows.entries()) {
        const discount =
          i % 8 === 0
            ? discountIds.SIB
            : i % 8 === 3
              ? discountIds.STAFF
              : i % 8 === 6
                ? discountIds.EWS
                : null;
        const slab = i % 3 === 0 ? slabIds.S2 : i % 3 === 1 ? slabIds.S1 : null;
        await c.query(
          `INSERT INTO student_fee_profiles (school_id, student_id, academic_year_id, fee_group, student_type, transport_slab_id, discount_id, opening_balance, created_by, updated_by)
           VALUES ($1, $2, $3, 'general', $4, $5, $6, $7, $8, $8) ON CONFLICT (student_id, academic_year_id) DO NOTHING`,
          [
            alpha.id,
            p.id,
            alpha.yearId,
            p.is_new ? 'new' : 'old',
            slab ?? null,
            discount ?? null,
            i % 5 === 4 ? 2500 : 0,
            userIds['dev-accounts'],
          ],
        );
        const has = await c.query(
          `SELECT 1 FROM fee_demands WHERE student_id = $1 AND academic_year_id = $2 LIMIT 1`,
          [p.id, alpha.yearId],
        );
        if (has.rowCount === 0)
          await c.query(`SELECT app.generate_fee_demand($1, $2)`, [p.id, alpha.yearId]);
      }
      await clearCtx();
    }

    // admission cycle 2027-28 for Alpha (open) with applications, and a draft cycle for Beta
    for (const [schoolCode, school] of Object.entries(schools)) {
      const target = await c.query<{ id: string }>(
        `SELECT id::text FROM academic_years WHERE school_id = $1 AND code = '2027-28'`,
        [school.id],
      );
      if (!target.rows[0]) continue;
      const exists = await c.query(
        `SELECT 1 FROM admission_cycles WHERE school_id = $1 AND code = 'ADM-2027-28' AND deleted_at IS NULL`,
        [school.id],
      );
      if (exists.rowCount) continue;
      const cyc = await c.query<{ id: string }>(
        `INSERT INTO admission_cycles (school_id, academic_year_id, code, name, name_hi, instructions, instructions_hi, opens_at, closes_at, status, form_schema, application_fee, created_by)
         VALUES ($1, $2, 'ADM-2027-28', 'Admissions 2027-28', 'प्रवेश 2027-28',
                 'Fill the form in one sitting; keep the birth certificate and address proof ready. The registration fee is payable after submission.',
                 'फ़ॉर्म एक बार में भरें; जन्म प्रमाणपत्र और पते का प्रमाण तैयार रखें। पंजीकरण शुल्क जमा करने के बाद देय है।',
                 now() - interval '10 days', now() + interval '45 days', $3::admission_cycle_status, $4::jsonb, 500, $5) RETURNING id::text`,
        [
          school.id,
          target.rows[0].id,
          schoolCode === 'ALPHA' ? 'open' : 'draft',
          JSON.stringify(DEFAULT_ADMISSION_FORM),
          userIds['dev-admin'],
        ],
      );
      const cycleId = cyc.rows[0]!.id;
      const classOf = async (code: string) =>
        (
          await c.query<{ id: string }>(
            `SELECT id::text FROM classes WHERE school_id = $1 AND code = $2 AND deleted_at IS NULL`,
            [school.id, code],
          )
        ).rows[0]?.id;
      const criteria: Array<[string, number, string, string, string | null]> = [
        ['I', 60, '2020-04-01', '2021-03-31', null],
        ['VI', 20, '2015-04-01', '2016-03-31', 'ALPHA-VI'],
        ['IX', 10, '2012-04-01', '2013-03-31', null],
      ];
      for (const [code, seats, from, to, passcode] of criteria) {
        const classId = await classOf(code);
        if (!classId) continue;
        await c.query(
          `INSERT INTO admission_class_criteria (school_id, cycle_id, class_id, seats, dob_from, dob_to, passcode) VALUES ($1, $2, $3, $4, $5::date, $6::date, $7)`,
          [school.id, cycleId, classId, seats, from, to, passcode],
        );
      }
      const scoring: Array<[string, string, number, string | null]> = [
        ['sibling', 'Sibling in school', 20, 'sibling'],
        ['staff_ward', 'Ward of staff', 25, 'staff_ward'],
        ['alumni', 'Alumni parent', 10, 'alumni'],
        ['distance', 'Within 5 km', 15, 'distance_within:5'],
        ['girl', 'Single girl child', 5, 'single_girl_child'],
        ['interview', 'Interaction', 30, null],
      ];
      for (const [i, [code, name, points, rule]] of scoring.entries())
        await c.query(
          `INSERT INTO admission_score_criteria (school_id, cycle_id, code, name, points, auto_rule, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [school.id, cycleId, code, name, points, rule, i],
        );
      if (schoolCode !== 'ALPHA') continue;

      await withCtx(alpha.id, 'dev-admin');
      const applicants: Array<[string, string]> = [
        ['9811000001', 'Neha Kapoor'],
        ['9811000002', 'Amit Joshi'],
        ['9811000003', 'Farah Khan'],
        ['9811000004', 'Sunil Patil'],
        ['9811000005', 'Rekha Menon'],
        ['9811000006', 'Vikram Rao'],
        ['9811000007', 'Pooja Nair'],
        ['9811000008', 'Tanvir Singh'],
        ['9811000009', 'Meera Das'],
        ['9811000010', 'Karan Malhotra'],
        ['9999900001', 'Dev Applicant'],
      ];
      const applicantIds: string[] = [];
      for (const [mobile, name] of applicants) {
        const a = await c.query<{ id: string }>(
          `INSERT INTO applicants (school_id, mobile, name, last_login_at) VALUES ($1, $2, $3, now() - interval '3 days') ON CONFLICT (school_id, mobile) DO UPDATE SET name = EXCLUDED.name RETURNING id::text`,
          [school.id, mobile, name],
        );
        applicantIds.push(a.rows[0]!.id);
      }
      const children: Array<[string, string, string, string, string, string]> = [
        // first, last, dob, gender, class, status
        ['Ishaan', 'Kapoor', '2020-07-12', 'male', 'I', 'submitted'],
        ['Myra', 'Joshi', '2020-11-03', 'female', 'I', 'under_review'],
        ['Zara', 'Khan', '2021-01-20', 'female', 'I', 'shortlisted'],
        ['Advait', 'Patil', '2020-05-30', 'male', 'I', 'selected'],
        ['Anvi', 'Menon', '2020-09-09', 'female', 'I', 'submitted'],
        ['Kabir', 'Rao', '2015-06-18', 'male', 'VI', 'submitted'],
        ['Saanvi', 'Nair', '2015-10-02', 'female', 'VI', 'rejected'],
        ['Arjun', 'Singh', '2015-12-25', 'male', 'VI', 'under_review'],
        ['Riya', 'Das', '2012-08-14', 'female', 'IX', 'shortlisted'],
        ['Ishaan', 'Kapoor', '2020-07-12', 'male', 'I', 'submitted'], // possible duplicate of the first child, another mobile
        ['Dev', 'Child', '2020-06-01', 'male', 'I', 'submitted'],
      ];
      let firstId: string | null = null;
      let application: { rows: Array<{ id: string }> };
      for (const [i, [first, last, dob, gender, classCode, status]] of children.entries()) {
        const classId = await classOf(classCode);
        if (!classId) continue;
        const data = {
          fatherName: `${applicants[i]![1].split(' ')[0]} ${last}`,
          motherName: `Mrs ${last}`,
          email: `${first.toLowerCase()}.${last.toLowerCase()}@example.test`,
          address: `${12 + i}, Model Colony`,
          city: 'Pune',
          pin: '411016',
          distanceKm: 2 + (i % 7),
          category: i % 4 === 3 ? 'EWS' : 'GEN',
          alumniParent: i % 3 === 0,
          siblingInSchool: false,
          staffWard: false,
          singleGirlChild: gender === 'female' && i % 2 === 0,
        };
        const breakdown: Array<{ code: string; name: string; points: number; source: string }> = [];
        if (data.distanceKm <= 5)
          breakdown.push({ code: 'distance', name: 'Within 5 km', points: 15, source: 'auto' });
        if (data.alumniParent)
          breakdown.push({ code: 'alumni', name: 'Alumni parent', points: 10, source: 'auto' });
        if (data.singleGirlChild)
          breakdown.push({ code: 'girl', name: 'Single girl child', points: 5, source: 'auto' });
        if (status === 'shortlisted' || status === 'selected')
          breakdown.push({ code: 'interview', name: 'Interaction', points: 30, source: 'manual' });
        const score = breakdown.reduce((sum, b) => sum + b.points, 0);
        const no = await c.query<{ application_no: string; serial: number }>(
          `SELECT * FROM app.next_application_no($1)`,
          [cycleId],
        );
        application = await c.query<{ id: string }>(
          `INSERT INTO applications (school_id, cycle_id, class_id, applicant_id, application_no, serial, status, child_first_name, child_last_name, child_dob, child_gender, data, passcode_used, score, score_breakdown, possible_duplicate_of, submitted_at, decided_at, decided_by, remarks)
           VALUES ($1, $2, $3, $4, $5, $6, $7::application_status, $8, $9, $10::date, $11::gender, $12::jsonb, $13, $14, $15::jsonb, $16, now() - make_interval(days => $17), CASE WHEN $7 IN ('selected', 'rejected') THEN now() - interval '1 day' END, CASE WHEN $7 IN ('selected', 'rejected') THEN $18::bigint END, $19)
           RETURNING id::text`,
          [
            school.id,
            cycleId,
            classId,
            applicantIds[i],
            no.rows[0]!.application_no,
            no.rows[0]!.serial,
            status,
            first,
            last,
            dob,
            gender,
            JSON.stringify(data),
            classCode === 'VI' ? 'ALPHA-VI' : null,
            score,
            JSON.stringify(breakdown),
            i === 9 ? firstId : null,
            9 - Math.min(i, 8),
            userIds['dev-coordinator'],
            status === 'rejected'
              ? 'Age criteria met; interaction not cleared'
              : status === 'selected'
                ? 'Offer letter to be issued'
                : null,
          ],
        );
        if (i === 0) firstId = application.rows[0]!.id;
        await c.query(
          `INSERT INTO application_events (school_id, application_id, from_status, to_status, note, actor_applicant_id, created_at) VALUES
             ($1, $2, NULL, 'draft', 'created', $3, now() - make_interval(days => $4)),
             ($1, $2, 'draft', 'submitted', $5, $3, now() - make_interval(days => $4) + interval '10 minutes')`,
          [
            school.id,
            application.rows[0]!.id,
            applicantIds[i],
            9 - Math.min(i, 8),
            no.rows[0]!.application_no,
          ],
        );
        if (status !== 'submitted')
          await c.query(
            `INSERT INTO application_events (school_id, application_id, from_status, to_status, note, actor_user_id, created_at) VALUES ($1, $2, 'submitted', $3::application_status, $4, $5, now() - interval '1 day')`,
            [
              school.id,
              application.rows[0]!.id,
              status,
              status === 'shortlisted' ? 'Interaction on Saturday 10:00' : null,
              userIds['dev-coordinator'],
            ],
          );
      }
      await clearCtx();
    }

    // ---- Sprint 9: workflow definitions and approvals, offers with a paid admission fee, attendance, RFID ----
    for (const school of Object.values(schools)) {
      await c.query(
        `INSERT INTO workflow_definitions (school_id, code, name, entity_type, levels, created_by)
         SELECT $1, 'admission_approval', 'Admission approval', 'application', $2::jsonb, $3
          WHERE NOT EXISTS (SELECT 1 FROM workflow_definitions WHERE school_id = $1 AND code = 'admission_approval' AND deleted_at IS NULL)`,
        [
          school.id,
          JSON.stringify([
            {
              level: 1,
              name: 'Academic Coordinator review',
              resolver: { kind: 'role', roleCode: 'academic_coordinator' },
              slaHours: 48,
            },
            {
              level: 2,
              name: 'Principal approval',
              resolver: { kind: 'role', roleCode: 'school_admin' },
              slaHours: 48,
            },
          ]),
          userIds['dev-admin'],
        ],
      );
      for (const [key, value] of [
        ['admissions.admission_fee', school.id === alpha.id ? '8000' : '5000'],
        ['attendance.rfid_late_after', '"08:15"'],
        ['attendance.weekly_off', '[7]'],
      ] as Array<[string, string]>)
        await c.query(
          `INSERT INTO school_settings (school_id, key, value) SELECT $1, $2, $3::jsonb WHERE NOT EXISTS (SELECT 1 FROM school_settings WHERE school_id = $1 AND key = $2)`,
          [school.id, key, value],
        );
    }
    {
      await withCtx(alpha.id, 'dev-admin');
      const def = await c.query<{ id: string }>(
        `SELECT id::text FROM workflow_definitions WHERE school_id = $1 AND code = 'admission_approval' AND deleted_at IS NULL`,
        [alpha.id],
      );
      const admins = [userIds['dev-admin']!, userIds['dev-principal']!];
      // applications under review wait in the coordinator's inbox; one already has the coordinator's approval
      const pending = await c.query<{
        id: string;
        application_no: string;
        child: string;
        class_code: string;
      }>(
        `SELECT a.id::text, a.application_no, a.child_first_name || ' ' || COALESCE(a.child_last_name, '') AS child, k.code AS class_code
           FROM applications a JOIN classes k ON k.id = a.class_id JOIN admission_cycles cy ON cy.id = a.cycle_id
          WHERE a.school_id = $1 AND cy.code = 'ADM-2027-28' AND a.status = 'under_review' AND a.workflow_instance_id IS NULL ORDER BY a.id`,
        [alpha.id],
      );
      for (const [i, app] of pending.rows.entries()) {
        const advanced = i === 0;
        const inst = await c.query<{ id: string }>(
          `INSERT INTO workflow_instances (school_id, definition_id, entity_type, entity_id, subject, payload, status, current_level, requested_by, requested_at)
           VALUES ($1, $2, 'application', $3, $4, $5::jsonb, 'pending', $6, $7, now() - interval '2 days') RETURNING id::text`,
          [
            alpha.id,
            def.rows[0]!.id,
            app.id,
            `${app.application_no} · ${app.child.trim()} · Class ${app.class_code}`,
            JSON.stringify({ applicationId: app.id, classCode: app.class_code }),
            advanced ? 2 : 1,
            userIds['dev-admin'],
          ],
        );
        await c.query(
          `INSERT INTO workflow_steps (school_id, instance_id, level, name, resolver, assignee_user_ids, status, acted_by, acted_at, note)
           VALUES ($1, $2, 1, 'Academic Coordinator review', '{"kind":"role","roleCode":"academic_coordinator"}'::jsonb, $3::bigint[], $4::step_status, $5, CASE WHEN $4 = 'approved' THEN now() - interval '1 day' END, $6)`,
          [
            alpha.id,
            inst.rows[0]!.id,
            [userIds['dev-coordinator']],
            advanced ? 'approved' : 'pending',
            advanced ? userIds['dev-coordinator'] : null,
            advanced ? 'Documents verified at the interaction' : null,
          ],
        );
        if (advanced)
          await c.query(
            `INSERT INTO workflow_steps (school_id, instance_id, level, name, resolver, assignee_user_ids, status)
             VALUES ($1, $2, 2, 'Principal approval', '{"kind":"role","roleCode":"school_admin"}'::jsonb, $3::bigint[], 'pending')`,
            [alpha.id, inst.rows[0]!.id, admins],
          );
        await c.query(`UPDATE applications SET workflow_instance_id = $2 WHERE id = $1`, [
          app.id,
          inst.rows[0]!.id,
        ]);
      }
      // the selected application holds an offer whose admission fee was paid through the mock gateway
      const selected = await c.query<{
        id: string;
        applicant_id: string;
        child: string;
        mobile: string;
        name: string | null;
      }>(
        `SELECT a.id::text, a.applicant_id::text, a.child_first_name || ' ' || COALESCE(a.child_last_name, '') AS child, p.mobile, p.name
           FROM applications a JOIN applicants p ON p.id = a.applicant_id JOIN admission_cycles cy ON cy.id = a.cycle_id
          WHERE a.school_id = $1 AND cy.code = 'ADM-2027-28' AND a.status = 'selected'
            AND NOT EXISTS (SELECT 1 FROM admission_offers o WHERE o.application_id = a.id) ORDER BY a.id`,
        [alpha.id],
      );
      for (const app of selected.rows) {
        const intent = await c.query<{ id: string }>(
          `INSERT INTO payment_intents (school_id, purpose, entity_type, entity_id, amount, status, provider, txn_id, provider_ref, payer_name, payer_email, payer_mobile, return_url, created_by_applicant, succeeded_at, meta, created_at)
           VALUES ($1, 'admission_fee', 'application', $2, 8000, 'succeeded', 'mock', $3, $4, $5, $6, $7, 'http://localhost:3003/alpha/status', $8, now() - interval '20 hours', $9::jsonb, now() - interval '1 day') RETURNING id::text`,
          [
            alpha.id,
            app.id,
            `EPDEMO${app.id.padStart(6, '0')}`,
            `MOCK${app.id.padStart(8, '0')}`,
            app.name ?? 'Applicant',
            `applicant${app.id}@example.test`,
            app.mobile,
            app.applicant_id,
            JSON.stringify({ applicationId: app.id, seeded: true }),
          ],
        );
        for (const [kind, offset] of [
          ['created', '1 day'],
          ['webhook', '20 hours'],
        ] as Array<[string, string]>)
          await c.query(
            `INSERT INTO payment_events (school_id, intent_id, kind, provider_ref, payload, created_at) VALUES ($1, $2, $3, $4, '{"seeded":true}'::jsonb, now() - $5::interval)`,
            [
              alpha.id,
              intent.rows[0]!.id,
              kind,
              kind === 'webhook' ? `MOCK${app.id.padStart(8, '0')}` : null,
              offset,
            ],
          );
        await c.query(
          `INSERT INTO admission_offers (school_id, application_id, offered_at, expires_at, admission_fee, intent_id, status, accepted_at, created_by)
           VALUES ($1, $2, now() - interval '1 day', now() + interval '13 days', 8000, $3, 'accepted', now() - interval '20 hours', $4) ON CONFLICT (application_id) DO NOTHING`,
          [alpha.id, app.id, intent.rows[0]!.id, userIds['dev-admin']],
        );
        await c.query(
          `UPDATE applications SET fee_paid_at = now() - interval '20 hours' WHERE id = $1`,
          [app.id],
        );
      }
      // a failed online fee instalment attempt by Aarav's guardian, for the payments list
      const aarav = await c.query<{ id: string }>(
        `SELECT id::text FROM students WHERE school_id = $1 AND (user_id = $2 OR (first_name = 'Aarav' AND last_name = 'Sharma')) ORDER BY (user_id = $2) DESC LIMIT 1`,
        [alpha.id, userIds['dev-student']],
      );
      if (aarav.rows[0]) {
        await c.query(
          `INSERT INTO payment_intents (school_id, purpose, entity_type, entity_id, amount, status, provider, txn_id, payer_name, payer_mobile, created_by_user, failed_reason, meta, created_at)
           SELECT $1, 'fee_instalment', 'student', $2, 4500, 'failed', 'mock', $3, 'Suresh Sharma', '9876543210', $4, 'Cancelled by user at the bank page', '{"seeded":true}'::jsonb, now() - interval '3 days'
            WHERE NOT EXISTS (SELECT 1 FROM payment_intents WHERE txn_id = $3)`,
          [
            alpha.id,
            aarav.rows[0].id,
            `EPDEMOFAIL${aarav.rows[0].id.padStart(6, '0')}`,
            userIds['dev-parent'],
          ],
        );
      }

      // a cash instalment received at the counter for Aarav, allocated to the oldest dues
      if (aarav.rows[0]) {
        const paid = await c.query(
          `SELECT 1 FROM fee_payments WHERE student_id = $1 AND reference = 'RCPT-DEMO-0001'`,
          [aarav.rows[0].id],
        );
        const due = await c.query(
          `SELECT 1 FROM fee_demands WHERE student_id = $1 AND academic_year_id = $2 LIMIT 1`,
          [aarav.rows[0].id, alpha.yearId],
        );
        if (!paid.rowCount && due.rowCount) {
          const fp = await c.query<{ id: string }>(
            `INSERT INTO fee_payments (school_id, student_id, academic_year_id, amount, received_on, mode, reference, remarks, received_by)
             VALUES ($1, $2, $3, 4500, CURRENT_DATE - 2, 'cash', 'RCPT-DEMO-0001', 'First instalment at the counter', $4) RETURNING id::text`,
            [alpha.id, aarav.rows[0].id, alpha.yearId, userIds['dev-accounts']],
          );
          await c.query(`SELECT app.allocate_fee_payment($1)`, [fp.rows[0]!.id]);
        }
      }

      // attendance for the last school days of VI-A, VI-B and IV-A; VI-A's last day came in through the RFID gate
      const gateKey = 'dev_demo_gate_key_alpha';
      const gateHash = createHash('sha256').update(gateKey).digest('hex');
      const device = await c.query<{ id: string }>(
        `INSERT INTO rfid_devices (school_id, code, name, api_key_hash, created_by) VALUES ($1, 'GATE1', 'Main gate reader', $2, $3)
         ON CONFLICT (school_id, code) DO UPDATE SET api_key_hash = EXCLUDED.api_key_hash RETURNING id::text`,
        [alpha.id, gateHash, userIds['dev-admin']],
      );
      const isSchoolDay = async (iso: string): Promise<boolean> => {
        const d = new Date(`${iso}T00:00:00Z`);
        if (d.getUTCDay() === 0) return false;
        const h = await c.query(
          `SELECT 1 FROM holidays WHERE school_id = $1 AND $2::date BETWEEN starts_on AND ends_on`,
          [alpha.id, iso],
        );
        return h.rowCount === 0;
      };
      const days: string[] = [];
      for (let back = 1; back <= 12 && days.length < 6; back++) {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - back);
        const iso = d.toISOString().slice(0, 10);
        if (await isSchoolDay(iso)) days.push(iso);
      }
      days.reverse();
      const markers: Record<string, string> = {
        'VI-A': 'dev-teacher',
        'VI-B': 'dev-coordinator',
        'IV-A': 'dev-coordinator',
      };
      for (const [key, sub] of Object.entries(markers)) {
        const sectionId = sections.ALPHA![key];
        if (!sectionId) continue;
        const roster = await c.query<{ id: string; roll_no: number }>(
          `SELECT s.id::text, e.roll_no FROM enrolments e JOIN students s ON s.id = e.student_id
            WHERE e.class_section_id = $1 AND e.academic_year_id = $2 AND e.status = 'active' ORDER BY e.roll_no`,
          [sectionId, alpha.yearId],
        );
        if (key === 'VI-A')
          for (const st of roster.rows)
            await c.query(`UPDATE students SET rfid_tag = $2 WHERE id = $1 AND rfid_tag IS NULL`, [
              st.id,
              `ALPHA-VIA-${String(st.roll_no).padStart(3, '0')}`,
            ]);
        for (const [di, day] of days.entries()) {
          const exists = await c.query(
            `SELECT 1 FROM attendance_sessions WHERE class_section_id = $1 AND on_date = $2::date AND kind = 'day'`,
            [sectionId, day],
          );
          if (exists.rowCount) continue;
          const rfidDay = key === 'VI-A' && di === days.length - 1;
          const session = await c.query<{ id: string }>(
            `INSERT INTO attendance_sessions (school_id, academic_year_id, class_section_id, on_date, kind, source, marked_by, marked_at, locked)
             VALUES ($1, $2, $3, $4::date, 'day', $5::attendance_source, $6, ($4::date + time '09:05') AT TIME ZONE 'Asia/Kolkata', $7) RETURNING id::text`,
            [
              alpha.id,
              alpha.yearId,
              sectionId,
              day,
              rfidDay ? 'rfid' : 'manual',
              userIds[sub],
              di < days.length - 2,
            ],
          );
          for (const [si, st] of roster.rows.entries()) {
            const absent = (si + di) % 9 === 0;
            const late = !absent && (si * 3 + di) % 11 === 0;
            const code = absent ? 'A' : late ? 'L' : 'P';
            if (rfidDay && !absent) {
              const inMinutes = late ? 8 * 60 + 25 + si : 7 * 60 + 45 + si;
              const inAt = `(${'$4'}::date + make_interval(mins => ${inMinutes})) AT TIME ZONE 'Asia/Kolkata'`;
              const outAt = `(${'$4'}::date + interval '13 hours 40 minutes' + make_interval(mins => ${si})) AT TIME ZONE 'Asia/Kolkata'`;
              await c.query(
                // eslint-disable-next-line no-restricted-syntax -- demo seed: the interpolated fragment is a computed timestamp expression, not user input
                `INSERT INTO attendance_marks (school_id, session_id, student_id, code, in_at, out_at, source, marked_by)
                 VALUES ($1, $2, $3, $5::attendance_code, ${inAt}, ${outAt}, 'rfid', NULL)`,
                [alpha.id, session.rows[0]!.id, st.id, day, code],
              );
              for (const [dir, expr] of [
                ['in', inAt],
                ['out', outAt],
              ] as Array<[string, string]>)
                await c.query(
                  // eslint-disable-next-line no-restricted-syntax -- demo seed: the interpolated fragment is a computed timestamp expression, not user input
                  `INSERT INTO rfid_events (school_id, device_id, tag, student_id, occurred_at, direction, outcome, raw, received_at)
                   VALUES ($1, $2, $3, $5, ${expr}, $6::rfid_direction, $7, '{"seeded":true}'::jsonb, ${expr})`,
                  [
                    alpha.id,
                    device.rows[0]!.id,
                    `ALPHA-VIA-${String(st.roll_no).padStart(3, '0')}`,
                    day,
                    st.id,
                    dir,
                    dir === 'in' ? (late ? 'marked_late' : 'marked_present') : 'out_recorded',
                  ],
                );
            } else
              await c.query(
                `INSERT INTO attendance_marks (school_id, session_id, student_id, code, remarks, source, alert_sent_at, marked_by)
                 VALUES ($1, $2, $3, $4::attendance_code, $5, 'manual', CASE WHEN $4 = 'A' THEN now() - interval '1 hour' END, $6)`,
                [
                  alpha.id,
                  session.rows[0]!.id,
                  st.id,
                  code,
                  absent ? 'No leave note' : null,
                  userIds[sub],
                ],
              );
          }
          if (rfidDay)
            await c.query(
              `INSERT INTO rfid_events (school_id, device_id, tag, student_id, occurred_at, direction, outcome, raw, received_at)
               VALUES ($1, $2, 'UNKNOWN-0001', NULL, ($3::date + interval '8 hours 2 minutes') AT TIME ZONE 'Asia/Kolkata', 'in', 'unknown_tag', '{"seeded":true}'::jsonb, ($3::date + interval '8 hours 2 minutes') AT TIME ZONE 'Asia/Kolkata')`,
              [alpha.id, device.rows[0]!.id, day],
            );
        }
      }
      await c.query(
        `UPDATE rfid_devices SET last_seen_at = now() - interval '1 day' WHERE id = $1`,
        [device.rows[0]!.id],
      );
      await clearCtx();
    }

    // ---- Sprint 10: communication (templates, groups, consent, requests), transport routes, queries, feedback, devices ----
    for (const school of Object.values(schools)) {
      await c.query(
        `INSERT INTO workflow_definitions (school_id, code, name, entity_type, levels, created_by)
         SELECT $1, 'message_approval', 'Message approval', 'message_request', $2::jsonb, $3
          WHERE NOT EXISTS (SELECT 1 FROM workflow_definitions WHERE school_id = $1 AND code = 'message_approval' AND deleted_at IS NULL)`,
        [
          school.id,
          JSON.stringify([
            {
              level: 1,
              name: 'Principal approval',
              resolver: { kind: 'role', roleCode: 'school_admin' },
              slaHours: 24,
            },
          ]),
          userIds['dev-admin'],
        ],
      );
      const purposes: Array<[string, string, string, string | null]> = [
        [
          'comms.sms',
          'SMS updates',
          'General circulars and event information by SMS. Fee, attendance and safety messages are sent regardless.',
          'sms',
        ],
        [
          'comms.whatsapp',
          'WhatsApp updates',
          'General circulars, homework reminders and event information on WhatsApp.',
          'whatsapp',
        ],
        [
          'comms.email',
          'Email newsletters',
          'Newsletters, circulars and event information by email.',
          'email',
        ],
        [
          'media.gallery',
          'Photographs in the school gallery',
          'Photographs of my child from school events may appear in the school gallery and app.',
          null,
        ],
        [
          'transport.tracking',
          'Bus boarding alerts and location sharing',
          'Boarding and alighting alerts and the live location of the school bus my child travels in.',
          null,
        ],
      ];
      for (const [i, [code, name, description, channel]] of purposes.entries())
        await c.query(
          `INSERT INTO consent_purposes (school_id, code, name, description, channel, sort_order) VALUES ($1, $2, $3, $4, $5::comms_channel, $6) ON CONFLICT (school_id, code) DO NOTHING`,
          [school.id, code, name, description, channel, i],
        );
      const categories: Array<[string, string, string]> = [
        ['academics', 'Academics and homework', 'class_teacher'],
        ['attendance', 'Attendance and leave', 'class_teacher'],
        ['fees', 'Fees and payments', 'accountant'],
        ['transport', 'Transport', 'school_admin'],
        ['admin', 'Office and documents', 'school_admin'],
        ['other', 'Other', 'school_admin'],
      ];
      for (const [i, [code, name, routeTo]] of categories.entries())
        await c.query(
          `INSERT INTO query_categories (school_id, code, name, route_to, sort_order) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (school_id, code) DO NOTHING`,
          [school.id, code, name, routeTo, i],
        );
      const templates: Array<
        [string, string, string, string | null, string, string[], string | null]
      > = [
        [
          'circular_whatsapp',
          'whatsapp',
          'Circular (WhatsApp)',
          null,
          'Dear {{guardian_name}}, {{title}}: {{body}} — {{school}}',
          ['guardian_name', 'title', 'body', 'school'],
          null,
        ],
        [
          'circular_sms',
          'sms',
          'Circular (SMS)',
          null,
          '{{school}}: {{title}}. {{body}}',
          ['title', 'body', 'school'],
          '1107160000000012345',
        ],
        [
          'circular_email',
          'email',
          'Circular (email)',
          '{{title}} — {{school}}',
          'Dear {{guardian_name}},\n\n{{body}}\n\nRegards,\n{{school}}',
          ['guardian_name', 'title', 'body', 'school'],
          null,
        ],
        [
          'bus_boarded',
          'whatsapp',
          'Bus boarded',
          null,
          '{{student_name}} boarded the school bus at {{time}} ({{stop}}). — {{school}}',
          ['student_name', 'time', 'stop', 'school'],
          null,
        ],
        [
          'bus_alighted',
          'whatsapp',
          'Bus alighted',
          null,
          '{{student_name}} got off the school bus at {{time}} ({{stop}}). — {{school}}',
          ['student_name', 'time', 'stop', 'school'],
          null,
        ],
        [
          'query_reply',
          'whatsapp',
          'Query reply',
          null,
          'Update on {{query_no}} ({{student_name}}): {{reply}}',
          ['query_no', 'student_name', 'reply'],
          null,
        ],
      ];
      for (const [code, channel, name, subject, body, variables, dlt] of templates)
        await c.query(
          `INSERT INTO comms_templates (school_id, code, channel, name, subject, body, variables, dlt_template_id, dlt_entity_id, sender_id, created_by)
           SELECT $1, $2, $3::comms_channel, $4, $5, $6, $7::jsonb, $8::text, CASE WHEN $8::text IS NULL THEN NULL ELSE '1201160000000054321' END, CASE WHEN $3::text = 'sms' THEN 'EDUPRO' WHEN $3::text = 'email' THEN 'noreply@edupro.test' END, $9
            WHERE NOT EXISTS (SELECT 1 FROM comms_templates WHERE school_id = $1 AND code = $2 AND channel = $3::comms_channel AND deleted_at IS NULL)`,
          [
            school.id,
            code,
            channel,
            name,
            subject,
            body,
            JSON.stringify(variables),
            dlt,
            userIds['dev-admin'],
          ],
        );
    }
    {
      await withCtx(alpha.id, 'dev-admin');
      const yearId = alpha.yearId;
      const schoolDays: string[] = [];
      for (let back = 1; back <= 12 && schoolDays.length < 5; back++) {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - back);
        const iso = d.toISOString().slice(0, 10);
        if (d.getUTCDay() === 0) continue;
        const h = await c.query(
          `SELECT 1 FROM holidays WHERE school_id = $1 AND $2::date BETWEEN starts_on AND ends_on`,
          [alpha.id, iso],
        );
        if (!h.rowCount) schoolDays.push(iso);
      }
      schoolDays.reverse();
      const lastDay = schoolDays[schoolDays.length - 1]!;

      // consents: the dev parent's choices and one office-recorded consent
      const consentRows = await c.query(`SELECT 1 FROM consents WHERE school_id = $1 LIMIT 1`, [
        alpha.id,
      ]);
      if (!consentRows.rowCount) {
        for (const [purpose, status, source] of [
          ['comms.whatsapp', 'granted', 'parent_app'],
          ['comms.sms', 'granted', 'parent_app'],
          ['comms.email', 'withdrawn', 'parent_app'],
          ['media.gallery', 'granted', 'parent_app'],
          ['transport.tracking', 'granted', 'office'],
        ] as Array<[string, string, string]>)
          await c.query(
            `INSERT INTO consents (school_id, user_id, purpose_code, status, source, note, recorded_by, recorded_at) VALUES ($1, $2, $3, $4::consent_status, $5, $6, $7, now() - interval '12 days')`,
            [
              alpha.id,
              userIds['dev-parent'],
              purpose,
              status,
              source,
              source === 'office' ? 'Signed transport form at the counter' : null,
              source === 'office' ? userIds['dev-clerk'] : userIds['dev-parent'],
            ],
          );
      }

      // groups
      const group = await c.query<{ id: string }>(
        `INSERT INTO comms_groups (school_id, code, name, description, created_by) VALUES ($1, 'pta', 'PTA members', 'Parent-teacher association core group', $2)
         ON CONFLICT (school_id, code) WHERE deleted_at IS NULL DO UPDATE SET name = EXCLUDED.name RETURNING id::text`,
        [alpha.id, userIds['dev-admin']],
      );
      for (const sub of ['dev-parent', 'dev-teacher', 'dev-coordinator'])
        await c.query(
          `INSERT INTO comms_group_members (school_id, group_id, user_id, added_by) VALUES ($1, $2, $3, $4) ON CONFLICT (group_id, user_id) DO NOTHING`,
          [alpha.id, group.rows[0]!.id, userIds[sub], userIds['dev-admin']],
        );

      // transport routes and the students riding them
      const routeIds: Record<string, string> = {};
      for (const [code, name, vehicle, driver, mobile] of [
        ['R1', 'Kothrud – Karve Nagar', 'MH12AB1234', 'Ramesh Pawar', '9876500011'],
        ['R2', 'Baner – Aundh', 'MH12CD5678', 'Sanjay More', '9876500012'],
        ['R3', 'Hadapsar – Magarpatta', 'MH12EF9012', 'Vikas Shinde', '9876500013'],
      ] as Array<[string, string, string, string, string]>) {
        const r = await c.query<{ id: string }>(
          `INSERT INTO transport_routes (school_id, code, name, vehicle_no, driver_name, driver_mobile, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
           ON CONFLICT (school_id, code) WHERE deleted_at IS NULL DO UPDATE SET name = EXCLUDED.name RETURNING id::text`,
          [alpha.id, code, name, vehicle, driver, mobile, userIds['dev-admin']],
        );
        routeIds[code] = r.rows[0]!.id;
      }
      const riders = async (
        section: string,
        route: string,
        count: number,
        stops: string[],
        firstPickup: number,
      ) => {
        const roster = await c.query<{ id: string }>(
          `SELECT s.id::text FROM enrolments e JOIN students s ON s.id = e.student_id WHERE e.class_section_id = $1 AND e.academic_year_id = $2 AND e.status = 'active' ORDER BY e.roll_no LIMIT $3`,
          [sections.ALPHA![section], yearId, count],
        );
        for (const [i, st] of roster.rows.entries())
          await c.query(
            `INSERT INTO student_route_assignments (school_id, student_id, route_id, academic_year_id, stop_name, pickup_time, drop_time, created_by)
             VALUES ($1, $2, $3, $4, $5, make_interval(mins => $6)::time, make_interval(mins => $7)::time, $8) ON CONFLICT (student_id, academic_year_id) DO NOTHING`,
            [
              alpha.id,
              st.id,
              routeIds[route],
              yearId,
              stops[i % stops.length],
              firstPickup + i * 4,
              14 * 60 + 5 + i * 4,
              userIds['dev-admin'],
            ],
          );
      };
      await riders(
        'VI-A',
        'R1',
        4,
        ['Karve Nagar chowk', 'Kothrud depot', 'Paud phata'],
        7 * 60 + 10,
      );
      await riders('IV-A', 'R1', 3, ['Karve Nagar chowk', 'Kothrud depot'], 7 * 60 + 12);
      await riders('VI-B', 'R2', 3, ['Baner phata', 'Aundh gaon'], 7 * 60 + 5);

      // message requests: one sent circular to class VI, one waiting for approval, one rejected
      const requestsExist = await c.query(
        `SELECT 1 FROM message_requests WHERE school_id = $1 LIMIT 1`,
        [alpha.id],
      );
      if (!requestsExist.rowCount) {
        const tpl = await c.query<{ id: string }>(
          `SELECT id::text FROM comms_templates WHERE school_id = $1 AND code = 'circular_whatsapp' AND deleted_at IS NULL`,
          [alpha.id],
        );
        const classVI = await c.query<{ id: string }>(
          `SELECT id::text FROM classes WHERE school_id = $1 AND code = 'VI'`,
          [alpha.id],
        );
        const def = await c.query<{ id: string }>(
          `SELECT id::text FROM workflow_definitions WHERE school_id = $1 AND code = 'message_approval' AND deleted_at IS NULL`,
          [alpha.id],
        );
        const guardians = await c.query<{
          user_id: string | null;
          name: string;
          mobile: string | null;
          student_id: string;
        }>(
          `SELECT DISTINCT ON (s.id) g.user_id::text, g.display_name AS name, g.mobile, s.id::text AS student_id
             FROM enrolments e JOIN students s ON s.id = e.student_id JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
             JOIN student_guardians sg ON sg.student_id = s.id JOIN guardians g ON g.id = sg.guardian_id
            WHERE k.id = $1 AND e.academic_year_id = $2 AND e.status = 'active' ORDER BY s.id, sg.is_primary DESC`,
          [classVI.rows[0]!.id, yearId],
        );
        const sentReq = await c.query<{ id: string }>(
          `INSERT INTO message_requests (school_id, title, category, channel, template_id, body, audience, targets, status, requested_by, requested_at, decided_by, decided_at, decision_note, recipients_total, recipients_skipped, dispatched_at)
           VALUES ($1, 'PTM on Saturday', 'general', 'whatsapp', $2, 'Parent-teacher meeting for Class VI on Saturday 10:00 in the school hall. Please carry the diary.', 'class', $3::jsonb, 'sent', $4, now() - interval '2 days', $5, now() - interval '2 days' + interval '3 hours', 'Approved', $6, 0, now() - interval '2 days' + interval '3 hours') RETURNING id::text`,
          [
            alpha.id,
            tpl.rows[0]!.id,
            JSON.stringify([{ type: 'class', id: classVI.rows[0]!.id }]),
            userIds['dev-coordinator'],
            userIds['dev-principal'],
            guardians.rows.length,
          ],
        );
        const seen = new Set<string>();
        for (const [i, g] of guardians.rows.entries()) {
          if (!g.mobile || seen.has(g.mobile)) {
            await c.query(
              `INSERT INTO message_request_recipients (school_id, request_id, user_id, student_id, name, address, skipped_reason) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                alpha.id,
                sentReq.rows[0]!.id,
                g.user_id,
                g.student_id,
                g.name,
                g.mobile,
                g.mobile ? 'duplicate' : 'no_address',
              ],
            );
            continue;
          }
          seen.add(g.mobile);
          const status = i % 7 === 6 ? 'failed' : i % 5 === 4 ? 'sent' : 'delivered';
          const msg = await c.query<{ id: string }>(
            `INSERT INTO comms_messages (school_id, template_id, channel, recipient_user_id, recipient_address, body, variables, status, provider, provider_message_id, attempts, last_error, scheduled_at, sent_at, delivered_at, failed_at, created_by, created_at)
             VALUES ($1, $2, 'whatsapp', $3, $4, $5, $6::jsonb, $7::comms_message_status, 'whatsapp-http', $8, 1, CASE WHEN $7 = 'failed' THEN 'Number not on WhatsApp' END, now() - interval '2 days' + interval '3 hours', now() - interval '2 days' + interval '3 hours', CASE WHEN $7 = 'delivered' THEN now() - interval '2 days' + interval '3 hours 4 minutes' END, CASE WHEN $7 = 'failed' THEN now() - interval '2 days' + interval '3 hours 1 minute' END, $9, now() - interval '2 days' + interval '3 hours') RETURNING id::text`,
            [
              alpha.id,
              tpl.rows[0]!.id,
              g.user_id,
              g.mobile,
              `Dear ${g.name}, PTM on Saturday: Parent-teacher meeting for Class VI on Saturday 10:00 in the school hall. Please carry the diary. — Alpha Public School`,
              JSON.stringify({ guardian_name: g.name, title: 'PTM on Saturday' }),
              status,
              `WA-DEMO-${i}`,
              userIds['dev-principal'],
            ],
          );
          await c.query(
            `INSERT INTO message_request_recipients (school_id, request_id, user_id, student_id, name, address, message_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              alpha.id,
              sentReq.rows[0]!.id,
              g.user_id,
              g.student_id,
              g.name,
              g.mobile,
              msg.rows[0]!.id,
            ],
          );
        }
        await c.query(
          `UPDATE message_requests SET recipients_total = $2, recipients_skipped = $3 WHERE id = $1`,
          [sentReq.rows[0]!.id, seen.size, guardians.rows.length - seen.size],
        );
        const pending = await c.query<{ id: string }>(
          `INSERT INTO message_requests (school_id, title, category, channel, template_id, body, audience, targets, status, requested_by, requested_at, recipients_total, recipients_skipped)
           VALUES ($1, 'Sports day volunteers', 'general', 'whatsapp', $2, 'We need parent volunteers for the sports day on 12 October. Reply to the class teacher by Friday.', 'group', $3::jsonb, 'pending_approval', $4, now() - interval '5 hours', 3, 0) RETURNING id::text`,
          [
            alpha.id,
            tpl.rows[0]!.id,
            JSON.stringify([{ type: 'group', id: group.rows[0]!.id }]),
            userIds['dev-coordinator'],
          ],
        );
        const inst = await c.query<{ id: string }>(
          `INSERT INTO workflow_instances (school_id, definition_id, entity_type, entity_id, subject, payload, status, current_level, requested_by, requested_at)
           VALUES ($1, $2, 'message_request', $3, 'Sports day volunteers · whatsapp · 3 recipients', '{"audience":"group","channel":"whatsapp"}'::jsonb, 'pending', 1, $4, now() - interval '5 hours') RETURNING id::text`,
          [alpha.id, def.rows[0]!.id, pending.rows[0]!.id, userIds['dev-coordinator']],
        );
        await c.query(
          `INSERT INTO workflow_steps (school_id, instance_id, level, name, resolver, assignee_user_ids, status) VALUES ($1, $2, 1, 'Principal approval', '{"kind":"role","roleCode":"school_admin"}'::jsonb, $3::bigint[], 'pending')`,
          [alpha.id, inst.rows[0]!.id, [userIds['dev-admin'], userIds['dev-principal']]],
        );
        await c.query(`UPDATE message_requests SET workflow_instance_id = $2 WHERE id = $1`, [
          pending.rows[0]!.id,
          inst.rows[0]!.id,
        ]);
        await c.query(
          `INSERT INTO message_requests (school_id, title, category, channel, template_id, body, audience, targets, status, requested_by, requested_at, decided_by, decided_at, decision_note, recipients_total, recipients_skipped)
           VALUES ($1, 'Winter uniform reminder', 'general', 'whatsapp', $2, 'Winter uniform from 1 November.', 'students', '[]'::jsonb, 'rejected', $3, now() - interval '6 days', $4, now() - interval '6 days' + interval '2 hours', 'Too early; send in the last week of October', 150, 11)`,
          [alpha.id, tpl.rows[0]!.id, userIds['dev-teacher'], userIds['dev-principal']],
        );
      }

      // queries, complaints and a leave request
      const queriesExist = await c.query(
        `SELECT 1 FROM parent_queries WHERE school_id = $1 LIMIT 1`,
        [alpha.id],
      );
      if (!queriesExist.rowCount) {
        const kids = await c.query<{ id: string; first_name: string }>(
          `SELECT s.id::text, s.first_name FROM students s JOIN student_guardians sg ON sg.student_id = s.id JOIN guardians g ON g.id = sg.guardian_id WHERE g.user_id = $1 AND s.school_id = $2 ORDER BY s.first_name`,
          [userIds['dev-parent'], alpha.id],
        );
        const aaravId = kids.rows.find((k) => k.first_name === 'Aarav')?.id ?? kids.rows[0]!.id;
        const diyaId = kids.rows.find((k) => k.first_name === 'Diya')?.id ?? kids.rows[0]!.id;
        const q = async (input: {
          kind: string;
          category: string;
          student: string;
          subject: string;
          body: string;
          status: string;
          daysAgo: number;
          leave?: [string, string];
          decision?: string;
          rating?: number;
          assigned?: string | null;
          role: string;
        }) => {
          const no = await c.query<{ n: string }>(`SELECT app.next_query_no($1) AS n`, [yearId]);
          const r = await c.query<{ id: string }>(
            `INSERT INTO parent_queries (school_id, academic_year_id, number, kind, category_code, student_id, raised_by_user_id, subject, body, leave_from, leave_to, status, assigned_role, assigned_user_id, decision, rating, rating_comment, opened_at, first_response_at, closed_at, closed_by)
             VALUES ($1, $2, $3, $4::query_kind, $5, $6, $7, $8, $9, $10::date, $11::date, $12::query_status, $13, $14::bigint, $15, $16::int, $17, now() - make_interval(days => $18::int), CASE WHEN $12::text IN ('answered', 'closed') THEN now() - make_interval(days => $18::int) + interval '5 hours' END, CASE WHEN $12::text = 'closed' THEN now() - make_interval(days => $18::int) + interval '1 day' END, CASE WHEN $12::text = 'closed' THEN $14::bigint END) RETURNING id::text`,
            [
              alpha.id,
              yearId,
              no.rows[0]!.n,
              input.kind,
              input.category,
              input.student,
              userIds['dev-parent'],
              input.subject,
              input.body,
              input.leave?.[0] ?? null,
              input.leave?.[1] ?? null,
              input.status,
              input.role,
              input.assigned ?? null,
              input.decision ?? null,
              input.rating ?? null,
              input.rating ? 'Quick and clear' : null,
              input.daysAgo,
            ],
          );
          return r.rows[0]!.id;
        };
        const q1 = await q({
          kind: 'query',
          category: 'academics',
          student: aaravId,
          subject: 'Maths homework load',
          body: 'Aarav gets three worksheets a day. Is that expected in Class VI?',
          status: 'open',
          daysAgo: 1,
          role: 'class_teacher',
        });
        await c.query(
          `INSERT INTO query_responses (school_id, query_id, author_user_id, author_kind, body, is_internal, created_at) VALUES ($1, $2, $3, 'staff', 'Checking with Suresh sir before replying.', true, now() - interval '20 hours')`,
          [alpha.id, q1, userIds['dev-teacher']],
        );
        const q2 = await q({
          kind: 'query',
          category: 'fees',
          student: aaravId,
          subject: 'Receipt for the July instalment',
          body: 'The receipt for the July payment has not reached us.',
          status: 'answered',
          daysAgo: 4,
          assigned: userIds['dev-accounts'],
          role: 'accountant',
        });
        await c.query(
          `INSERT INTO query_responses (school_id, query_id, author_user_id, author_kind, body, created_at) VALUES ($1, $2, $3, 'staff', 'The receipt is available under Fees in the parent app; a copy has been emailed today.', now() - interval '3 days 19 hours')`,
          [alpha.id, q2, userIds['dev-accounts']],
        );
        const q3 = await q({
          kind: 'leave',
          category: 'attendance',
          student: diyaId,
          subject: 'Leave for a family function',
          body: 'Diya will be away for two days.',
          status: 'closed',
          daysAgo: 9,
          leave: [schoolDays[0]!, schoolDays[1] ?? schoolDays[0]!],
          decision: 'approved',
          rating: 5,
          assigned: userIds['dev-coordinator'],
          role: 'class_teacher',
        });
        await c.query(
          `INSERT INTO query_responses (school_id, query_id, author_user_id, author_kind, body, created_at) VALUES ($1, $2, $3, 'staff', 'Approved. Please collect the worksheets from the class teacher.', now() - interval '8 days')`,
          [alpha.id, q3, userIds['dev-coordinator']],
        );
        const otherParent = await c.query<{ id: string; student_id: string }>(
          `SELECT g.user_id::text AS id, sg.student_id::text FROM guardians g JOIN student_guardians sg ON sg.guardian_id = g.id WHERE g.school_id = $1 AND g.user_id IS NOT NULL AND g.user_id <> $2 LIMIT 1`,
          [alpha.id, userIds['dev-parent']],
        );
        void otherParent;
        await q({
          kind: 'complaint',
          category: 'transport',
          student: aaravId,
          subject: 'Bus R1 late three days in a row',
          body: 'The bus reached the stop after 7:40 on Monday, Tuesday and Wednesday.',
          status: 'in_progress',
          daysAgo: 2,
          assigned: userIds['dev-admin'],
          role: 'school_admin',
        });
      }

      // feedback
      const feedbackExists = await c.query(
        `SELECT 1 FROM feedback_entries WHERE school_id = $1 LIMIT 1`,
        [alpha.id],
      );
      if (!feedbackExists.rowCount)
        for (const [category, rating, comment, sub] of [
          ['teaching', 5, 'Very approachable class teacher', 'dev-parent'],
          ['transport', 3, 'Bus is often late in the monsoon', 'dev-parent'],
          ['communication', 4, 'WhatsApp updates are helpful', 'dev-parent'],
          ['app', 4, 'Attendance view is useful', 'dev-student'],
          ['facilities', 2, 'Drinking water coolers need service', 'dev-parent'],
          ['fees', 4, null, 'dev-parent'],
        ] as Array<[string, number, string | null, string]>)
          await c.query(
            `INSERT INTO feedback_entries (school_id, user_id, category, rating, comment, created_at) VALUES ($1, $2, $3, $4, $5, now() - (random() * interval '20 days'))`,
            [alpha.id, userIds[sub], category, rating, comment],
          );

      // a pending profile change request from the dev parent
      const changeExists = await c.query(
        `SELECT 1 FROM profile_change_requests WHERE school_id = $1 LIMIT 1`,
        [alpha.id],
      );
      if (!changeExists.rowCount) {
        const g = await c.query<{ id: string; mobile: string | null; student_id: string }>(
          `SELECT g.id::text, g.mobile, sg.student_id::text FROM guardians g JOIN student_guardians sg ON sg.guardian_id = g.id WHERE g.user_id = $1 AND g.school_id = $2 LIMIT 1`,
          [userIds['dev-parent'], alpha.id],
        );
        if (g.rows[0])
          await c.query(
            `INSERT INTO profile_change_requests (school_id, student_id, requested_by_user_id, entity, entity_id, changes, reason, created_at) VALUES ($1, $2, $3, 'guardian', $4, $5::jsonb, 'New mobile number after porting', now() - interval '1 day')`,
            [
              alpha.id,
              g.rows[0].student_id,
              userIds['dev-parent'],
              g.rows[0].id,
              JSON.stringify({
                mobile: { from: g.rows[0].mobile, to: '9876543299' },
                'address.city': { from: 'Pune', to: 'Pune (Kothrud)' },
              }),
            ],
          );
      }

      // devices: bus reader on R1 and a biometric punch device; a week of punches; the last school day's bus taps
      const busHash = createHash('sha256').update('dev_demo_bus_key_alpha').digest('hex');
      const bioHash = createHash('sha256').update('dev_demo_bio_key_alpha').digest('hex');
      const bus = await c.query<{ id: string }>(
        `INSERT INTO rfid_devices (school_id, code, name, api_key_hash, kind, route_id, created_by) VALUES ($1, 'BUS1', 'Bus R1 reader', $2, 'bus', $3, $4)
         ON CONFLICT (school_id, code) DO UPDATE SET api_key_hash = EXCLUDED.api_key_hash, kind = 'bus', route_id = EXCLUDED.route_id RETURNING id::text`,
        [alpha.id, busHash, routeIds.R1, userIds['dev-admin']],
      );
      const bio = await c.query<{ id: string }>(
        `INSERT INTO rfid_devices (school_id, code, name, api_key_hash, kind, created_by) VALUES ($1, 'BIO1', 'Staff room biometric', $2, 'biometric', $3)
         ON CONFLICT (school_id, code) DO UPDATE SET api_key_hash = EXCLUDED.api_key_hash, kind = 'biometric' RETURNING id::text`,
        [alpha.id, bioHash, userIds['dev-admin']],
      );
      await c.query(
        `UPDATE employees SET biometric_id = 'BIO-' || employee_code WHERE school_id = $1 AND biometric_id IS NULL AND deleted_at IS NULL`,
        [alpha.id],
      );
      const busExists = await c.query(`SELECT 1 FROM bus_attendance WHERE school_id = $1 LIMIT 1`, [
        alpha.id,
      ]);
      if (!busExists.rowCount) {
        const ridersR1 = await c.query<{
          id: string;
          tag: string | null;
          stop: string | null;
          pickup: string | null;
        }>(
          `SELECT s.id::text, s.rfid_tag AS tag, a.stop_name AS stop, a.pickup_time::text AS pickup FROM student_route_assignments a JOIN students s ON s.id = a.student_id WHERE a.route_id = $1 AND a.academic_year_id = $2 AND s.rfid_tag IS NOT NULL ORDER BY a.pickup_time`,
          [routeIds.R1, yearId],
        );
        for (const [i, r] of ridersR1.rows.entries()) {
          const pickup = (r.pickup ?? '07:10:00').slice(0, 5);
          const inAt = new Date(`${lastDay}T${pickup}:00+05:30`);
          inAt.setMinutes(inAt.getMinutes() + 2);
          const outAt = new Date(`${lastDay}T13:55:00+05:30`);
          outAt.setMinutes(outAt.getMinutes() + i * 3);
          for (const [dir, at, outcome] of [
            ['in', inAt, 'boarded'],
            ['out', outAt, 'alighted'],
          ] as Array<[string, Date, string]>)
            await c.query(
              `INSERT INTO bus_attendance (school_id, device_id, route_id, student_id, tag, on_date, direction, occurred_at, lat, lng, outcome, alert_sent_at, raw, received_at)
               VALUES ($1, $2, $3, $4, $5, $6::date, $7::rfid_direction, $8::timestamptz, 18.5074, 73.8077, $9, $8::timestamptz, '{"seeded":true}'::jsonb, $8::timestamptz)`,
              [
                alpha.id,
                bus.rows[0]!.id,
                routeIds.R1,
                r.id,
                r.tag,
                lastDay,
                dir,
                at.toISOString(),
                outcome,
              ],
            );
        }
        await c.query(
          `INSERT INTO bus_attendance (school_id, device_id, route_id, tag, on_date, direction, occurred_at, outcome, raw, received_at) VALUES ($1, $2, $3, 'UNKNOWN-BUS-01', $4::date, 'in', ($4::date + interval '7 hours 31 minutes') AT TIME ZONE 'Asia/Kolkata', 'unknown_tag', '{"seeded":true}'::jsonb, ($4::date + interval '7 hours 31 minutes') AT TIME ZONE 'Asia/Kolkata')`,
          [alpha.id, bus.rows[0]!.id, routeIds.R1, lastDay],
        );
      }
      const punchExists = await c.query(`SELECT 1 FROM punch_logs WHERE school_id = $1 LIMIT 1`, [
        alpha.id,
      ]);
      if (!punchExists.rowCount) {
        const staff = await c.query<{ id: string; bio: string }>(
          `SELECT id::text, biometric_id AS bio FROM employees WHERE school_id = $1 AND deleted_at IS NULL AND status = 'active' ORDER BY employee_code`,
          [alpha.id],
        );
        for (const [di, day] of schoolDays.entries())
          for (const [ei, e] of staff.rows.entries()) {
            if ((ei + di) % 11 === 10) continue; // one absentee per day
            const inMin = 8 * 60 + 20 + ((ei * 7 + di * 3) % 35);
            const outMin = 16 * 60 + ((ei * 5 + di) % 50);
            for (const [mins, dir] of [
              [inMin, 'in'],
              [outMin, 'out'],
            ] as Array<[number, string]>)
              await c.query(
                `INSERT INTO punch_logs (school_id, device_id, employee_id, biometric_id, punched_at, direction, outcome, raw, received_at)
                 VALUES ($1, $2, $3, $4, ($5::date + make_interval(mins => $6)) AT TIME ZONE 'Asia/Kolkata', $7::rfid_direction, 'recorded', '{"seeded":true}'::jsonb, ($5::date + make_interval(mins => $6)) AT TIME ZONE 'Asia/Kolkata') ON CONFLICT DO NOTHING`,
                [alpha.id, bio.rows[0]!.id, e.id, e.bio, day, mins, dir],
              );
          }
      }
      await c.query(
        `UPDATE rfid_devices SET last_seen_at = now() - interval '1 day' WHERE id IN ($1, $2) AND last_seen_at IS NULL`,
        [bus.rows[0]!.id, bio.rows[0]!.id],
      );
      await clearCtx();
    }

    await c.query('COMMIT');
    const counts = await c.query<{
      students: string;
      guardians: string;
      employees: string;
      messages: string;
      subjects: string;
      assignments: string;
      slots: string;
    }>(
      `SELECT (SELECT count(*) FROM students WHERE school_id = ANY($1))::text AS students, (SELECT count(*) FROM guardians WHERE school_id = ANY($1))::text AS guardians,
              (SELECT count(*) FROM employees WHERE school_id = ANY($1))::text AS employees, (SELECT count(*) FROM comms_messages WHERE school_id = ANY($1))::text AS messages,
              (SELECT count(*) FROM subjects WHERE school_id = ANY($1))::text AS subjects, (SELECT count(*) FROM teacher_assignments WHERE school_id = ANY($1))::text AS assignments,
              (SELECT count(*) FROM timetable_slots WHERE school_id = ANY($1))::text AS slots`,
      [Object.values(schools).map((s) => s.id)],
    );
    process.stdout.write(
      `demo data ready: ${counts.rows[0]!.students} students, ${counts.rows[0]!.guardians} guardians, ${counts.rows[0]!.employees} employees, ${counts.rows[0]!.messages} messages, ${counts.rows[0]!.subjects} subjects, ${counts.rows[0]!.assignments} teacher assignments, ${counts.rows[0]!.slots} timetable slots\n\n`,
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
