/**
 * Sprint 9 attendance: marking rules (future, weekly off, holiday, scope, assignment), absent alerts, the
 * family view, the day summary, locks, RFID device keys and ingestion rules (late, dedupe, manual kept).
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

const lastWeekday = (): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

describe('attendance (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  let parent: SeededUser;
  let sectionA: string;
  let sectionB: string;
  let studentA: string;
  let studentB: string;
  let deviceKey = '';
  const date = lastWeekday();
  const h = () => headersFor(admin.sub, school.id);

  beforeAll(async () => {
    const s = stamp('T9');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`);
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id) VALUES ($1, 'T09', 'Tara', 'Teacher', $2)`,
        [school.id, teacher.id],
      );
      await c.query(
        `INSERT INTO holidays (school_id, academic_year_id, name, kind, starts_on, ends_on) VALUES ($1, $2, 'Founders day', 'holiday', '2026-12-24', '2026-12-24')`,
        [school.id, school.yearId],
      );
      await c.query(
        `INSERT INTO comms_templates (school_id, code, channel, name, body, variables) VALUES ($1, 'absent_alert', 'whatsapp', 'Absent alert', '{{student_name}} ({{section}}) was absent on {{date}}', '["student_name","section","date"]'::jsonb)`,
        [school.id],
      );
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'VI', name: 'Class VI', displayOrder: 6 },
    });
    for (const name of ['A', 'B']) {
      const sec = await inject({
        method: 'POST',
        url: `/academics/classes/${cls.json().id}/sections`,
        headers: h(),
        json: { name },
      });
      if (name === 'A') sectionA = sec.json().id;
      else sectionB = sec.json().id;
    }
    const mk = async (
      adm: string,
      first: string,
      section: string,
      roll: number,
      withParent: boolean,
    ) => {
      const r = await inject({
        method: 'POST',
        url: '/people/students',
        headers: h(),
        json: {
          admissionNo: adm,
          firstName: first,
          lastName: 'Nine',
          guardians: withParent
            ? [
                {
                  guardian: { firstName: 'Pari', lastName: 'Parent', mobile: '9876500009' },
                  relation: 'mother',
                  isPrimary: true,
                },
              ]
            : [],
          enrolment: { classSectionId: section, rollNo: roll },
        },
      });
      expect(r.statusCode).toBe(201);
      return r.json().id as string;
    };
    studentA = await mk('T9A1', 'Ana', sectionA, 1, true);
    await mk('T9A2', 'Bala', sectionA, 2, false);
    studentB = await mk('T9B1', 'Chitra', sectionB, 1, false);
    await withMigrator(async (c) => {
      await c.query(
        `UPDATE guardians SET user_id = $1 WHERE mobile = '9876500009' AND school_id = $2`,
        [parent.id, school.id],
      );
      await c.query(`UPDATE students SET rfid_tag = 'TAG-A1' WHERE id = $1`, [studentA]);
      await c.query(`UPDATE students SET rfid_tag = 'TAG-B1' WHERE id = $1`, [studentB]);
    });
    const emp = await inject({ method: 'GET', url: '/people/employees?size=5', headers: h() });
    const ta = await inject({
      method: 'POST',
      url: '/academics/teacher-assignments',
      headers: h(),
      json: { employeeId: emp.json().data[0].id, classSectionId: sectionA, kind: 'class_teacher' },
    });
    expect(ta.statusCode).toBe(201);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('refuses future dates, weekly offs, holidays and sections outside the teacher’s assignment', async () => {
    const th = headersFor(teacher.sub, school.id);
    const future = await inject({
      method: 'POST',
      url: '/attendance/sessions',
      headers: th,
      json: {
        classSectionId: sectionA,
        date: '2099-01-05',
        marks: [{ studentId: studentA, code: 'P' }],
      },
    });
    expect(future.statusCode).toBe(409);
    expect(future.json()).toMatchObject({ type: 'attendance.future_date' });
    const sunday = await inject({
      method: 'POST',
      url: '/attendance/sessions',
      headers: th,
      json: {
        classSectionId: sectionA,
        date: '2026-09-20',
        marks: [{ studentId: studentA, code: 'P' }],
      },
    });
    expect(sunday.json()).toMatchObject({ type: 'attendance.weekly_off' });
    await withMigrator((c) =>
      c.query(
        `UPDATE holidays SET starts_on = $2::date, ends_on = $2::date WHERE school_id = $1 AND name = 'Founders day'`,
        [school.id, date],
      ),
    );
    const holiday = await inject({
      method: 'POST',
      url: '/attendance/sessions',
      headers: th,
      json: { classSectionId: sectionA, date, marks: [{ studentId: studentA, code: 'P' }] },
    });
    expect(holiday.json()).toMatchObject({ type: 'attendance.holiday', holiday: 'Founders day' });
    await withMigrator((c) =>
      c.query(
        `UPDATE holidays SET starts_on = '2026-12-24', ends_on = '2026-12-24' WHERE school_id = $1 AND name = 'Founders day'`,
        [school.id],
      ),
    );
    const other = await inject({
      method: 'POST',
      url: '/attendance/sessions',
      headers: th,
      json: { classSectionId: sectionB, date, marks: [{ studentId: studentB, code: 'P' }] },
    });
    expect(other.statusCode).toBe(403);
    const wrongStudent = await inject({
      method: 'POST',
      url: '/attendance/sessions',
      headers: th,
      json: { classSectionId: sectionA, date, marks: [{ studentId: studentB, code: 'P' }] },
    });
    expect(wrongStudent.statusCode).toBe(422);
    expect(wrongStudent.json()).toMatchObject({ type: 'attendance.student_not_in_section' });
  });

  it('marks a day session, alerts the guardian once, and shows the family and dashboard views', async () => {
    const th = headersFor(teacher.sub, school.id);
    const roster = await inject({
      method: 'GET',
      url: `/attendance/session?classSectionId=${sectionA}&date=${date}`,
      headers: th,
    });
    expect(roster.statusCode).toBe(200);
    expect(roster.json().roster).toHaveLength(2);
    expect(roster.json().id).toBeNull();
    const marked = await inject({
      method: 'POST',
      url: '/attendance/sessions',
      headers: th,
      json: {
        classSectionId: sectionA,
        date,
        marks: [
          { studentId: studentA, code: 'A', remarks: 'fever' },
          { studentId: roster.json().roster[1].studentId, code: 'P' },
        ],
      },
    });
    expect(marked.statusCode).toBe(201);
    expect(marked.json()).toMatchObject({
      counts: { strength: 2, A: 1, P: 1, unmarked: 0 },
      alertsSent: 1,
      markedBy: 'Tara Teacher',
    });
    const again = await inject({
      method: 'POST',
      url: '/attendance/sessions',
      headers: th,
      json: { classSectionId: sectionA, date, marks: [{ studentId: studentA, code: 'A' }] },
    });
    expect(again.json().alertsSent).toBe(0); // never twice
    const messages = await inject({ method: 'GET', url: '/comms/messages?size=10', headers: h() });
    expect(messages.json().data.some((m: { body: string }) => m.body.includes('Ana Nine'))).toBe(
      true,
    );

    const family = await inject({
      method: 'GET',
      url: `/attendance/mine?month=${date.slice(0, 7)}`,
      headers: headersFor(parent.sub, school.id),
    });
    expect(family.statusCode).toBe(200);
    expect(family.json().children[0]).toMatchObject({
      name: 'Ana Nine',
      summary: { days: 1, present: 0, absent: 1 },
    });
    const peek = await inject({
      method: 'GET',
      url: `/attendance/students/${studentB}`,
      headers: headersFor(parent.sub, school.id),
    });
    expect(peek.statusCode).toBe(404);
    const own = await inject({
      method: 'GET',
      url: `/attendance/students/${studentA}`,
      headers: headersFor(parent.sub, school.id),
    });
    expect(own.json().summary).toMatchObject({ days: 1, absent: 1 });

    const summary = await inject({
      method: 'GET',
      url: `/attendance/summary?date=${date}`,
      headers: h(),
    });
    const a = summary.json().sections.find((x: { section: string }) => x.section === 'VI-A');
    expect(a).toMatchObject({ strength: 2, present: 1, absent: 1, markedBy: 'Tara Teacher' });
    const teacherSummary = await inject({
      method: 'GET',
      url: `/attendance/summary?date=${date}`,
      headers: th,
    });
    expect(teacherSummary.json().sections.map((x: { section: string }) => x.section)).toEqual([
      'VI-A',
    ]);

    const lock = await inject({
      method: 'PUT',
      url: `/attendance/sessions/${marked.json().id}/lock`,
      headers: h(),
      json: { locked: true },
    });
    expect(lock.json().locked).toBe(true);
    const lockedMark = await inject({
      method: 'POST',
      url: '/attendance/sessions',
      headers: th,
      json: { classSectionId: sectionA, date, marks: [{ studentId: studentA, code: 'P' }] },
    });
    expect(lockedMark.statusCode).toBe(409);
    expect(lockedMark.json()).toMatchObject({ type: 'attendance.locked' });
    await inject({
      method: 'PUT',
      url: `/attendance/sessions/${marked.json().id}/lock`,
      headers: h(),
      json: { locked: false },
    });
  });

  it('RFID: device keys, first in marks present or late, out is recorded, taps are deduplicated, manual marks kept', async () => {
    const dev = await inject({
      method: 'POST',
      url: '/attendance/rfid/devices',
      headers: h(),
      json: { code: 'GATE1', name: 'Main gate' },
    });
    expect(dev.statusCode).toBe(201);
    deviceKey = dev.json().apiKey;
    expect(deviceKey.startsWith('dev_')).toBe(true);
    const wrong = await inject({
      method: 'POST',
      url: '/attendance/rfid/events',
      headers: { 'x-device-key': 'nope' },
      json: {
        school: school.code,
        device: 'GATE1',
        events: [{ tag: 'TAG-B1', at: `${date}T02:45:00Z`, direction: 'in' }],
      },
    });
    expect(wrong.statusCode).toBe(401);
    const at = (hhmmIst: string) => {
      const [hh, mm] = hhmmIst.split(':').map(Number) as [number, number];
      const d = new Date(`${date}T00:00:00Z`);
      d.setUTCHours(hh - 5, mm - 30); // IST = UTC+5:30
      return d.toISOString();
    };
    const first = await inject({
      method: 'POST',
      url: '/attendance/rfid/events',
      headers: { 'x-device-key': deviceKey },
      json: {
        school: school.code,
        device: 'GATE1',
        events: [
          { tag: 'TAG-B1', at: at('08:20'), direction: 'in' },
          { tag: 'TAG-B1', at: at('08:20'), direction: 'in' },
          { tag: 'TAG-A1', at: at('09:40'), direction: 'in' },
          { tag: 'UNKNOWN', at: at('08:00'), direction: 'in' },
          { tag: 'TAG-B1', at: at('14:05'), direction: 'out' },
        ],
      },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().outcomes).toEqual({
      marked_present: 1,
      duplicate: 1,
      manual_kept: 1,
      unknown_tag: 1,
      out_recorded: 1,
    });
    const b = await inject({
      method: 'GET',
      url: `/attendance/session?classSectionId=${sectionB}&date=${date}`,
      headers: h(),
    });
    expect(b.json()).toMatchObject({ source: 'rfid' });
    expect(b.json().roster[0]).toMatchObject({ code: 'P', source: 'rfid' });
    expect(b.json().roster[0].inAt).not.toBeNull();
    expect(b.json().roster[0].outAt).not.toBeNull();
    const a = await inject({
      method: 'GET',
      url: `/attendance/session?classSectionId=${sectionA}&date=${date}`,
      headers: h(),
    });
    expect(
      a.json().roster.find((r: { studentId: string }) => r.studentId === studentA),
    ).toMatchObject({ code: 'A', source: 'manual' });
    const lateDay = new Date(`${date}T00:00:00Z`);
    lateDay.setUTCDate(lateDay.getUTCDate() - (lateDay.getUTCDay() === 1 ? 2 : 1));
    const lateAt = new Date(lateDay);
    lateAt.setUTCHours(4, 10); // 09:40 IST
    const late = await inject({
      method: 'POST',
      url: '/attendance/rfid/events',
      headers: { 'x-device-key': deviceKey },
      json: {
        school: school.code,
        device: 'GATE1',
        events: [{ tag: 'TAG-B1', at: lateAt.toISOString(), direction: 'in' }],
      },
    });
    expect(late.json().outcomes).toEqual({ marked_late: 1 });
    const log = await inject({
      method: 'GET',
      url: `/attendance/rfid/log?date=${date}`,
      headers: h(),
    });
    expect(log.json().data.length).toBe(5);
    const devices = await inject({ method: 'GET', url: '/attendance/rfid/devices', headers: h() });
    expect(devices.json().data[0]).toMatchObject({ code: 'GATE1' });
    expect(devices.json().data[0].lastSeenAt).not.toBeNull();
  });
});
