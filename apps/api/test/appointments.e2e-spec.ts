/**
 * Appointments v2 (0059): the set-up (desks, visiting hours, slots, the booking QR), a parent books a slot
 * with the class teacher, an outside visitor books after a mobile OTP (one-time code and intimations queued
 * for SMS / WhatsApp), the front desk approves, rejects, reschedules and books walk-ins, slot capacity, the
 * pass at the gate (visitor log in and out), no-shows and reminders from the tick, the calendar, the
 * dashboard and the Excel.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import ExcelJS from 'exceljs';
import IORedis from 'ioredis';
import { PowService } from '../src/modules/admissions/public/pow.service';
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

/** The next school day (Monday to Friday, India time) at least `min` days ahead, as YYYY-MM-DD. */
function schoolDay(min: number, anyDay = false): string {
  for (let i = min; i < min + 7; i += 1) {
    const d = new Date(Date.now() + 330 * 60_000 + i * 86_400_000);
    if (anyDay || (d.getUTCDay() >= 1 && d.getUTCDay() <= 5)) return d.toISOString().slice(0, 10);
  }
  throw new Error('no school day');
}
// a 1x1 PNG padded past the smallest size the photo check accepts
const PHOTO = `data:image/png;base64,${Buffer.concat([
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  ),
  Buffer.alloc(80),
]).toString('base64')}`;

