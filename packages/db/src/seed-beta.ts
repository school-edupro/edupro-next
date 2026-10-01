/**
 * Beta Public School to the same demo standard as Alpha (2026-10-01): one developer login per role
 * (principal, coordinator, class teacher, subject teacher, auditor, front office, accountant, parent
 * of two siblings, student, a member with no roles), linked to Beta's own staff, students and
 * guardians; then the day-to-day data every role expects on screen: attendance, homework, notices,
 * fee demands and receipts, a bus route, library loans, an exam with marks, a parent's query,
 * feedback and a profile change waiting for approval.
 *
 * Part A runs as the migrator (SQL). Part B goes through the running API with the development sign-in
 * (`Bearer dev:<subject>`) so every business rule applies (ledgers, receipt numbers, routing).
 * Idempotent: users and links are refreshed; each data step is skipped when Beta already has it.
 *
 * Usage (API on :4000 with AUTH_DEV_BYPASS=1): DATABASE_MIGRATOR_URL=... tsx src/seed-beta.ts
 * Run after seed-demo, which creates the Beta school, classes, students, staff and fee masters.
 */
import { Client } from 'pg';

interface BetaUser {
  sub: string;
  name: string;
  mobile: string;
  email: string;
  personType: 'employee' | 'guardian' | 'student' | 'external';
  roles: string[];
  employee?: string;
}

const USERS: BetaUser[] = [
  {
    sub: 'dev-beta-principal',
    name: '',
    mobile: '9999998801',
    email: 'principal@beta.example.test',
    personType: 'employee',
    roles: ['school_admin'],
    employee: 'E001',
  },
  {
    sub: 'dev-beta-coordinator',
    name: '',
    mobile: '9999998802',
    email: 'coordinator@beta.example.test',
    personType: 'employee',
    roles: ['academic_coordinator'],
    employee: 'E003',
  },
  {
    sub: 'dev-beta-teacher',
    name: '',
    mobile: '9999998803',
    email: 'classteacher@beta.example.test',
    personType: 'employee',
    roles: ['class_teacher'],
    employee: 'E006',
  },
  {
    sub: 'dev-beta-subject',
    name: '',
    mobile: '9999998804',
    email: 'subject@beta.example.test',
    personType: 'employee',
    roles: ['subject_teacher'],
    employee: 'E004',
  },
  {
    sub: 'dev-beta-auditor',
    name: 'Pallavi Auditor',
    mobile: '9999998805',
    email: 'auditor@beta.example.test',
    personType: 'employee',
    roles: ['auditor'],
  },
  {
    sub: 'dev-beta-clerk',
    name: 'Sunita Front Office',
    mobile: '9999998806',
    email: 'frontoffice@beta.example.test',
    personType: 'employee',
    roles: ['front_office'],
    employee: 'E016',
  },
  {
    sub: 'dev-beta-accounts',
    name: 'Manoj Accounts',
    mobile: '9999998807',
    email: 'accounts@beta.example.test',
    personType: 'employee',
    roles: ['accountant'],
    employee: 'E015',
  },
  {
    sub: 'dev-beta-parent',
    name: '',
    mobile: '',
    email: '',
    personType: 'guardian',
    roles: ['parent'],
  },
  {
    sub: 'dev-beta-student',
    name: '',
    mobile: '',
    email: '',
    personType: 'student',
    roles: ['student'],
  },
  {
    sub: 'dev-beta-nobody',
    name: 'Beta Nobody',
    mobile: '9999998810',
    email: 'nobody@beta.example.test',
    personType: 'external',
    roles: [],
  },
];

