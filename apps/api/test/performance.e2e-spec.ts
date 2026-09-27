/**
 * Sprint 11 performance check of the hot read paths against the demo-sized school seeded by this spec
 * (20 sections, 160 students, a month of attendance). Thresholds are generous for a laptop; the measured
 * p95 values are printed and recorded in docs/sprints/sprint-11.md.
 */
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

const p95 = (xs: number[]) =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95) - 1] ?? xs[xs.length - 1]!;

describe('performance (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  const h = () => headersFor(admin.sub, school.id);
  const results: Array<{ path: string; p95: number; max: number }> = [];

  beforeAll(async () => {
    const s = stamp('PF11');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      // 20 sections × 8 students with guardians, enrolled; 20 school days of attendance marks
      const yearId = school.yearId;
      for (let k = 1; k <= 10; k++) {
        const cls = await c.query<{ id: string }>(
          `INSERT INTO classes (school_id, code, name, display_order) VALUES ($1, $2, $3, $4) RETURNING id`,
          [school.id, `C${k}`, `Class ${k}`, k],
        );
        for (const name of ['A', 'B']) {
          const sec = await c.query<{ id: string }>(
            `INSERT INTO class_sections (school_id, academic_year_id, class_id, name, capacity) VALUES ($1, $2, $3, $4, 40) RETURNING id`,
            [school.id, yearId, cls.rows[0]!.id, name],
          );
          for (let i = 1; i <= 8; i++) {
            const st = await c.query<{ id: string }>(
              `INSERT INTO students (school_id, admission_no, first_name, last_name, rfid_tag) VALUES ($1, $2, $3, 'Perf', $4) RETURNING id`,
              [school.id, `PF${k}${name}${i}`, `S${i}`, `PF-${k}${name}${i}`],
            );
            const g = await c.query<{ id: string }>(
              `INSERT INTO guardians (school_id, first_name, last_name, mobile) VALUES ($1, 'G', 'Perf', $2) RETURNING id`,
              [
                school.id,
                `98${String(k).padStart(2, '0')}${name === 'A' ? '1' : '2'}${String(i).padStart(5, '0')}`,
              ],
            );
            await c.query(
              `INSERT INTO student_guardians (school_id, student_id, guardian_id, relation, is_primary) VALUES ($1, $2, $3, 'father', true)`,
              [school.id, st.rows[0]!.id, g.rows[0]!.id],
            );
            await c.query(
              `INSERT INTO enrolments (school_id, student_id, academic_year_id, class_section_id, roll_no, joined_on) VALUES ($1, $2, $3, $4, $5, CURRENT_DATE - 100)`,
              [school.id, st.rows[0]!.id, yearId, sec.rows[0]!.id, i],
            );
          }
          for (let d = 1; d <= 20; d++) {
            const ses = await c.query<{ id: string }>(
              `INSERT INTO attendance_sessions (school_id, academic_year_id, class_section_id, on_date, kind, source, marked_at) VALUES ($1, $2, $3, CURRENT_DATE - $4::int, 'day', 'manual', now()) RETURNING id`,
              [school.id, yearId, sec.rows[0]!.id, d],
            );
            await c.query(
              `INSERT INTO attendance_marks (school_id, session_id, student_id, code, source) SELECT $1, $2, e.student_id, CASE WHEN random() < 0.08 THEN 'A' ELSE 'P' END::attendance_code, 'manual' FROM enrolments e WHERE e.class_section_id = $3`,
              [school.id, ses.rows[0]!.id, sec.rows[0]!.id],
            );
          }
        }
      }
    });
    // fresh bulk inserts leave the planner without statistics for this school; production runs autovacuum
    await withMigrator((c) =>
      c.query(
        'ANALYZE students, enrolments, guardians, student_guardians, attendance_sessions, attendance_marks, class_sections',
      ),
    );
    app = await createApp();
    inject = injector(app);
  });

  afterAll(async () => {
    console.log(
      `\nPerformance (ms):\n${results.map((r) => `  ${r.path.padEnd(48)} p95 ${String(r.p95).padStart(5)}  max ${String(r.max).padStart(5)}`).join('\n')}\n`,
    );
    if (app) await app.close();
  });

  const measure = async (path: string, runs = 12) => {
    const times: number[] = [];
    for (let i = 0; i < runs; i++) {
      const t = Date.now();
      const r = await inject({ method: 'GET', url: path, headers: h() });
      expect(r.statusCode).toBe(200);
      times.push(Date.now() - t);
    }
    const row = { path, p95: p95(times.slice(2)), max: Math.max(...times.slice(2)) };
    results.push(row);
    return row;
  };

  it('students list, attendance summary, RFID dashboard, message preview and queries stay under budget', async () => {
    const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000 + 5.5 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    expect((await measure('/people/students?size=50')).p95).toBeLessThan(1200);
    expect((await measure(`/attendance/summary?date=${yesterday}`)).p95).toBeLessThan(1200);
    expect((await measure(`/attendance/rfid/dashboard?date=${today}`)).p95).toBeLessThan(1500);
    expect((await measure('/engagement/queries?size=50')).p95).toBeLessThan(800);
    expect((await measure('/comms/requests?size=50')).p95).toBeLessThan(800);
    const tpl = await inject({
      method: 'POST',
      url: '/comms/templates',
      headers: h(),
      json: {
        code: 'perf_wa',
        channel: 'whatsapp',
        name: 'Perf',
        body: '{{title}} {{body}} {{guardian_name}} {{school}}',
        variables: ['title', 'body', 'guardian_name', 'school'],
      },
    });
    const times: number[] = [];
    for (let i = 0; i < 8; i++) {
      const t = Date.now();
      const r = await inject({
        method: 'POST',
        url: '/comms/requests/preview',
        headers: h(),
        json: {
          title: 'Perf',
          templateId: tpl.json().id,
          body: 'x',
          audience: 'students',
          targets: [],
        },
      });
      expect(r.statusCode).toBe(201);
      expect(r.json().total).toBe(160);
      times.push(Date.now() - t);
    }
    results.push({
      path: 'POST /comms/requests/preview (160 guardians)',
      p95: p95(times.slice(1)),
      max: Math.max(...times.slice(1)),
    });
    expect(p95(times.slice(1))).toBeLessThan(1500);
  });
});