describe('appointments v2 (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let other: SeededSchool;
  let admin: SeededUser;
  let principal: SeededUser;
  let guard: SeededUser;
  let teacher: SeededUser;
  let parent: SeededUser;
  let s: string;
  let studentId: string;
  const day = schoolDay(2);
  const later = schoolDay(4);
  const ids: Record<string, string> = {};
  const hosts: Record<string, string> = {};
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const mobile = `98${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  let visitor: Record<string, string>;

  const queued = (address: string, code: string) =>
    withMigrator(async (c) => {
      const r = await c.query<{ channel: string; body: string }>(
        `SELECT m.channel::text, m.body FROM comms_messages m JOIN comms_templates t ON t.id = m.template_id
          WHERE m.school_id = $1 AND m.recipient_address = $2 AND t.code = $3 ORDER BY m.id`,
        [school.id, address, code],
      );
      return r.rows;
    });
  const tick = () =>
    withMigrator(async (c) => {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.school_id', $1, true)`, [school.id]);
      const r = await c.query<{ n: number }>(
        `SELECT app.appointment_tick('https://visit.example') AS n`,
      );
      await c.query('COMMIT');
      return r.rows[0]!.n;
    });

  /** Per-IP throttle counters live in Redis for a minute; clear them so a run after other suites starts clean. */
  const resetThrottle = async () => {
    const redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      lazyConnect: true,
    });
    try {
      await redis.connect();
      const keys = await redis.keys('edupro:throttle:*');
      if (keys.length) await redis.del(...keys);
    } finally {
      redis.disconnect();
    }
  };

  beforeAll(async () => {
    await resetThrottle();
    s = stamp('APT');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      other = await seedSchool(c, `${s}B`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      // the admin here also works the front desk and the gate; the principal is a plain school admin
      await c.query(
        `INSERT INTO user_roles (school_id, user_id, role_id, reason)
         SELECT $1, $2, id, 'e2e' FROM roles WHERE school_id IS NULL AND code IN ('front_desk', 'gate_security')`,
        [school.id, admin.id],
      );
      principal = await seedUser(c, school, `${s}-principal`, 'school_admin');
      guard = await seedUser(c, school, `${s}-guard`, 'gate_security');
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, email, user_id) VALUES ($1, 'T01', 'Tanvi', 'Rao', 'tanvi.rao@example.com', $2)`,
        [school.id, teacher.id],
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
    const sec = await inject({
      method: 'POST',
      url: `/academics/classes/${cls.json().id}/sections`,
      headers: h(),
      json: { name: 'A' },
    });
    const st = await inject({
      method: 'POST',
      url: '/people/students',
      headers: h(),
      json: {
        admissionNo: `${s}-1`,
        firstName: 'Aanya',
        lastName: 'Slot',
        guardians: [
          {
            guardian: { firstName: 'Rohit', lastName: 'Slot', mobile: '9876500111' },
            relation: 'father',
            isPrimary: true,
          },
        ],
        enrolment: { classSectionId: sec.json().id, rollNo: 1 },
      },
    });
    expect(st.statusCode).toBe(201);
    studentId = st.json().id;
    await withMigrator(async (c) => {
      await c.query(
        `UPDATE guardians SET user_id = $1 WHERE mobile = '9876500111' AND school_id = $2`,
        [parent.id, school.id],
      );
      const emp = await c.query<{ id: string }>(
        `SELECT id::text FROM employees WHERE school_id = $1 AND employee_code = 'T01'`,
        [school.id],
      );
      ids.teacherEmp = emp.rows[0]!.id;
      await c.query(`DELETE FROM public_otps WHERE mobile = $1`, [mobile]);
    });
    const ta = await inject({
      method: 'POST',
      url: '/academics/teacher-assignments',
      headers: h(),
      json: { employeeId: ids.teacherEmp, classSectionId: sec.json().id, kind: 'class_teacher' },
    });
    expect(ta.statusCode).toBe(201);
  });
  afterAll(async () => {
    await app.close();
  });

  it('the set-up starts with desks, visiting hours and the booking QR; the admin changes it', async () => {
    const setup = await inject({ method: 'GET', url: '/appointments/setup', headers: h() });
    expect(setup.statusCode).toBe(200);
    const body = setup.json();
    for (const x of body.hosts as Array<{ id: string; name: string }>) hosts[x.name] = x.id;
    expect(Object.keys(hosts)).toEqual(
      expect.arrayContaining([
        'Front office',
        'Admissions desk',
        'Accounts office',
        'Principal',
        'Class teacher',
      ]),
    );
    expect(body.settings).toMatchObject({
      publicEnabled: true,
      autoApprove: false,
      askPhoto: 'required',
    });
    expect(body.booking.url).toBe(`http://localhost:3003/${school.code.toLowerCase()}/appointment`);
    expect(body.booking.qr).toContain('<svg');
    // every message has a template per channel; SMS and WhatsApp are not ready until the school adds its ids
    const approved = (
      body.templates as Array<{ code: string; channel: string; ready: boolean }>
    ).filter((t) => t.code === 'appointment_approved');
    expect(approved.map((t) => t.channel).sort()).toEqual(['email', 'sms', 'whatsapp']);
    expect(approved.find((t) => t.channel === 'email')!.ready).toBe(true);
    expect(approved.find((t) => t.channel === 'sms')!.ready).toBe(false);
    // until then nothing is queued on those channels; the school adds its DLT ids and WhatsApp names
    await withMigrator((c) =>
      c.query(
        `UPDATE comms_templates SET dlt_template_id = '1707' || id, wa_template_name = code WHERE school_id = $1 AND code LIKE 'appointment\\_%'`,
        [school.id],
      ),
    );
    const ready = (await inject({ method: 'GET', url: '/appointments/setup', headers: h() })).json()
      .templates as Array<{ ready: boolean }>;
    expect(ready.every((t) => t.ready)).toBe(true);
    const save = await inject({
      method: 'PUT',
      url: '/appointments/setup/settings',
      headers: h(),
      json: { ...body.settings, minNoticeHours: 1, instructions: 'Carry the ID you named.' },
    });
    expect(save.statusCode).toBe(200);
    // a named person, met by parents only, with two visiting windows
    const person = await inject({
      method: 'POST',
      url: '/appointments/setup/hosts',
      headers: h(),
      json: {
        name: 'Counsellor',
        kind: 'person',
        employeeId: ids.teacherEmp,
        location: 'Room 12',
        openPublic: false,
        openParent: true,
        slotMinutes: 30,
        capacity: 1,
        hours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, starts: '11:00', ends: '12:00' })),
      },
    });
    expect(person.statusCode).toBe(201);
    hosts.Counsellor = person.json().id;
    const dup = await inject({
      method: 'POST',
      url: '/appointments/setup/hosts',
      headers: h(),
      json: {
        name: 'counsellor',
        kind: 'desk',
        openPublic: true,
        openParent: true,
        slotMinutes: 20,
        capacity: 1,
        hours: [],
      },
    });
    expect(dup.statusCode).toBe(409);
    // the set-up is the admin's
    expect(
      (await inject({ method: 'GET', url: '/appointments/setup', headers: h(teacher) })).statusCode,
    ).toBe(403);
    // the principal (a school admin) keeps the set-up but is not the front desk or the gate
    expect(
      (await inject({ method: 'GET', url: '/appointments/setup', headers: h(principal) }))
        .statusCode,
    ).toBe(200);
    for (const url of ['/appointments', '/appointments/dashboard', '/appointments/gate/board'])
      expect((await inject({ method: 'GET', url, headers: h(principal) })).statusCode).toBe(403);
    expect(
      (await inject({ method: 'GET', url: '/appointments/with-me', headers: h(principal) })).json(),
    ).toEqual({ data: [] });
    // the gate sees its own screen only
    expect(
      (await inject({ method: 'GET', url: '/appointments/gate/board', headers: h(guard) }))
        .statusCode,
    ).toBe(200);
    expect(
      (await inject({ method: 'GET', url: '/appointments', headers: h(guard) })).statusCode,
    ).toBe(403);
    // a teacher is not the front desk: no queue, no decisions
    expect(
      (await inject({ method: 'GET', url: '/appointments', headers: h(teacher) })).statusCode,
    ).toBe(403);
  });

  it('a parent books a slot with the class teacher; the front desk confirms it', async () => {
    const list = (
      await inject({ method: 'GET', url: '/appointments/mine/hosts', headers: h(parent) })
    ).json();
    expect(list.data.map((x: { name: string }) => x.name)).toEqual(
      expect.arrayContaining(['Class teacher', 'Counsellor', 'Principal']),
    );
    const slots = (
      await inject({
        method: 'GET',
        url: `/appointments/mine/slots?hostId=${hosts['Class teacher']}&date=${day}&studentId=${studentId}`,
        headers: h(parent),
      })
    ).json();
    expect(slots.closed).toBeNull();
    // the days the class teacher can be booked, each with its free times (school days only)
    const days = (
      await inject({
        method: 'GET',
        url: `/appointments/mine/days?hostId=${hosts['Class teacher']}&studentId=${studentId}`,
        headers: h(parent),
      })
    ).json();
    expect(days.data.length).toBe(10);
    expect(days.data.map((d: { date: string }) => d.date)).toContain(day);
    expect(days.data.every((d: { free: number }) => d.free > 0 && d.free <= 4)).toBe(true);
    expect(
      days.data.every(
        (d: { date: string }) => ![0, 6].includes(new Date(`${d.date}T00:00:00Z`).getUTCDay()),
      ),
    ).toBe(true);
    expect(slots.slots.map((x: { time: string }) => x.time)).toEqual([
      '14:00',
      '14:15',
      '14:30',
      '14:45',
    ]);
    const book = await inject({
      method: 'POST',
      url: '/appointments/mine',
      headers: h(parent),
      json: {
        studentId,
        hostId: hosts['Class teacher'],
        startsAt: `${day}T14:15`,
        purpose: 'Discuss reading progress',
      },
    });
    expect(book.statusCode).toBe(201);
    expect(book.json().state).toBe('requested');
    ids.parent = book.json().id;
    // the same slot again, a time that is not a slot, another family's child
    const again = await inject({
      method: 'POST',
      url: '/appointments/mine',
      headers: h(parent),
      json: {
        studentId,
        hostId: hosts['Class teacher'],
        startsAt: `${day}T14:15`,
        purpose: 'Again please',
      },
    });
    expect(again.statusCode).toBe(409);
    const odd = await inject({
      method: 'POST',
      url: '/appointments/mine',
      headers: h(parent),
      json: {
        studentId,
        hostId: hosts['Class teacher'],
        startsAt: `${day}T14:20`,
        purpose: 'Odd time',
      },
    });
    expect(odd.json()).toMatchObject({ type: 'appointment.no_slot' });
    const notMine = await inject({
      method: 'POST',
      url: '/appointments/mine',
      headers: h(parent),
      json: {
        studentId: '999999999',
        hostId: hosts.Principal,
        startsAt: `${day}T10:00`,
        purpose: 'Not mine',
      },
    });
    expect(notMine.statusCode).toBe(404);
    // the slot is now held
    const after = (
      await inject({
        method: 'GET',
        url: `/appointments/slots?hostId=${hosts['Class teacher']}&date=${day}&studentId=${studentId}`,
        headers: h(),
      })
    ).json();
    expect(after.slots.find((x: { time: string }) => x.time === '14:15')).toMatchObject({
      free: 0,
      available: false,
    });
    // the queue
    const queue = (
      await inject({ method: 'GET', url: '/appointments?state=open', headers: h() })
    ).json();
    expect(queue.counts.open).toBe(1);
    expect(queue.data[0]).toMatchObject({
      id: ids.parent,
      source: 'parent',
      student: 'Aanya Slot',
      hostName: 'Class teacher',
      withName: 'Tanvi Rao',
    });
    // the teacher does not see it until the front desk has confirmed it
    expect(
      (await inject({ method: 'GET', url: '/appointments/with-me', headers: h(teacher) })).json()
        .data,
    ).toEqual([]);
    const ok = await inject({
      method: 'POST',
      url: `/appointments/${ids.parent}/approve`,
      headers: h(),
      json: { location: 'Staff room' },
    });
    expect(ok.statusCode).toBe(200);
    const twice = await inject({
      method: 'POST',
      url: `/appointments/${ids.parent}/approve`,
      headers: h(),
      json: {},
    });
    expect(twice.json()).toMatchObject({ type: 'appointment.wrong_state' });
    const mine = (
      await inject({ method: 'GET', url: '/appointments/mine', headers: h(parent) })
    ).json();
    expect(mine.data[0]).toMatchObject({ id: ids.parent, state: 'approved', place: 'Staff room' });
    expect(mine.data[0].passLink).toContain(`/${school.code.toLowerCase()}/pass/`);
    expect(mine.page).toMatchObject({ total: 1, size: 10 });
    // the parent's list filters; one appointment opens with what was asked and what happened
    const none = (
      await inject({ method: 'GET', url: '/appointments/mine?state=past', headers: h(parent) })
    ).json();
    expect(none.page.total).toBe(0);
    const found = (
      await inject({
        method: 'GET',
        url: `/appointments/mine?state=open&q=reading&studentId=${studentId}`,
        headers: h(parent),
      })
    ).json();
    expect(found.data.map((x: { id: string }) => x.id)).toEqual([ids.parent]);
    const detail = (
      await inject({ method: 'GET', url: `/appointments/mine/${ids.parent}`, headers: h(parent) })
    ).json();
    expect(detail).toMatchObject({ purpose: 'Discuss reading progress', withName: 'Tanvi Rao' });
    expect(detail.passQr).toContain('<svg');
    expect(detail.passBarcode).toContain('<svg');
    expect(detail.events.map((e: { kind: string }) => e.kind)).toEqual(['requested', 'approved']);
    // the teacher sees it among the appointments with her, without the parent's contact details
    const withMe = (
      await inject({ method: 'GET', url: '/appointments/with-me', headers: h(teacher) })
    ).json();
    expect(withMe.data).toHaveLength(1);
    expect(withMe.data[0]).toMatchObject({
      id: ids.parent,
      state: 'approved',
      student: 'Aanya Slot',
    });
    expect(withMe.data[0].visitorMobile).toBeUndefined();
    expect(
      (
        await inject({
          method: 'POST',
          url: `/appointments/${ids.parent}/cancel`,
          headers: h(teacher),
          json: {},
        })
      ).statusCode,
    ).toBe(403);
    // the teacher to be met is told by mail; a parent cannot decide
    const mail = await withMigrator((c) =>
      c.query<{ subject: string }>(
        `SELECT subject FROM comms_messages WHERE school_id = $1 AND channel = 'email' AND recipient_address = 'tanvi.rao@example.com'`,
        [school.id],
      ),
    );
    expect(mail.rows[0]!.subject).toContain('approved');
    expect(
      (
        await inject({
          method: 'POST',
          url: `/appointments/${ids.parent}/reject`,
          headers: h(parent),
          json: { reason: 'No thanks' },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('an outside visitor books from the QR page after a mobile OTP; the front desk reschedules', async () => {
    const info = (
      await inject({ method: 'GET', url: `/public/appointments/${school.code}`, headers: {} })
    ).json();
    expect(info).toMatchObject({ enabled: true, ask: { photo: 'required', idProof: 'required' } });
    const names = info.hosts.map((x: { name: string }) => x.name);
    expect(names).toEqual(expect.arrayContaining(['Front office', 'Admissions desk']));
    expect(names).not.toContain('Class teacher');
    expect(names).not.toContain('Counsellor');
    expect(info.hosts.every((x: { person: string | null }) => x.person === null)).toBe(true);
    const slots = (
      await inject({
        method: 'GET',
        url: `/public/appointments/${school.code}/slots?hostId=${hosts['Admissions desk']}&date=${day}`,
        headers: {},
      })
    ).json();
    expect(slots.slots[0]).toEqual({ time: '09:30', startsAt: `${day}T09:30`, available: true });
    // booking needs the OTP sign-in
    const anon = await inject({
      method: 'POST',
      url: `/public/appointments/${school.code}`,
      headers: {},
      json: {
        hostId: hosts['Admissions desk'],
        startsAt: `${day}T09:30`,
        purpose: 'Admission enquiry',
      },
    });
    expect(anon.statusCode).toBe(401);
    const ch = await inject({ method: 'POST', url: '/public/admissions/challenge', headers: {} });
    const otp = await inject({
      method: 'POST',
      url: '/public/admissions/otp',
      headers: {},
      json: {
        schoolCode: school.code,
        mobile,
        challenge: ch.json().challenge,
        nonce: PowService.solve(ch.json().challenge, ch.json().difficulty),
      },
    });
    expect(otp.statusCode).toBe(201);
    // the code goes out by SMS and WhatsApp
    const sent = await queued(mobile, 'appointment_otp');
    expect(sent.map((m) => m.channel).sort()).toEqual(['sms', 'whatsapp']);
    expect(sent[0]!.body).toContain(otp.json().devCode);
    const token = (
      await inject({
        method: 'POST',
        url: '/public/admissions/otp/verify',
        headers: {},
        json: { schoolCode: school.code, mobile, code: otp.json().devCode, name: 'Vikram Mehta' },
      })
    ).json().token as string;
    visitor = { authorization: `Bearer ${token}` };
    const base = {
      hostId: hosts['Admissions desk'],
      startsAt: `${day}T09:30`,
      purpose: 'Admission enquiry',
      visitorName: 'Vikram Mehta',
      visitorEmail: 'vikram@example.com',
      visitorOrg: 'Pune',
      partySize: 2,
      consent: true,
    };
    // the school asks for an ID proof and a photo
    const bare = await inject({
      method: 'POST',
      url: `/public/appointments/${school.code}`,
      headers: visitor,
      json: base,
    });
    expect(bare.statusCode).toBe(400);
    // a desk that is not open to the public cannot be booked from outside
    const closed = await inject({
      method: 'POST',
      url: `/public/appointments/${school.code}`,
      headers: visitor,
      json: {
        ...base,
        hostId: hosts.Counsellor,
        startsAt: `${day}T11:00`,
        idProofKind: 'PAN',
        idProofLast4: '123F',
        photo: PHOTO,
      },
    });
    expect(closed.statusCode).toBe(404);
    const book = await inject({
      method: 'POST',
      url: `/public/appointments/${school.code}`,
      headers: visitor,
      json: { ...base, idProofKind: 'PAN', idProofLast4: '123f', photo: PHOTO },
    });
    expect(book.statusCode).toBe(201);
    expect(book.json().state).toBe('requested');
    ids.public = book.json().id;
    expect((await queued(mobile, 'appointment_requested')).length).toBe(2);
    // the one-time code was for this school: the same token books nothing at another school
    const elsewhere = await inject({
      method: 'GET',
      url: `/public/appointments/${other.code}/mine`,
      headers: visitor,
    });
    expect(elsewhere.statusCode).toBe(401);
    // the open days of a desk
    const open = (
      await inject({
        method: 'GET',
        url: `/public/appointments/${school.code}/days?hostId=${hosts['Admissions desk']}`,
        headers: {},
      })
    ).json();
    expect(open.data.length).toBe(10);
    expect(open.data[0]).toEqual({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    // the visitor sees the request, no pass yet
    const mine = (
      await inject({
        method: 'GET',
        url: `/public/appointments/${school.code}/mine`,
        headers: visitor,
      })
    ).json();
    expect(mine.data[0]).toMatchObject({
      id: ids.public,
      state: 'requested',
      passLink: null,
      passQr: null,
    });
    // what the visitor gave comes back to fill the next form (the photo is taken fresh each time)
    expect(mine.profile).toMatchObject({
      visitorName: 'Vikram Mehta',
      visitorOrg: 'Pune',
      visitorEmail: 'vikram@example.com',
      idProofKind: 'PAN',
      idProofLast4: '123F',
      partySize: 2,
    });
    // the front desk sees who is coming, with the photo and the masked ID
    const one = (
      await inject({ method: 'GET', url: `/appointments/${ids.public}`, headers: h() })
    ).json();
    expect(one).toMatchObject({
      source: 'public',
      visitorName: 'Vikram Mehta',
      visitorMobile: mobile,
      partySize: 2,
      idProofKind: 'PAN',
      idProofLast4: '123F',
      hasPhoto: true,
    });
    const photo = await inject({
      method: 'GET',
      url: `/appointments/${ids.public}/photo`,
      headers: h(),
    });
    expect(photo.statusCode).toBe(200);
    expect(photo.headers['content-type']).toBe('image/png');
    // a new time: confirmed at once and the visitor is told, with the pass link
    const move = await inject({
      method: 'POST',
      url: `/appointments/${ids.public}/reschedule`,
      headers: h(),
      json: { startsAt: `${later}T10:10`, reason: 'The desk is in a meeting till 10.' },
    });
    expect(move.statusCode).toBe(200);
    const told = await queued(mobile, 'appointment_rescheduled');
    expect(told.length).toBe(2);
    expect(told[0]!.body).toContain(`/${school.code.toLowerCase()}/pass/`);
    expect((await queued('vikram@example.com', 'appointment_rescheduled')).length).toBe(1);
    const now = (
      await inject({
        method: 'GET',
        url: `/public/appointments/${school.code}/mine`,
        headers: visitor,
      })
    ).json();
    expect(now.data[0]).toMatchObject({ state: 'approved', host: 'Admissions desk' });
    expect(now.data[0].passQr).toContain('<svg');
    ids.pass = String(now.data[0].passLink).split('/').pop()!;
    // the pass page behind the link shows the first name only
    const pass = (
      await inject({
        method: 'GET',
        url: `/public/appointments/${school.code}/pass/${ids.pass}`,
        headers: {},
      })
    ).json();
    expect(pass.barcode).toContain('<svg');
    expect(pass.idProofLast4).toBeUndefined();
    // the visitor opens the appointment and sees everything they filled in
    const own = (
      await inject({
        method: 'GET',
        url: `/public/appointments/${school.code}/mine/${ids.public}`,
        headers: visitor,
      })
    ).json();
    expect(own).toMatchObject({
      visitorName: 'Vikram Mehta',
      visitorOrg: 'Pune',
      visitorEmail: 'vikram@example.com',
      idProofKind: 'PAN',
      idProofLast4: '123F',
      partySize: 2,
      hasPhoto: true,
    });
    expect(own.events.map((e: { kind: string }) => e.kind)).toEqual(['requested', 'rescheduled']);
    expect(
      (
        await inject({
          method: 'GET',
          url: `/public/appointments/${school.code}/mine/${ids.public}/photo`,
          headers: visitor,
        })
      ).headers['content-type'],
    ).toBe('image/png');
    expect(pass).toMatchObject({
      state: 'approved',
      visitorName: 'Vikram Mehta',
      visitorOrg: 'Pune',
      instructions: 'Carry the ID you named.',
    });
    expect(
      (
        await inject({
          method: 'GET',
          url: `/public/appointments/${school.code}/pass/AAAAAAAAAA`,
          headers: {},
        })
      ).statusCode,
    ).toBe(404);
  });

  it('the gate checks the visitor in from the pass and out again; the visitor log has the entry', async () => {
    const found = (
      await inject({
        method: 'POST',
        url: '/appointments/gate/find',
        headers: h(),
        json: { code: `http://localhost:3003/${school.code.toLowerCase()}/pass/${ids.pass}` },
      })
    ).json();
    expect(found.data.map((x: { id: string }) => x.id)).toEqual([ids.public]);
    // the gate screen: what was found, with who is inside and who is expected today
    const board = (
      await inject({
        method: 'GET',
        url: `/appointments/gate/board?found=${ids.public}`,
        headers: h(),
      })
    ).json();
    expect(board.found.map((x: { id: string }) => x.id)).toEqual([ids.public]);
    expect(board.inside).toEqual([]);
    expect(board.expected).toEqual([]); // the found visit is for another day
    // a request that is not confirmed cannot come in
    const walk = await inject({
      method: 'POST',
      url: '/appointments',
      headers: h(),
      json: {
        hostId: hosts['Front office'],
        startsAt: `${day}T09:00`,
        purpose: 'Courier pick-up',
        visitorName: 'Sunil Courier',
        visitorMobile: '9811122233',
        approve: false,
      },
    });
    expect(walk.statusCode).toBe(201);
    ids.waiting = walk.json().id;
    expect(
      (
        await inject({
          method: 'POST',
          url: `/appointments/${ids.waiting}/check-in`,
          headers: h(),
          json: {},
        })
      ).json(),
    ).toMatchObject({ type: 'appointment.not_confirmed' });
    // the appointment is for another day: no check-in before its day
    const early = await inject({
      method: 'POST',
      url: `/appointments/${ids.public}/check-in`,
      headers: h(guard),
      json: {},
    });
    expect(early.json()).toMatchObject({ type: 'appointment.not_today' });
    await withMigrator((c) =>
      c.query(`UPDATE appointments SET starts_at = now() + interval '5 minutes' WHERE id = $1`, [
        ids.public,
      ]),
    );
    // the card the gate prints: what the visitor gave, the barcode and the QR
    const card = (
      await inject({ method: 'GET', url: `/appointments/${ids.public}/card`, headers: h(guard) })
    ).json();
    expect(card).toMatchObject({
      visitorName: 'Vikram Mehta',
      visitorOrg: 'Pune',
      purpose: 'Admission enquiry',
      idProofKind: 'PAN',
      hostName: 'Admissions desk',
      passCode: ids.pass,
    });
    expect(card.barcode).toContain('<svg');
    expect(card.qr).toContain('<svg');
    const inn = await inject({
      method: 'POST',
      url: `/appointments/${ids.public}/check-in`,
      headers: h(guard),
      json: { badgeNo: 'V-07' },
    });
    expect(inn.statusCode).toBe(200);
    const log = await withMigrator((c) =>
      c.query<{ visitor_name: string; to_meet: string; badge_no: string; out_at: Date | null }>(
        `SELECT visitor_name, to_meet, badge_no, out_at FROM visitor_log WHERE id = $1`,
        [inn.json().visitorLogId],
      ),
    );
    expect(log.rows[0]).toMatchObject({
      visitor_name: 'Vikram Mehta',
      to_meet: 'Admissions desk',
      badge_no: 'V-07',
      out_at: null,
    });
    const out = await inject({
      method: 'POST',
      url: `/appointments/${ids.public}/check-out`,
      headers: h(),
    });
    expect(out.statusCode).toBe(200);
    const one = (
      await inject({ method: 'GET', url: `/appointments/${ids.public}`, headers: h() })
    ).json();
    expect(one.state).toBe('completed');
    expect(one.events.map((e: { kind: string }) => e.kind)).toEqual([
      'requested',
      'rescheduled',
      'checked_in',
      'checked_out',
    ]);
    // the visitor cannot cancel a visit that is over
    expect(
      (
        await inject({
          method: 'POST',
          url: `/public/appointments/${school.code}/${ids.public}/cancel`,
          headers: visitor,
          json: {},
        })
      ).statusCode,
    ).toBe(409);
  });

  it('the front desk books walk-ins up to the slot capacity, rejects and cancels', async () => {
    // Front office takes two per slot: one waiting already, one more fits, the third does not
    const second = await inject({
      method: 'POST',
      url: '/appointments',
      headers: h(),
      json: {
        hostId: hosts['Front office'],
        startsAt: `${day}T09:00`,
        purpose: 'Certificate collection',
        visitorName: 'Meena Joshi',
        visitorMobile: '9811122244',
      },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().state).toBe('approved');
    ids.walkin = second.json().id;
    const third = await inject({
      method: 'POST',
      url: '/appointments',
      headers: h(),
      json: {
        hostId: hosts['Front office'],
        startsAt: `${day}T09:00`,
        purpose: 'Third person',
        visitorName: 'Extra',
      },
    });
    expect(third.json()).toMatchObject({ type: 'appointment.slot_taken' });
    // declining the waiting one frees its place
    const no = await inject({
      method: 'POST',
      url: `/appointments/${ids.waiting}/reject`,
      headers: h(),
      json: { reason: 'Courier desk is at the gate.' },
    });
    expect(no.statusCode).toBe(200);
    expect((await queued('9811122233', 'appointment_rejected'))[0]!.body).toContain(
      'Courier desk is at the gate.',
    );
    const free = (
      await inject({
        method: 'GET',
        url: `/appointments/slots?hostId=${hosts['Front office']}&date=${day}`,
        headers: h(),
      })
    ).json();
    expect(free.slots[0]).toMatchObject({ time: '09:00', free: 1, available: true });
    // about a pupil: found by name or admission number, with class and guardian to be sure who it is
    const hits = (
      await inject({ method: 'GET', url: '/appointments/students?q=aany', headers: h() })
    ).json();
    expect(hits.data).toEqual([
      expect.objectContaining({
        id: studentId,
        name: 'Aanya Slot',
        section: 'VI-A',
        guardian: 'Rohit Slot',
        mobileEnd: '0111',
      }),
    ]);
    expect(
      (await inject({ method: 'GET', url: `/appointments/students?q=${s}-1`, headers: h() })).json()
        .data,
    ).toHaveLength(1);
    // the guardian on record is the one told
    const pupil = await inject({
      method: 'POST',
      url: '/appointments',
      headers: h(),
      json: {
        hostId: hosts.Principal,
        startsAt: nextPrincipalSlot(),
        purpose: 'Scholarship form',
        studentId,
      },
    });
    expect(pupil.statusCode).toBe(201);
    const row = (
      await inject({ method: 'GET', url: `/appointments/${pupil.json().id}`, headers: h() })
    ).json();
    expect(row).toMatchObject({
      student: 'Aanya Slot',
      visitorName: 'Rohit Slot',
      visitorMobile: '9876500111',
    });
    const cancel = await inject({
      method: 'POST',
      url: `/appointments/${pupil.json().id}/cancel`,
      headers: h(),
      json: { reason: 'Principal is away.' },
    });
    expect(cancel.statusCode).toBe(200);
    expect((await queued('9876500111', 'appointment_cancelled')).length).toBe(2);
    // the parent cancels their own
    const mine = await inject({
      method: 'POST',
      url: `/appointments/mine/${ids.parent}/cancel`,
      headers: h(parent),
      json: {},
    });
    expect(mine.statusCode).toBe(200);
  });

  /** Principal sits on Tuesdays and Thursdays: the next one at least two days ahead. */
  function nextPrincipalSlot(): string {
    for (let i = 2; i < 10; i += 1) {
      const d = new Date(Date.now() + 330 * 60_000 + i * 86_400_000);
      if (d.getUTCDay() === 2 || d.getUTCDay() === 4)
        return `${d.toISOString().slice(0, 10)}T10:00`;
    }
    throw new Error('no principal day');
  }

  it('the tick reminds before the visit, marks no-shows and wipes expired one-time codes', async () => {
    // the walk-in confirmed for later: bring it within the reminder window, decided well before
    await withMigrator((c) =>
      c.query(
        `UPDATE appointments SET starts_at = now() + interval '1 hour', decided_at = now() - interval '1 day' WHERE id = $1`,
        [ids.walkin],
      ),
    );
    expect(await tick()).toBe(1);
    const reminder = await queued('9811122244', 'appointment_reminder');
    expect(reminder.length).toBe(2);
    expect(reminder[0]!.body).toContain('https://visit.example/');
    expect(await tick()).toBe(0); // once only
    // nobody came
    await withMigrator((c) =>
      c.query(`UPDATE appointments SET starts_at = now() - interval '3 hours' WHERE id = $1`, [
        ids.walkin,
      ]),
    );
    expect(await tick()).toBe(1);
    const one = (
      await inject({ method: 'GET', url: `/appointments/${ids.walkin}`, headers: h() })
    ).json();
    expect(one.state).toBe('no_show');
    // an old one-time code is no longer readable in the message log
    await withMigrator((c) =>
      c.query(
        `UPDATE comms_messages SET created_at = now() - interval '1 hour' WHERE school_id = $1 AND recipient_address = $2`,
        [school.id, mobile],
      ),
    );
    await tick();
    const otp = await queued(mobile, 'appointment_otp');
    expect(otp.every((m) => m.body.includes('******') && !/\d{6}/.test(m.body))).toBe(true);
  });

  it('the calendar, the dashboard and the Excel show the same appointments', async () => {
    const cal = (
      await inject({
        method: 'GET',
        url: `/appointments/calendar?from=${schoolDay(0, true)}&to=${later}`,
        headers: h(),
      })
    ).json();
    expect(cal.hosts.length).toBeGreaterThanOrEqual(6);
    expect(cal.data.map((x: { id: string }) => x.id)).toContain(ids.public);
    expect(
      cal.data.every((x: { state: string }) => !['rejected', 'cancelled'].includes(x.state)),
    ).toBe(true);
    const tooLong = await inject({
      method: 'GET',
      url: `/appointments/calendar?from=2026-01-01&to=2026-06-01`,
      headers: h(),
    });
    expect(tooLong.statusCode).toBe(400);
    const dash = (
      await inject({ method: 'GET', url: '/appointments/dashboard', headers: h() })
    ).json();
    expect(dash.months).toHaveLength(6);
    const m = dash.months[5];
    expect(m.total).toBe(5);
    expect(m).toMatchObject({
      fromPublic: 1,
      fromParent: 1,
      fromDesk: 3,
      rejected: 1,
      cancelled: 2,
      completed: 1,
      noShow: 1,
      rescheduled: 1,
    });
    expect(dash.week).toHaveLength(7);
    expect(dash.hosts[0]).toMatchObject({ name: 'Front office', total: 2 });
    const x = await inject({
      method: 'GET',
      url: '/appointments/report.xlsx?source=public',
      headers: h(),
    });
    expect(x.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.rawPayload as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(ws.rowCount).toBe(3);
    expect(ws.getRow(3).getCell(4).value).toBe('Vikram Mehta');
    expect(ws.getRow(3).getCell(13).value).toBe('Completed');
    // search and paging on the queue
    const q = (
      await inject({ method: 'GET', url: '/appointments?q=Meena&size=5', headers: h() })
    ).json();
    expect(q.page.total).toBe(1);
  });

  it('with auto-approve on a free slot is confirmed at once; with online booking off the page is closed', async () => {
    const setup = (
      await inject({ method: 'GET', url: '/appointments/setup', headers: h() })
    ).json();
    await inject({
      method: 'PUT',
      url: '/appointments/setup/settings',
      headers: h(),
      json: { ...setup.settings, autoApprove: true, askPhoto: 'off', askIdProof: 'optional' },
    });
    const book = await inject({
      method: 'POST',
      url: `/public/appointments/${school.code}`,
      headers: visitor,
      json: {
        hostId: hosts['Front office'],
        startsAt: `${later}T12:00`,
        purpose: 'Vendor meeting',
        visitorName: 'Vikram Mehta',
        partySize: 1,
        consent: true,
      },
    });
    expect(book.statusCode).toBe(201);
    expect(book.json().state).toBe('approved');
    expect((await queued(mobile, 'appointment_approved')).length).toBe(2);
    const cancel = await inject({
      method: 'POST',
      url: `/public/appointments/${school.code}/${book.json().id}/cancel`,
      headers: visitor,
      json: { reason: 'Plans changed' },
    });
    expect(cancel.statusCode).toBe(200);
    await inject({
      method: 'PUT',
      url: '/appointments/setup/settings',
      headers: h(),
      json: { ...setup.settings, publicEnabled: false },
    });
    const info = (
      await inject({ method: 'GET', url: `/public/appointments/${school.code}`, headers: {} })
    ).json();
    expect(info).toMatchObject({ enabled: false, hosts: [] });
    const shut = await inject({
      method: 'POST',
      url: `/public/appointments/${school.code}`,
      headers: visitor,
      json: {
        hostId: hosts['Front office'],
        startsAt: `${later}T12:15`,
        purpose: 'Vendor meeting',
        visitorName: 'Vikram Mehta',
        partySize: 1,
        consent: true,
      },
    });
    expect(shut.json()).toMatchObject({ type: 'appointment.public_closed' });
  });
});