const API = process.env.API_BASE_URL ?? 'http://localhost:4000';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production')
    throw new Error('seed-beta refuses to run in production');
  const url = process.env.DATABASE_MIGRATOR_URL;
  if (!url) throw new Error('DATABASE_MIGRATOR_URL is required');
  const c = new Client({ connectionString: url, application_name: 'edupro-seed-beta' });
  await c.connect();
  try {
    const school = await c.query<{ id: string; year_id: string }>(
      `SELECT s.id::text, ay.id::text AS year_id FROM schools s JOIN academic_years ay ON ay.school_id = s.id AND ay.status = 'active'
        WHERE s.code = 'BETA'`,
    );
    if (!school.rows[0]) throw new Error('Beta Public School not found: run seed-demo first');
    const schoolId = school.rows[0].id;
    const yearId = school.rows[0].year_id;

    // ---- Part A: logins, staff links, scopes, family links ---------------------------------------
    await c.query('BEGIN');
    const campus = await c.query<{ id: string }>(
      `SELECT id::text FROM campuses WHERE school_id = $1 ORDER BY id LIMIT 1`,
      [schoolId],
    );
    // the front office school role, with the same permissions as Alpha's
    const fo = await c.query<{ id: string }>(
      `INSERT INTO roles (school_id, code, name, kind, is_system, description)
       VALUES ($1, 'front_office', 'Front Office', 'module', false, 'Admissions desk: people, enrolments, search, exports, notifications')
       ON CONFLICT (school_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id::text`,
      [schoolId],
    );
    await c.query(
      `INSERT INTO role_permissions (role_id, permission_code)
       SELECT $1, rp.permission_code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
        WHERE r.code = 'front_office' AND r.school_id = (SELECT id FROM schools WHERE code = 'ALPHA')
       ON CONFLICT DO NOTHING`,
      [fo.rows[0]!.id],
    );
    // staff Beta lacks for the accountant and the front office
    for (const [code, first, last, designation, department, gender] of [
      ['E015', 'Manoj', 'Kale', 'Accountant', 'Accounts', 'male'],
      ['E016', 'Sunita', 'Wagh', 'Front Office Executive', 'Administration', 'female'],
    ] as const) {
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, dob, gender, employee_type, designation, department, joined_on, mobile, email, legacy_ref)
         VALUES ($1, $2, $3, $4, '1988-05-14', $5::gender, 'non_teaching', $6, $7, '2019-06-01', $8, $9, $2)
         ON CONFLICT (school_id, employee_code) DO NOTHING`,
        [
          schoolId,
          code,
          first,
          last,
          gender,
          designation,
          department,
          code === 'E015' ? '8300100015' : '8300100016',
          `${code.toLowerCase()}@beta.example.test`,
        ],
      );
      await c.query(
        `INSERT INTO postings (school_id, employee_id, academic_year_id, campus_id, department, designation, reports_to_employee_id, valid_from)
         SELECT $1, e.id, $2, $3, $4, $5, (SELECT id FROM employees WHERE school_id = $1 AND employee_code = 'E001'), '2026-04-01'
           FROM employees e WHERE e.school_id = $1 AND e.employee_code = $6
         ON CONFLICT (employee_id, academic_year_id) DO NOTHING`,
        [schoolId, yearId, campus.rows[0]!.id, department, designation, code],
      );
    }

    // the family: a guardian with two children, one of them in III-A (the class teacher's section)
    const family = await c.query<{ guardian_id: string; guardian: string; kids: string[] }>(
      `SELECT g.id::text AS guardian_id, g.display_name AS guardian,
              array_agg(st.id::text ORDER BY (k.code || '-' || cs.name) = 'III-A' DESC, st.id) AS kids
         FROM guardians g JOIN student_guardians sg ON sg.guardian_id = g.id JOIN students st ON st.id = sg.student_id
         JOIN enrolments e ON e.student_id = st.id AND e.academic_year_id = $2 AND e.status = 'active'
         JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
        WHERE g.school_id = $1 AND g.deleted_at IS NULL
        GROUP BY g.id HAVING count(*) > 1
        ORDER BY bool_or((k.code || '-' || cs.name) = 'III-A') DESC, g.id LIMIT 1`,
      [schoolId, yearId],
    );
    const fam = family.rows[0];
    if (!fam) throw new Error('Beta has no guardian with two children');
    const student = await c.query<{ name: string }>(
      `SELECT display_name AS name FROM students WHERE id = $1`,
      [fam.kids[0]],
    );

    const userIds: Record<string, string> = {};
    for (const u of USERS) {
      let name = u.name;
      if (u.employee) {
        const e = await c.query<{ name: string }>(
          `SELECT display_name AS name FROM employees WHERE school_id = $1 AND employee_code = $2`,
          [schoolId, u.employee],
        );
        name = e.rows[0]?.name ?? u.name;
      }
      if (u.sub === 'dev-beta-parent') name = fam.guardian;
      if (u.sub === 'dev-beta-student') name = student.rows[0]!.name;
      const r = await c.query<{ id: string }>(
        `INSERT INTO users (oneauth_sub, email, mobile, display_name) VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), $4)
         ON CONFLICT (oneauth_sub) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email, mobile = EXCLUDED.mobile RETURNING id::text`,
        [u.sub, u.email, u.mobile, name],
      );
      const id = r.rows[0]!.id;
      userIds[u.sub] = id;
      await c.query(
        `INSERT INTO user_school_memberships (school_id, user_id, person_type) VALUES ($1, $2, $3::person_type)
         ON CONFLICT (school_id, user_id, person_type) DO UPDATE SET status = 'active', deleted_at = NULL`,
        [schoolId, id, u.personType],
      );
      for (const code of u.roles) {
        const role = await c.query<{ id: string }>(
          `SELECT id::text FROM roles WHERE code = $1 AND (school_id IS NULL OR school_id = $2) ORDER BY school_id NULLS LAST LIMIT 1`,
          [code, schoolId],
        );
        if (!role.rows[0]) throw new Error(`role ${code} not found`);
        await c.query(
          `INSERT INTO user_roles (school_id, user_id, role_id, reason) SELECT $1, $2, $3, 'demo seed (Beta)'
           WHERE NOT EXISTS (SELECT 1 FROM user_roles WHERE school_id = $1 AND user_id = $2 AND role_id = $3 AND revoked_at IS NULL)`,
          [schoolId, id, role.rows[0].id],
        );
      }
      if (u.employee)
        await c.query(
          `UPDATE employees SET user_id = $3 WHERE school_id = $1 AND employee_code = $2 AND (user_id IS NULL OR user_id = $3)`,
          [schoolId, u.employee, id],
        );
    }
    await c.query(`UPDATE guardians SET user_id = $2 WHERE id = $1`, [
      fam.guardian_id,
      userIds['dev-beta-parent'],
    ]);
    // as in Alpha: the student has accepted the privacy notice, the parent has not (onboarding shows)
    await c.query(
      `INSERT INTO privacy_acknowledgements (school_id, user_id, notice_version, acknowledged_at, source)
       SELECT $1, $2, max(version), now() - interval '15 days', 'parent_app' FROM privacy_notices WHERE school_id = $1 HAVING max(version) IS NOT NULL
       ON CONFLICT (user_id, notice_version) DO NOTHING`,
      [schoolId, userIds['dev-beta-student']],
    );
    await c.query(`UPDATE students SET user_id = $2 WHERE id = $1`, [
      fam.kids[0],
      userIds['dev-beta-student'],
    ]);

    // scopes: the class teacher sees III-A, the subject teacher I-A and II-A
    const sections = await c.query<{ key: string; id: string; class_id: string }>(
      `SELECT k.code || '-' || cs.name AS key, cs.id::text, k.id::text AS class_id FROM class_sections cs JOIN classes k ON k.id = cs.class_id
        WHERE cs.school_id = $1 AND cs.academic_year_id = $2 ORDER BY k.display_order, cs.name`,
      [schoolId, yearId],
    );
    const sectionId = Object.fromEntries(sections.rows.map((s) => [s.key, s.id]));
    for (const [sub, role, keys] of [
      ['dev-beta-teacher', 'class_teacher', ['III-A']],
      ['dev-beta-subject', 'subject_teacher', ['I-A', 'II-A']],
    ] as const) {
      const ur = await c.query<{ id: string }>(
        `SELECT ur.id::text FROM user_roles ur JOIN roles r ON r.id = ur.role_id
          WHERE ur.school_id = $1 AND ur.user_id = $2 AND r.code = $3 AND ur.revoked_at IS NULL LIMIT 1`,
        [schoolId, userIds[sub], role],
      );
      for (const k of keys)
        if (ur.rows[0] && sectionId[k])
          await c.query(
            `INSERT INTO user_role_scopes (school_id, user_role_id, scope_type, scope_id) VALUES ($1, $2, 'class_section', $3) ON CONFLICT DO NOTHING`,
            [schoolId, ur.rows[0].id, sectionId[k]],
          );
    }
    // the subject teacher teaches Mathematics in I-A and II-A
    const mat = await c.query<{ id: string }>(
      `SELECT id::text FROM subjects WHERE school_id = $1 AND code = 'MAT' AND deleted_at IS NULL`,
      [schoolId],
    );
    if (mat.rows[0])
      for (const k of ['I-A', 'II-A'])
        if (sectionId[k])
          await c.query(
            `INSERT INTO teacher_assignments (school_id, academic_year_id, employee_id, class_section_id, subject_id, kind)
             SELECT $1, $2, e.id, $3, $4, 'subject_teacher' FROM employees e WHERE e.school_id = $1 AND e.employee_code = 'E004'
                AND NOT EXISTS (SELECT 1 FROM teacher_assignments t WHERE t.class_section_id = $3 AND t.subject_id = $4 AND t.employee_id = e.id AND t.valid_to IS NULL)`,
            [schoolId, yearId, sectionId[k], mat.rows[0].id],
          );
    await c.query('COMMIT');
    console.log(`Part A: ${String(USERS.length)} Beta logins linked (family: ${fam.guardian})`);

    // ---- Part B: day-to-day data through the API ---------------------------------------------------
    const api = async <T>(
      sub: string,
      method: string,
      path: string,
      body?: unknown,
    ): Promise<T> => {
      const res = await fetch(`${API}/api/v1${path}`, {
        method,
        headers: {
          authorization: `Bearer dev:${sub}`,
          'x-school-id': schoolId,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok)
        throw new Error(
          `${method} ${path} → ${String(res.status)} ${String(json.detail ?? json.type ?? '')}`,
        );
      return json as T;
    };
    const count = async (sql: string) =>
      Number(Object.values((await c.query(sql, [schoolId])).rows[0] ?? {})[0] ?? 0);
    const step = async (label: string, skip: boolean, fn: () => Promise<string>) => {
      if (skip) return console.log(`  · ${label}: already there`);
      try {
        console.log(`  ✓ ${label}: ${await fn()}`);
      } catch (error) {
        console.warn(`  ✗ ${label}: ${(error as Error).message}`);
      }
    };
    const health = await fetch(`${API}/api/v1/health`).catch(() => null);
    if (!health) {
      console.warn(`Part B skipped: the API is not reachable on ${API}`);
      return;
    }
    const roster = async (key: string) =>
      (
        await c.query<{ id: string }>(
          `SELECT e.student_id::text AS id FROM enrolments e WHERE e.class_section_id = $1 AND e.status = 'active' ORDER BY e.roll_no NULLS LAST, e.id`,
          [sectionId[key]],
        )
      ).rows.map((x) => x.id);
    const P = 'dev-beta-principal';

    // school days of the last two weeks, oldest first (no Sundays)
    const days: string[] = [];
    for (let i = 14; i >= 1; i -= 1) {
      const d = new Date(Date.now() + 330 * 60_000 - i * 864e5);
      if (d.getUTCDay() !== 0) days.push(d.toISOString().slice(0, 10));
    }

    await step(
      'attendance',
      (await count(`SELECT count(*) FROM attendance_sessions WHERE school_id = $1`)) > 0,
      async () => {
        let n = 0;
        for (const s of sections.rows) {
          const ids = await roster(s.key);
          for (const [di, date] of days.entries()) {
            await api(s.key === 'III-A' ? 'dev-beta-teacher' : P, 'POST', '/attendance/sessions', {
              classSectionId: s.id,
              date,
              marks: ids.map((id, i) => ({ studentId: id, code: (i + di) % 9 === 4 ? 'A' : 'P' })),
            });
            n += 1;
          }
        }
        return `${String(n)} registers`;
      },
    );

    await step(
      'homework',
      (await count(`SELECT count(*) FROM daily_work WHERE school_id = $1`)) > 0,
      async () => {
        const items: Array<[string, string, string]> = [
          ['III-A', 'English: read chapter 4 and write five new words', 'homework'],
          ['III-A', 'Maths: tables of 7 and 8', 'homework'],
          ['III-A', 'Craft: make a paper boat from an old newspaper', 'classwork'],
          ['I-A', 'Colour the fruits worksheet', 'homework'],
          ['II-A', 'Write ten lines on My School', 'homework'],
        ];
        for (const [key, title, kind] of items)
          await api(key === 'III-A' ? 'dev-beta-teacher' : P, 'POST', '/academics/daily-work', {
            classSectionId: sectionId[key],
            kind,
            title,
            body: title,
          });
        return `${String(items.length)} items`;
      },
    );

    await step(
      'notices',
      (await count(`SELECT count(*) FROM notices WHERE school_id = $1`)) > 1,
      async () => {
        await api(P, 'POST', '/academics/notices', {
          title: 'Parent-teacher meeting on Saturday',
          body: 'Meet the class teachers between 9:00 and 12:00 to discuss the first term.',
          publish: true,
          isPinned: true,
        });
        await api(P, 'POST', '/academics/notices', {
          title: 'Dussehra holidays',
          body: 'The school stays closed from 19 to 21 October; classes resume on 22 October.',
          publish: true,
        });
        return '2 notices';
      },
    );

    await step(
      'fee demands',
      (await count(`SELECT count(*) FROM fee_demands WHERE school_id = $1`)) > 0,
      async () => {
        let n = 0;
        for (const classId of [...new Set(sections.rows.map((s) => s.class_id))]) {
          const r = await api<{ generated: number }>(
            'dev-beta-accounts',
            'POST',
            '/fees/demands/generate',
            {
              classId,
            },
          );
          n += r.generated;
        }
        return `${String(n)} students`;
      },
    );

    await step(
      'fee receipts',
      (await count(`SELECT count(*) FROM fee_payments WHERE school_id = $1`)) > 0,
      async () => {
        let n = 0;
        for (const [i, s] of sections.rows.entries()) {
          const ids = await roster(s.key);
          for (const [j, id] of ids.slice(0, 4).entries()) {
            if (id === fam.kids[1]) continue; // the second child keeps a due, for the parent's fee screen
            await api('dev-beta-accounts', 'POST', '/payments/offline', {
              studentId: id,
              amount: 4500 + ((i + j) % 3) * 500,
              mode: j % 2 ? 'upi' : 'cash',
              receivedOn: `2026-0${String(4 + ((i + j) % 5))}-1${String(j)}`,
            });
            n += 1;
          }
        }
        return `${String(n)} receipts`;
      },
    );

    await step(
      'bus route',
      (await count(`SELECT count(*) FROM transport_routes WHERE school_id = $1`)) > 0,
      async () => {
        const route = await api<{ id: string }>(P, 'POST', '/transport/routes', {
          code: 'B1',
          name: 'Civil Lines – Sitabuldi',
          vehicleNo: 'MH31CD4521',
          driverName: 'Ganesh Pawar',
          driverMobile: '9822012345',
        });
        const riders = [...fam.kids, ...(await roster('II-A')).slice(0, 3)];
        await api(P, 'PUT', `/transport/routes/${route.id}/students`, {
          assignments: riders.map((id, i) => ({
            studentId: id,
            stopName: ['Civil Lines', 'Sadar', 'Sitabuldi'][i % 3],
            pickupTime: ['07:10', '07:20', '07:30'][i % 3],
            dropTime: ['14:10', '14:00', '13:50'][i % 3],
          })),
        });
        return `${String(riders.length)} riders`;
      },
    );

    await step(
      'library',
      (await count(`SELECT count(*) FROM library_titles WHERE school_id = $1`)) > 0,
      async () => {
        const titles: Array<[string, string, string, string]> = [
          ['BETA-LIB-1', 'Panchatantra Tales', 'Vishnu Sharma', 'Stories'],
          ['BETA-LIB-2', 'The Jungle Book', 'Rudyard Kipling', 'Fiction'],
          ['BETA-LIB-3', 'My First Atlas', 'Oxford', 'Reference'],
        ];
        for (const [code, title, author, category] of titles) {
          const t = await api<{ id: string }>(P, 'POST', '/masters/library_titles/rows', {
            values: { code, title, author, category },
          });
          await api(P, 'POST', '/library/copies', {
            titleId: t.id,
            accessionNos: [`${code}-1`, `${code}-2`],
          });
        }
        await api(P, 'POST', '/library/loans/issue', {
          accessionNo: 'BETA-LIB-1-1',
          borrowerKind: 'student',
          borrowerId: fam.kids[0],
        });
        await api(P, 'POST', '/library/loans/issue', {
          accessionNo: 'BETA-LIB-2-1',
          borrowerKind: 'student',
          borrowerId: fam.kids[1],
        });
        return '3 titles, 6 copies, 2 loans';
      },
    );

    await step(
      'exam with marks',
      (await count(
        `SELECT count(*) FROM mark_entries m JOIN students s ON s.id = m.student_id WHERE s.school_id = $1`,
      )) > 0,
      async () => {
        const C = 'dev-beta-coordinator';
        const one = async (sql: string) =>
          (await c.query<{ id: string }>(sql, [schoolId])).rows[0]?.id ?? null;
        const typeId =
          (await one(`SELECT id::text FROM exam_types WHERE school_id = $1 AND code = 'PT1'`)) ??
          (
            await api<{ id: string }>(C, 'POST', '/exams/types', {
              code: 'PT1',
              name: 'Periodic Test 1',
              weightage: 10,
              sortOrder: 1,
            })
          ).id;
        const scaleId =
          (await one(
            `SELECT id::text FROM grade_scales WHERE school_id = $1 AND code = 'CBSE8'`,
          )) ??
          (
            await api<{ id: string }>(C, 'PUT', '/exams/grade-scales', {
              code: 'CBSE8',
              name: 'Eight point',
              bands: [
                { minPct: 91, maxPct: 100, grade: 'A1', points: 10 },
                { minPct: 81, maxPct: 90.99, grade: 'A2', points: 9 },
                { minPct: 71, maxPct: 80.99, grade: 'B1', points: 8 },
                { minPct: 61, maxPct: 70.99, grade: 'B2', points: 7 },
                { minPct: 51, maxPct: 60.99, grade: 'C1', points: 6 },
                { minPct: 0, maxPct: 50.99, grade: 'C2', points: 5 },
              ],
            })
          ).id;
        const classIds = [...new Set(sections.rows.map((s) => s.class_id))];
        const subj = await c.query<{ id: string; code: string }>(
          `SELECT id::text, code FROM subjects WHERE school_id = $1 AND code IN ('ENG', 'HIN', 'MAT') AND deleted_at IS NULL ORDER BY code`,
          [schoolId],
        );
        let examId = await one(
          `SELECT id::text FROM exams WHERE school_id = $1 AND code = 'PT1-2026'`,
        );
        if (!examId) {
          examId = (
            await api<{ id: string }>(C, 'POST', '/exams', {
              examTypeId: typeId,
              code: 'PT1-2026',
              name: 'Periodic Test 1',
              startsOn: '2026-07-15',
              endsOn: '2026-07-20',
              classes: classIds.map((classId) => ({ classId, gradeScaleId: scaleId })),
            })
          ).id;
          for (const classId of classIds)
            await api(C, 'PUT', `/exams/${examId}/subjects`, {
              classId,
              subjects: subj.rows.map((s) => ({ subjectId: s.id, maxMarks: 40, passMarks: 13 })),
            });
        }
        // marks come from the teachers who own them: the class teacher of III-A (every subject) and
        // the mathematics teacher of I-A and II-A
        const entries: Array<[string, string, string[]]> = [
          ['dev-beta-teacher', 'III-A', subj.rows.map((s) => s.code)],
          ['dev-beta-subject', 'I-A', ['MAT']],
          ['dev-beta-subject', 'II-A', ['MAT']],
        ];
        let n = 0;
        for (const [sub, key, codes] of entries) {
          const ids = await roster(key);
          for (const [k, sb] of subj.rows.filter((x) => codes.includes(x.code)).entries()) {
            await api(sub, 'PUT', `/exams/${examId}/marks`, {
              classSectionId: sectionId[key],
              subjectId: sb.id,
              rows: ids.map((id, i) => ({ studentId: id, marks: 18 + ((i * 7 + k * 5) % 22) })),
            });
            n += ids.length;
          }
        }
        await api(C, 'POST', `/exams/${examId}/results/compute`).catch(() => undefined);
        return `PT1-2026, ${String(n)} marks`;
      },
    );

    await step(
      'parent query and feedback',
      (await count(`SELECT count(*) FROM feedback_entries WHERE school_id = $1`)) > 0,
      async () => {
        const F = 'dev-beta-parent';
        await api(F, 'POST', '/engagement/mine/queries', {
          studentId: fam.kids[0],
          categoryCode: 'academics',
          subject: 'Extra reading for English',
          body: 'Could you suggest a few story books for the holidays?',
        });
        await api(F, 'POST', '/engagement/feedback', {
          studentId: fam.kids[0],
          category: 'teaching',
          rating: 5,
          comment: 'The class teacher explains patiently',
        });
        await api(F, 'POST', '/engagement/feedback', {
          studentId: fam.kids[1],
          category: 'transport',
          rating: 3,
          comment: 'The bus is sometimes late',
        });
        return '1 query, 2 feedback entries';
      },
    );

    await step(
      'profile change waiting for approval',
      (await count(`SELECT count(*) FROM profile_change_requests WHERE school_id = $1`)) > 0,
      async () => {
        await api('dev-beta-parent', 'POST', `/engagement/mine/profile/${fam.kids[0]}/changes`, {
          changes: {
            blood_group: 'B+',
            emergency_contact_name: 'Kavita',
            emergency_contact_mobile: '9822098220',
          },
          reason: 'Updated after the health check-up',
        });
        return '1 request';
      },
    );
  } catch (error) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await c.end();
  }
  console.log('\nBeta logins (development sign-in):');
  for (const u of USERS) console.log(`  ${u.sub.padEnd(22)} ${u.roles.join(', ') || '(no roles)'}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
