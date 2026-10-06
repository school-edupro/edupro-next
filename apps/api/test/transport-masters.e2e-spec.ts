/**
 * Transport masters (0081): every field is checked, drop-downs accept the code or the name, crew are
 * drivers, conductors and attendants, a route's stops come from the stoppage master, the route-vehicle
 * mapping carries the crew, and a list downloads at once as Excel or PDF.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import ExcelJS from 'exceljs';
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

describe('transport masters (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  const h = () => headersFor(admin.sub, school.id);
  const save = (master: string, values: Record<string, unknown>, id?: string) =>
    inject({ method: 'POST', url: `/masters/${master}/rows`, headers: h(), json: { id, values } });
  const rows = async (master: string, qs = '') =>
    (
      await inject({ method: 'GET', url: `/masters/${master}/rows?size=100${qs}`, headers: h() })
    ).json().data as Array<Record<string, string>>;

  beforeAll(async () => {
    const s = stamp('TM');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
    });
    app = await createApp();
    inject = injector(app);
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it('checks every field: mobile, email, GST number, vehicle number, links, licence', async () => {
    const bad = await save('transport_vendors', {
      code: 'tg 1',
      name: 'Anit Corp',
      contact_person: 'Anit9',
      mobile: '93222222222222',
      email: 'kkj',
      gst_no: 'gst',
    });
    expect(bad.statusCode).toBe(400);
    for (const word of ['Code', 'Contact person', 'Mobile', 'Email', 'GST no'])
      expect(bad.json().detail).toContain(`${word}:`);
    expect(bad.json().detail).toContain('a 10-digit mobile number');
    const ok = await save('transport_vendors', {
      code: 'TG1',
      name: 'Anit Corp',
      contact_person: 'Anit Shah',
      mobile: '9322222222',
      email: 'anit@example.test',
      gst_no: '27ABCDE1234F1Z5',
    });
    expect(ok.statusCode).toBe(201);
    expect((await save('transport_vehicles', { reg_no: 'MH 12 1234' })).statusCode).toBe(400);
    expect(
      (await save('transport_vehicles', { reg_no: 'MH12AB1234', camera_url: 'camera' })).json()
        .detail,
    ).toContain('Live camera link:');
    const type = await save('transport_vehicle_types', { code: 'BUS', name: 'Bus', seats: 42 });
    expect(type.statusCode).toBe(201);
    const vehicle = await save('transport_vehicles', {
      reg_no: 'MH12AB1234',
      name: 'Yellow 1',
      model: 'Starbus',
      vehicle_type_id: 'Bus', // the name is as good as the code
      vendor_id: 'TG1',
      category: 'Vendor',
      capacity: 42,
      puc_expiry: '2027-03-31',
      rc_book: 'yes',
      ais_device: 'no',
      track_url: 'https://track.example.test/bus/1',
    });
    expect(vehicle.statusCode).toBe(201);
    expect((await rows('transport_vehicles'))[0]).toMatchObject({
      reg_no: 'MH12AB1234',
      vehicle_type_id: 'BUS',
      vendor_id: 'TG1',
      rc_book: 'true',
      puc_expiry: '2027-03-31',
    });
    const unknown = await save('transport_vehicles', { reg_no: 'MH12AB9999', vendor_id: 'Nobody' });
    expect(unknown.json().detail).toContain('"Nobody" is not on the list');
  });

  it('crew are drivers, conductors and attendants; the mapping takes each in its own place', async () => {
    expect(
      (
        await save('transport_drivers', {
          code: 'D1',
          name: 'Ramesh Pawar',
          role: 'driver',
          mobile: '12345',
        })
      ).statusCode,
    ).toBe(400);
    for (const [code, name, role, mobile] of [
      ['D1', 'Ramesh Pawar', 'driver', '9876500001'],
      ['C1', 'Sunil Jadhav', 'conductor', '9876500002'],
      ['A1', 'Lata More', 'attendant', '9876500003'],
    ])
      expect(
        (
          await save('transport_drivers', {
            code,
            name,
            role,
            mobile,
            vendor_id: 'TG1',
            ...(role === 'driver'
              ? { licence_no: 'MH1220110012345', licence_expiry: '2030-01-31' }
              : {}),
          })
        ).statusCode,
      ).toBe(201);
    // the old way of adding a driver still gets its crew code
    const old = await inject({
      method: 'POST',
      url: '/transport/drivers',
      headers: h(),
      json: { name: 'Vikas Shinde', mobile: '9876500004' },
    });
    expect(old.statusCode).toBe(201);
    expect((await rows('transport_drivers', '&q=Vikas'))[0]).toMatchObject({ role: 'driver' });
    expect((await rows('transport_drivers', '&q=Vikas'))[0]!.code).toMatch(/^CR\d{3}$/);

    expect((await save('transport_routes', { code: 'R1', name: 'Kothrud' })).statusCode).toBe(201);
    // a conductor cannot be put in the driver's seat
    const wrong = await save('transport_route_vehicles', {
      route_id: 'R1',
      vehicle_id: 'MH12AB1234',
      shift: 'both',
      driver_id: 'C1',
    });
    expect(wrong.json().detail).toContain('Driver: "C1" is not on the list');
    const dates = await save('transport_route_vehicles', {
      route_id: 'R1',
      vehicle_id: 'MH12AB1234',
      shift: 'both',
      driver_id: 'D1',
      from_date: '2026-06-01',
      to_date: '2026-04-01',
    });
    expect(dates.json().detail).toContain('To: Cannot be before From');
    const map = await save('transport_route_vehicles', {
      route_id: 'R1',
      vehicle_id: 'MH12AB1234',
      shift: 'both',
      driver_id: 'D1 · Ramesh Pawar', // as the grid and the Excel show it
      conductor_id: 'Sunil Jadhav',
      attendant_id: 'A1',
    });
    expect(map.statusCode).toBe(201);
    expect((await rows('transport_route_vehicles'))[0]).toMatchObject({
      route_id: 'R1',
      vehicle_id: 'MH12AB1234',
      driver_id: 'D1 · Ramesh Pawar',
      conductor_id: 'C1 · Sunil Jadhav',
      attendant_id: 'A1 · Lata More',
    });
    // the route follows its mapping: the bus list, GPS and the dashboards read it from the route
    const routes = (await inject({ method: 'GET', url: '/transport/routes', headers: h() })).json()
      .data as Array<Record<string, unknown>>;
    expect(JSON.stringify(routes[0])).toContain('MH12AB1234');
    const route = await withMigrator(
      async (c) =>
        (
          await c.query<{ driver_name: string; conductor_name: string; vehicle_no: string }>(
            `SELECT driver_name, conductor_name, vehicle_no FROM transport_routes WHERE school_id = $1 AND code = 'R1'`,
            [school.id],
          )
        ).rows[0]!,
    );
    expect(route).toEqual({
      driver_name: 'Ramesh Pawar',
      conductor_name: 'Sunil Jadhav',
      vehicle_no: 'MH12AB1234',
    });
    // editing the mapping may change its route, bus or trip: the same row, not a second one
    const id = (await rows('transport_route_vehicles'))[0]!.id;
    const crewOf = {
      route_id: 'R1',
      vehicle_id: 'MH12AB1234',
      driver_id: 'D1',
      conductor_id: 'C1',
      attendant_id: 'A1',
    };
    const pick = await save('transport_route_vehicles', { ...crewOf, shift: 'pick' }, id);
    expect(pick.statusCode).toBe(201);
    const after = await rows('transport_route_vehicles');
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id, shift: 'pick' });
    // a mapping that starts on a later date does not hold the route today
    const vehicleNo = async () =>
      withMigrator(
        async (c) =>
          (
            await c.query<{ vehicle_no: string | null }>(
              `SELECT vehicle_no FROM transport_routes WHERE school_id = $1 AND code = 'R1'`,
              [school.id],
            )
          ).rows[0]!.vehicle_no,
      );
    await save(
      'transport_route_vehicles',
      { ...crewOf, shift: 'both', from_date: '2099-01-01', to_date: '2099-01-31' },
      id,
    );
    expect(await vehicleNo()).toBeNull();
    // emptying the dates on the form clears them: the bus runs the route from now
    await save(
      'transport_route_vehicles',
      { ...crewOf, shift: 'both', from_date: '', to_date: '' },
      id,
    );
    expect(await vehicleNo()).toBe('MH12AB1234');
  });

  it('a route’s stops come from the stoppage master, which owns the name, the slab and the place', async () => {
    const slab = await inject({
      method: 'POST',
      url: '/fees/slabs',
      headers: h(),
      json: { code: 'S1', name: 'Up to 3 km', monthlyAmount: 1200 },
    });
    expect(slab.statusCode).toBe(201);
    expect(
      (await save('transport_stoppages', { code: 'KRV', name: 'Karve Nagar', lat: 95 })).statusCode,
    ).toBe(400);
    const stoppage = await save('transport_stoppages', {
      code: 'KRV',
      name: 'Karve Nagar',
      area: 'Kothrud',
      slab_id: 'Up to 3 km',
      radial_km: 2.4,
      route_km: 3.1,
      lat: 18.4897,
      lng: 73.82,
    });
    expect(stoppage.statusCode).toBe(201);
    expect(
      (await save('transport_stops', { route_id: 'R1', sequence: 1 })).json().detail,
    ).toContain('Stoppage: Required');
    const stop = await save('transport_stops', {
      route_id: 'R1',
      sequence: 1,
      stoppage_id: 'KRV',
      pickup_time: '07:20',
      drop_time: '14:40',
    });
    expect([stop.statusCode, stop.json().detail]).toEqual([201, undefined]);
    expect(
      (
        await save('transport_stops', {
          route_id: 'R1',
          sequence: 2,
          stoppage_id: 'KRV',
          pickup_time: '7.30',
        })
      ).statusCode,
    ).toBe(400);
    const routeId = (await rows('transport_routes'))[0]!.id;
    const onRoute = (
      await inject({ method: 'GET', url: `/transport/routes/${routeId}/stops`, headers: h() })
    ).json().data as Array<Record<string, unknown>>;
    expect(onRoute[0]).toMatchObject({ name: 'Karve Nagar', pickupTime: '07:20' });
    // the stoppage is renamed once; every route that calls there follows
    const id = (await rows('transport_stoppages'))[0]!.id;
    expect(
      (
        await save(
          'transport_stoppages',
          { code: 'KRV', name: 'Karve Nagar chowk', slab_id: 'S1' },
          id,
        )
      ).statusCode,
    ).toBe(201);
    expect((await rows('transport_stops'))[0]).toMatchObject({
      stoppage_id: 'KRV · Karve Nagar chowk',
    });
    // a stop typed by name on the route page finds its stoppage, or makes one
    const typed = await inject({
      method: 'PUT',
      url: `/transport/routes/${routeId}/stops`,
      headers: h(),
      json: {
        stops: [
          { name: 'karve nagar chowk', pickupTime: '07:20' },
          { name: 'Warje', pickupTime: '07:05' },
        ],
      },
    });
    expect(typed.statusCode).toBe(200);
    const stoppages = await rows('transport_stoppages');
    expect(stoppages.map((x) => x.name).sort()).toEqual(['Karve Nagar chowk', 'Warje']);
    expect(stoppages.find((x) => x.name === 'Warje')!.code).toMatch(/^ST\d{3}$/);
  });

  it('the upload sheet has drop-downs; a list downloads at once as Excel and as PDF', async () => {
    const tpl = await inject({
      method: 'GET',
      url: '/masters/transport_route_vehicles/template',
      headers: h(),
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tpl.rawPayload as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    const heads = (ws.getRow(1).values as unknown[]).slice(1).map(String);
    expect(heads).toEqual([
      'Route',
      'Vehicle no',
      'Trip',
      'Driver',
      'Conductor',
      'Attendant (support staff)',
      'From',
      'To',
      'Status',
    ]);
    for (const col of ['A', 'B', 'C', 'D', 'E', 'F', 'I'])
      expect(ws.getCell(`${col}2`).dataValidation?.type).toBe('list');
    expect(ws.getCell('G2').dataValidation?.type).toBe('date');
    const lists = wb.getWorksheet('Lists')!;
    const column = (n: number) =>
      (lists.getColumn(n).values as unknown[]).filter(Boolean).map(String);
    expect(column(3)).toEqual(['Trip', 'both', 'pick', 'drop']);
    expect(column(4).slice(1)).toEqual(expect.arrayContaining(['D1 · Ramesh Pawar']));
    expect(column(4)).not.toContain('C1 · Sunil Jadhav'); // drivers only
    // a filled row uploads as it is
    ws.getRow(2).values = ['R1', 'MH12AB1234', 'pick', 'D1 · Ramesh Pawar', 'C1 · Sunil Jadhav'];
    const up = await inject({
      method: 'POST',
      url: '/masters/transport_route_vehicles/imports/validate',
      headers: h(),
      json: {
        fileName: 'mapping.xlsx',
        contentBase64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
      },
    });
    expect(up.json()).toMatchObject({ status: 'validated', okRows: 1 });

    const xlsx = await inject({
      method: 'GET',
      url: '/masters/transport_drivers/export?format=xlsx&q=pawar',
      headers: h(),
    });
    expect(xlsx.statusCode).toBe(200);
    expect(String(xlsx.headers['content-disposition'])).toMatch(
      /attachment; filename="transport_drivers-.*\.xlsx"/,
    );
    const out = new ExcelJS.Workbook();
    await out.xlsx.load(xlsx.rawPayload as unknown as ArrayBuffer);
    expect(out.worksheets[0]!.rowCount).toBe(2);
    expect(String(out.worksheets[0]!.getRow(2).getCell(2).value)).toBe('Ramesh Pawar');
    const pdf = await inject({
      method: 'GET',
      url: '/masters/transport_vendors/export?format=pdf',
      headers: h(),
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });
});
