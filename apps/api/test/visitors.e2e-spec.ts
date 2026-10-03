/**
 * The visitor gate pass (0065): the guard registers a walk-in visitor (type, people, ID proof last four,
 * vehicle, equipment, whom to meet), the person to be met is mailed, a returning visitor's details come
 * back by mobile, a visitor registers on their own phone and waits to be let in, the exit, the card PDF,
 * the register with its counts and Excel, and an appointment check-in landing in the same register.
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

const PHOTO = `data:image/png;base64,${Buffer.concat([
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  ),
  Buffer.alloc(80),
]).toString('base64')}`;

describe('visitor gate pass (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let guard: SeededUser;
  let teacher: SeededUser;
  let s: string;
  let host: string;
  const ids: Record<string, string> = {};
  const h = (u: SeededUser = guard) => headersFor(u.sub, school.id);
  const mobile = `97${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

  beforeAll(async () => {
    const redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      lazyConnect: true,
    });
    await redis.connect();
    const keys = await redis.keys('edupro:throttle:*');
    if (keys.length) await redis.del(...keys);
    redis.disconnect();
    s = stamp('VIS');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      guard = await seedUser(c, school, `${s}-guard`, 'gate_security');
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
      const admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, email, user_id) VALUES ($1, 'P01', 'Meena', 'Iyer', 'meena.iyer@example.com', $2)`,
        [school.id, admin.id],
      );
      await c.query(`DELETE FROM public_otps WHERE mobile = $1`, [mobile]);
    });
    app = await createApp();
    inject = injector(app);
    // the lists come with the first use; make the Principal a named person so the mail has an address
    const o = (await inject({ method: 'GET', url: '/visitors/options', headers: h() })).json();
    expect(o.types).toContain('Vendor or supplier');
    expect(o.gates).toEqual(['Main gate']);
    host = o.hosts.find((x: { name: string }) => x.name === 'Principal').id;
    await withMigrator((c) =>
      c.query(
        `UPDATE appointment_hosts SET kind = 'person', employee_id = (SELECT id FROM employees WHERE school_id = $1 AND employee_code = 'P01') WHERE id = $2`,
        [school.id, host],
      ),
    );
  });
  afterAll(async () => {
    await app.close();
  });

  it('the guard registers a walk-in visitor; the person to be met is mailed; the card prints', async () => {
    const r = await inject({
      method: 'POST',
      url: '/visitors',
      headers: h(),
      json: {
        visitorName: 'Ramesh Electricals',
        mobile: '9811100077',
        visitorType: 'Contractor or worker',
        organisation: 'Bright Power Services',
        partySize: 3,
        idProofKind: 'Driving licence',
        idProofLast4: '77qz',
        vehicleNo: 'mh12ab1234',
        equipment: 'Ladder, drill machine, tool kit',
        hostId: host,
        purpose: 'Repair of the lab wiring',
        gate: 'Main gate',
        badgeNo: 'V-11',
        photo: PHOTO,
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().number).toMatch(/^V-\d{4}-\d{4}$/);
    ids.walkin = r.json().id;
    const v = (
      await inject({ method: 'GET', url: `/visitors/${ids.walkin}`, headers: h() })
    ).json();
    expect(v).toMatchObject({
      state: 'inside',
      source: 'gate',
      visitorType: 'Contractor or worker',
      partySize: 3,
      idProofLast4: '77QZ',
      vehicleNo: 'MH12AB1234',
      equipment: 'Ladder, drill machine, tool kit',
      toMeet: 'Principal · Meena Iyer',
      gate: 'Main gate',
      hasPhoto: true,
    });
    expect(v.inAt).toBeTruthy();
    expect(v.passCode).toMatch(/^[A-Z0-9]{10}$/);
    // the person to be met hears by mail, with what the visitor carries
    const mail = await withMigrator((c) =>
      c.query<{ subject: string; body: string; format: string }>(
        `SELECT subject, body, format FROM comms_messages WHERE school_id = $1 AND recipient_address = 'meena.iyer@example.com'`,
        [school.id],
      ),
    );
    expect(mail.rows).toHaveLength(1);
    expect(mail.rows[0]!.subject).toContain('Ramesh Electricals');
    expect(mail.rows[0]!.format).toBe('html');
    expect(mail.rows[0]!.body).toContain('Ladder, drill machine, tool kit');
    // the card and the photo
    const pdf = await inject({
      method: 'GET',
      url: `/visitors/${ids.walkin}/card.pdf`,
      headers: h(),
    });
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(
      (await inject({ method: 'GET', url: `/visitors/${ids.walkin}/photo`, headers: h() })).headers[
        'content-type'
      ],
    ).toBe('image/png');
    // a type or a host that is not on the list, or nobody to meet, is refused
    for (const bad of [{ visitorType: 'Spy' }, { hostId: '999999999' }, { hostId: undefined }])
      expect(
        (
          await inject({
            method: 'POST',
            url: '/visitors',
            headers: h(),
            json: { visitorName: 'Someone', hostId: host, purpose: 'Meeting', ...bad },
          })
        ).statusCode,
      ).toBe(400);
    // a teacher is not the gate
    expect(
      (await inject({ method: 'GET', url: '/visitors', headers: h(teacher) })).statusCode,
    ).toBe(403);
  });

  it("a returning visitor's details come back by mobile number", async () => {
    const back = (
      await inject({
        method: 'POST',
        url: '/visitors/lookup',
        headers: h(),
        json: { mobile: '9811100077' },
      })
    ).json();
    expect(back.visits).toBe(1);
    expect(back.last).toMatchObject({
      visitorName: 'Ramesh Electricals',
      organisation: 'Bright Power Services',
      visitorType: 'Contractor or worker',
      idProofKind: 'Driving licence',
      idProofLast4: '77QZ',
      vehicleNo: 'MH12AB1234',
      stillInside: true,
    });
    const none = (
      await inject({
        method: 'POST',
        url: '/visitors/lookup',
        headers: h(),
        json: { mobile: '9811100000' },
      })
    ).json();
    expect(none).toEqual({ visits: 0, last: null });
  });

  it('a visitor registers on their own phone, waits, and the guard lets them in', async () => {
    const info = (
      await inject({ method: 'GET', url: `/public/visitors/${school.code}`, headers: {} })
    ).json();
    expect(info.enabled).toBe(true);
    expect(info.hosts.every((x: { person?: string }) => x.person === undefined)).toBe(true);
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
    const token = (
      await inject({
        method: 'POST',
        url: '/public/admissions/otp/verify',
        headers: {},
        json: { schoolCode: school.code, mobile, code: otp.json().devCode },
      })
    ).json().token as string;
    const visitor = { authorization: `Bearer ${token}` };
    const body = {
      visitorName: 'Sana Courier',
      visitorType: 'Courier or delivery',
      partySize: 1,
      toMeet: 'Store room',
      purpose: 'Deliver lab supplies',
      equipment: '2 cartons',
      consent: true,
    };
    // the photo is a must on a phone
    expect(
      (
        await inject({
          method: 'POST',
          url: `/public/visitors/${school.code}`,
          headers: visitor,
          json: body,
        })
      ).statusCode,
    ).toBe(400);
    const made = await inject({
      method: 'POST',
      url: `/public/visitors/${school.code}`,
      headers: visitor,
      json: { ...body, photo: PHOTO },
    });
    expect(made.statusCode).toBe(201);
    expect(made.json().state).toBe('waiting');
    ids.self = made.json().id;
    // one pass at a time
    expect(
      (
        await inject({
          method: 'POST',
          url: `/public/visitors/${school.code}`,
          headers: visitor,
          json: { ...body, photo: PHOTO },
        })
      ).json(),
    ).toMatchObject({ type: 'visitor.already_in' });
    const mine = (
      await inject({ method: 'GET', url: `/public/visitors/${school.code}/mine`, headers: visitor })
    ).json();
    expect(mine.current).toMatchObject({ state: 'waiting', toMeet: 'Store room' });
    expect(mine.profile.visitorName).toBe('Sana Courier');
    // the gate sees who is waiting and lets them in
    const waiting = (
      await inject({ method: 'GET', url: '/visitors?state=waiting', headers: h() })
    ).json();
    expect(waiting.counts).toMatchObject({ waiting: 1, inside: 1, peopleInside: 3 });
    expect(waiting.data[0]).toMatchObject({ id: ids.self, mobile, source: 'self', inAt: null });
    const admit = await inject({
      method: 'POST',
      url: `/visitors/${ids.self}/admit`,
      headers: h(),
      json: { gate: 'Main gate' },
    });
    expect(admit.statusCode).toBe(200);
    const now = (
      await inject({ method: 'GET', url: `/visitors/${ids.self}`, headers: h() })
    ).json();
    expect(now).toMatchObject({ state: 'inside', gate: 'Main gate' });
    expect(now.inAt).toBeTruthy();
    expect(
      (
        await inject({
          method: 'POST',
          url: `/visitors/${ids.self}/admit`,
          headers: h(),
          json: {},
        })
      ).statusCode,
    ).toBe(409);
  });

  it('the exit is recorded; the register filters, counts and downloads as Excel', async () => {
    const out = await inject({
      method: 'POST',
      url: `/visitors/${ids.walkin}/exit`,
      headers: h(),
      json: { exitGate: 'Main gate', note: 'All tools taken back' },
    });
    expect(out.statusCode).toBe(200);
    expect(
      (
        await inject({
          method: 'POST',
          url: `/visitors/${ids.walkin}/exit`,
          headers: h(),
          json: {},
        })
      ).statusCode,
    ).toBe(409);
    const inside = (await inject({ method: 'GET', url: '/visitors', headers: h() })).json();
    expect(inside.data.map((v: { id: string }) => v.id)).toEqual([ids.self]);
    expect(inside.counts).toMatchObject({ inside: 1, waiting: 0, today: 2, peopleInside: 1 });
    const left = (
      await inject({ method: 'GET', url: '/visitors?state=left&q=MH12AB', headers: h() })
    ).json();
    expect(left.data[0]).toMatchObject({
      id: ids.walkin,
      state: 'left',
      exitGate: 'Main gate',
      exitNote: 'All tools taken back',
    });
    const x = await inject({
      method: 'GET',
      url: '/visitors/report.xlsx?state=today',
      headers: h(),
    });
    expect(x.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.rawPayload as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(ws.rowCount).toBe(4);
    const names = [ws.getRow(3).getCell(2).value, ws.getRow(4).getCell(2).value];
    expect(names).toEqual(expect.arrayContaining(['Ramesh Electricals', 'Sana Courier']));
    // a visitor who registered on a phone and was never let in is closed the next day
    await withMigrator(async (c) => {
      const w = await c.query<{ id: string }>(
        `INSERT INTO visitor_log (school_id, source, state, visitor_name, purpose, to_meet, created_at)
         VALUES ($1, 'self', 'waiting', 'Old Waiting', 'Meeting', 'Office', now() - interval '2 days') RETURNING id::text`,
        [school.id],
      );
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.school_id', $1, true)`, [school.id]);
      const n = await c.query<{ n: number }>(`SELECT app.visitor_tick() AS n`);
      await c.query('COMMIT');
      expect(n.rows[0]!.n).toBe(1);
      const st = await c.query<{ state: string }>(`SELECT state FROM visitor_log WHERE id = $1`, [
        w.rows[0]!.id,
      ]);
      expect(st.rows[0]!.state).toBe('cancelled');
    });
  });
});
