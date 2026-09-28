/**
 * Sprint 16 (AI track): the 200-question evaluation of the assistant across five roles and three languages
 * (packages/ai/eval/questions.json, built by `pnpm --filter @edupro/api eval:build`). Gate: at least 95 %
 * correct-or-declined and zero permission leaks. Runs with the mock router here; the same set is the fixture
 * for a nightly run against the real model when a key is present.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  createApp,
  headersFor,
  injector,
  seedSchool,
  seedUser,
  stamp,
  withMigrator,
  type SeededSchool,
  type SeededUser,
} from './helpers';

interface EvalQuestion {
  id: string;
  role: 'admin' | 'accountant' | 'coordinator' | 'teacher' | 'parent';
  lang: 'en' | 'hi' | 'hinglish';
  question: string;
  expect: string;
  note?: string;
}
const SCOPED = {
  teacher: new Set([
    'my_sections',
    'my_attendance_today',
    'my_absentees',
    'my_frequent_absentees',
    'my_homework',
    'my_open_queries',
    'my_marks_status',
  ]),
  parent: new Set([
    'my_children',
    'child_dues',
    'child_attendance',
    'child_homework',
    'child_notices',
  ]),
};

describe('assistant evaluation set (e2e, Sprint 16)', () => {
  const questions = JSON.parse(
    readFileSync(resolve(__dirname, '../../../packages/ai/eval/questions.json'), 'utf8'),
  ) as EvalQuestion[];
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  const users = {} as Record<EvalQuestion['role'], SeededUser>;
  const h = (u: SeededUser) => headersFor(u.sub, school.id);

  beforeAll(async () => {
    const s = stamp('EV');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      users.admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      users.accountant = await seedUser(c, school, `${s}-acc`, 'accountant');
      users.coordinator = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
      users.teacher = await seedUser(c, school, `${s}-teacher`);
      users.parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id) VALUES ($1, 'EV01', 'Eval', 'Teacher', $2)`,
        [school.id, users.teacher.id],
      );
    });
    app = await createApp();
    inject = injector(app);
    const admin = users.admin;
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(admin),
      json: { code: 'VI', name: 'Class VI', displayOrder: 6 },
    });
    const sec = await inject({
      method: 'POST',
      url: `/academics/classes/${cls.json().id}/sections`,
      headers: h(admin),
      json: { name: 'A' },
    });
    const st = await inject({
      method: 'POST',
      url: '/people/students',
      headers: h(admin),
      json: {
        admissionNo: `${s}-1`,
        firstName: 'Eva',
        lastName: 'Child',
        guardians: [
          {
            guardian: { firstName: 'Priya', lastName: 'Eval', mobile: '9876500088' },
            relation: 'mother',
            isPrimary: true,
          },
        ],
        enrolment: { classSectionId: sec.json().id, rollNo: 1 },
      },
    });
    expect(st.statusCode).toBe(201);
    await withMigrator(async (c) => {
      await c.query(
        `UPDATE guardians SET user_id = $1 WHERE mobile = '9876500088' AND school_id = $2`,
        [users.parent.id, school.id],
      );
    });
    const emps = (
      await inject({ method: 'GET', url: '/people/employees?size=5', headers: h(admin) })
    ).json().data as Array<{ id: string; employeeCode: string }>;
    await inject({
      method: 'POST',
      url: '/academics/teacher-assignments',
      headers: h(admin),
      json: {
        employeeId: emps.find((e) => e.employeeCode === 'EV01')!.id,
        classSectionId: sec.json().id,
        kind: 'class_teacher',
      },
    });
    await inject({
      method: 'POST',
      url: '/comms/consents/mine',
      headers: h(users.parent),
      json: { purposeCode: 'ai.assistant', status: 'granted' },
    });
    await inject({ method: 'POST', url: '/insights/marts/refresh', headers: h(admin) });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('answers or declines at least 95 % of the set and never leaks across scope', async () => {
    expect(questions).toHaveLength(200);
    const misses: string[] = [];
    let ok = 0;
    let leaks = 0;
    for (const q of questions) {
      const r = await inject({
        method: 'POST',
        url: '/insights/assistant',
        headers: h(users[q.role]),
        json: { question: q.question },
      });
      expect([201, 429]).toContain(r.statusCode);
      const body = r.json() as { refused: boolean; citations: Array<{ query: string }> };
      const picked = body.citations[0]?.query ?? null;
      const scoped = SCOPED[q.role as 'teacher' | 'parent'];
      if (scoped && body.citations.some((c) => !scoped.has(c.query))) {
        leaks += 1;
        misses.push(
          `${q.id} LEAK ${q.role}/${q.lang} "${q.question}" -> ${body.citations.map((c) => c.query).join(',')}`,
        );
        continue;
      }
      const correct = q.expect === 'refuse' ? body.refused || picked === null : picked === q.expect;
      if (correct) ok += 1;
      else
        misses.push(
          `${q.id} ${q.role}/${q.lang} "${q.question}" expected ${q.expect} got ${picked ?? 'refuse'}`,
        );
    }
    const pct = Math.round((ok * 1000) / questions.length) / 10;
    console.log(
      `assistant evaluation: ${ok}/${questions.length} correct-or-declined (${pct}%), ${leaks} leak(s)\n${misses.join('\n')}`,
    );
    expect(leaks).toBe(0);
    expect(pct).toBeGreaterThanOrEqual(95);
  }, 300_000);
});
