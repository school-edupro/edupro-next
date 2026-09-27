/**
 * Sprint 10 devices: bus readers (boarding and alighting with guardian alerts and consent), biometric punch
 * ingestion with the day summary, and the RFID dashboard (reader health, gate counts, tagged students not in).
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

const todayIst = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const atIst = (hhmm: string) => {
  const [hh, mm] = hhmm.split(':').map(Number) as [number, number];
  const d = new Date(`${todayIst()}T00:00:00Z`);
  d.setUTCHours(hh - 5, mm - 30);
  return d.toISOString();
};

describe('devices: bus, punch, dashboard (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let parent: SeededUser;
  let studentId: string;
  let routeId: string;
  let busKey: string;
  let bioKey: string;
  const h = () => headersFor(admin.sub, school.id);

  beforeAll(async () => {
    const s = stamp('D10');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, biometric_id) VALUES ($1, 'D10A', 'Bina', 'Ten', 'BIO-001'), ($1, 'D10B', 'Chetan', 'Ten', 'BIO-002')`,
        [school.id],
      );
      await c.query(
        `INSERT INTO comms_templates (school_id, code, channel, name, body, variables) VALUES ($1, 'bus_boarded', 'whatsapp', 'Bus boarded', '{{student_name}} boarded the bus at {{time}} ({{stop}}). {{school}}', '["student_name","time","stop","school"]'::jsonb)`,
        [school.id],
      );
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'IX', name: 'Class IX', displayOrder: 9 },
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
        admissionNo: 'D10-1',
        firstName: 'Dev',
        lastName: 'Ten',
        guardians: [
          {
            guardian: { firstName: 'Gauri', lastName: 'Ten', mobile: '9876530001' },
            relation: 'mother',
            isPrimary: true,
          },
        ],
        enrolment: { classSectionId: sec.json().id, rollNo: 1 },
      },
    });
    studentId = st.json().id;
    await inject({
      method: 'POST',
      url: '/people/students',
      headers: h(),
      json: {
        admissionNo: 'D10-2',
        firstName: 'Esha',
        lastName: 'Ten',
        guardians: [],
        enrolment: { classSectionId: sec.json().id, rollNo: 2 },
      },
    });
    await withMigrator(async (c) => {
      await c.query(
        `UPDATE guardians SET user_id = $1 WHERE school_id = $2 AND mobile = '9876530001'`,
        [parent.id, school.id],
      );
      await c.query(`UPDATE students SET rfid_tag = 'D10-TAG-1' WHERE id = $1`, [studentId]);
    });
    const route = await inject({
      method: 'POST',
      url: '/transport/routes',
      headers: h(),
      json: { code: 'B7', name: 'Baner' },
    });
    routeId = route.json().id;
    await inject({
      method: 'PUT',
      url: `/transport/routes/${routeId}/students`,
      headers: h(),
      json: { assignments: [{ studentId, stopName: 'Baner phata' }] },
    });
    const bus = await inject({
      method: 'POST',
      url: '/attendance/rfid/devices',
      headers: h(),
      json: { code: 'BUS7', name: 'Bus 7 reader', kind: 'bus', routeId },
    });
    expect(bus.statusCode).toBe(201);
    busKey = bus.json().apiKey;
    const bio = await inject({
      method: 'POST',
      url: '/attendance/rfid/devices',
      headers: h(),
      json: { code: 'BIO1', name: 'Staff room punch', kind: 'biometric' },
    });
    bioKey = bio.json().apiKey;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('bus taps record boarding and alighting, alert the guardian once, and skip duplicates and unknown tags', async () => {
    const r = await inject({
      method: 'POST',
      url: '/attendance/rfid/events',
      headers: { 'x-device-key': busKey },
      json: {
        school: school.code,
        device: 'BUS7',
        events: [
          { tag: 'D10-TAG-1', at: atIst('07:22'), direction: 'in', lat: 18.559, lng: 73.789 },
          { tag: 'D10-TAG-1', at: atIst('07:22'), direction: 'in' },
          { tag: 'NOPE', at: atIst('07:25'), direction: 'in' },
          { tag: 'D10-TAG-1', at: atIst('08:05'), direction: 'out' },
        ],
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().outcomes).toEqual({ boarded: 1, duplicate: 1, unknown_tag: 1, alighted: 1 });
    const list = await inject({
      method: 'GET',
      url: `/attendance/bus?date=${todayIst()}&routeId=${routeId}`,
      headers: h(),
    });
    expect(list.json().routes).toEqual([{ route: 'B7', boarded: 1, alighted: 1 }]);
    const boarded = list.json().data.find((e: { outcome: string }) => e.outcome === 'boarded');
    expect(boarded).toMatchObject({ student: 'Dev Ten', lat: '18.559000', route: 'B7' });
    expect(boarded.alertSentAt).not.toBeNull(); // bus_boarded template exists
    const alighted = list.json().data.find((e: { outcome: string }) => e.outcome === 'alighted');
    expect(alighted.alertSentAt).toBeNull(); // no bus_alighted template in this school
    const msgs = await inject({
      method: 'GET',
      url: `/comms/messages?recipientUserId=${parent.id}`,
      headers: h(),
    });
    expect(msgs.json().data).toHaveLength(1);
    expect(msgs.json().data[0].body).toContain('Dev Ten boarded the bus at 07:22');
    expect(msgs.json().data[0].body).toContain('Baner phata');
    const mine = await inject({
      method: 'GET',
      url: '/attendance/bus/mine',
      headers: headersFor(parent.sub, school.id),
    });
    expect(mine.json().children[0].events).toHaveLength(2);
    const gateOnBus = await inject({
      method: 'POST',
      url: '/attendance/punch/events',
      headers: { 'x-device-key': busKey },
      json: {
        school: school.code,
        device: 'BUS7',
        events: [{ id: 'BIO-001', at: atIst('09:00') }],
      },
    });
    expect(gateOnBus.statusCode).toBe(409);
  });

  it('withdrawn transport consent stops the alert but not the record', async () => {
    await inject({
      method: 'POST',
      url: '/comms/consents/mine',
      headers: headersFor(parent.sub, school.id),
      json: { purposeCode: 'transport.tracking', status: 'withdrawn' },
    });
    const r = await inject({
      method: 'POST',
      url: '/attendance/rfid/events',
      headers: { 'x-device-key': busKey },
      json: {
        school: school.code,
        device: 'BUS7',
        events: [{ tag: 'D10-TAG-1', at: atIst('13:40'), direction: 'in' }],
      },
    });
    expect(r.json().outcomes).toEqual({ boarded: 1 });
    const msgs = await inject({
      method: 'GET',
      url: `/comms/messages?recipientUserId=${parent.id}`,
      headers: h(),
    });
    expect(msgs.json().data).toHaveLength(1);
  });

  it('punches from a biometric device build the day summary', async () => {
    const wrong = await inject({
      method: 'POST',
      url: '/attendance/punch/events',
      headers: { 'x-device-key': 'nope' },
      json: {
        school: school.code,
        device: 'BIO1',
        events: [{ id: 'BIO-001', at: atIst('08:55') }],
      },
    });
    expect(wrong.statusCode).toBe(401);
    const r = await inject({
      method: 'POST',
      url: '/attendance/punch/events',
      headers: { 'x-device-key': bioKey },
      json: {
        school: school.code,
        device: 'BIO1',
        events: [
          { id: 'BIO-001', at: atIst('08:55') },
          { id: 'BIO-001', at: atIst('08:55') },
          { id: 'BIO-001', at: atIst('17:05') },
          { id: 'BIO-999', at: atIst('09:00') },
        ],
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().outcomes).toEqual({ recorded: 2, duplicate: 1, unknown_id: 1 });
    const summary = await inject({
      method: 'GET',
      url: `/attendance/punch/summary?date=${todayIst()}`,
      headers: h(),
    });
    expect(summary.json()).toMatchObject({ present: 1, absent: 1 });
    const bina = summary.json().rows.find((x: { code: string }) => x.code === 'D10A');
    expect(bina).toMatchObject({ punches: 2, hours: 8.17 });
    expect(bina.firstIn).toBe(atIst('08:55'));
    const log = await inject({
      method: 'GET',
      url: `/attendance/punch/log?date=${todayIst()}`,
      headers: h(),
    });
    expect(log.json().data).toHaveLength(3); // the identical re-send is dropped by the unique key, not logged
    const rfidEndpoint = await inject({
      method: 'POST',
      url: '/attendance/rfid/events',
      headers: { 'x-device-key': bioKey },
      json: {
        school: school.code,
        device: 'BIO1',
        events: [{ tag: 'D10-TAG-1', at: atIst('09:00'), direction: 'in' }],
      },
    });
    expect(rfidEndpoint.statusCode).toBe(409);
  });

  it('the RFID dashboard reports reader health, counts and tagged students not in', async () => {
    const d = await inject({
      method: 'GET',
      url: `/attendance/rfid/dashboard?date=${todayIst()}`,
      headers: h(),
    });
    expect(d.statusCode).toBe(200);
    const bus = d.json().devices.find((x: { code: string }) => x.code === 'BUS7');
    expect(bus).toMatchObject({
      kind: 'bus',
      route: 'B7',
      health: 'online',
      boarded: 2,
      alighted: 1,
    });
    const bio = d.json().devices.find((x: { code: string }) => x.code === 'BIO1');
    expect(bio).toMatchObject({ kind: 'biometric', punches: 2 });
    expect(d.json().sections[0]).toMatchObject({
      section: 'IX-A',
      strength: 2,
      tagged: 1,
      inToday: 0,
      notIn: 1,
    });
    expect(d.json().notIn).toEqual([
      expect.objectContaining({ name: 'Dev Ten', tag: 'D10-TAG-1' }),
    ]);
    const devices = await inject({ method: 'GET', url: '/attendance/rfid/devices', headers: h() });
    expect(
      devices.json().data.map((x: { code: string; kind: string }) => [x.code, x.kind]),
    ).toEqual([
      ['BIO1', 'biometric'],
      ['BUS7', 'bus'],
    ]);
  });
});
