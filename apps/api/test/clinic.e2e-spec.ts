/**
 * Clinic management (0075): set-up, medicine stock by batch, visits of pupils and staff (medicines come
 * out of stock, parents are told when it matters), a health check-up camp with a card the doctor
 * publishes, the family's view, the dashboard and the Excel.
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

describe('clinic management (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let doctor: SeededUser;
  let teacher: SeededUser;
  let parent: SeededUser;
  let s: string;
  let studentId: string;
  let sectionId: string;
  let employeeId: string;
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const get = async (url: string, u: SeededUser = doctor) =>
    (await inject({ method: 'GET', url, headers: h(u) })).json();
  const post = (url: string, u: SeededUser, json: unknown = {}) =>
    inject({ method: 'POST', url, headers: h(u), json });
  const put = (url: string, u: SeededUser, json: unknown = {}) =>
    inject({ method: 'PUT', url, headers: h(u), json });

  beforeAll(async () => {
    s = stamp('CL');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      doctor = await seedUser(c, school, `${s}-doctor`, 'school_doctor');
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      const e = await c.query<{ id: string }>(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id, department)
         VALUES ($1, 'TC', 'Tara', 'Clinic', $2, 'Science') RETURNING id::text`,
        [school.id, teacher.id],
      );
      employeeId = e.rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
    const cls = await post('/academics/classes', admin, {
      code: 'VI',
      name: 'Class VI',
      displayOrder: 6,
    });
    const sec = await post(`/academics/classes/${cls.json().id}/sections`, admin, { name: 'A' });
    sectionId = sec.json().id;
    const st = await post('/people/students', admin, {
      admissionNo: `${s}-1`,
      firstName: 'Aanya',
      lastName: 'Clinic',
      guardians: [
        {
          guardian: {
            firstName: 'Rohit',
            lastName: 'Clinic',
            mobile: '9876519881',
            email: `rohit-${s.toLowerCase()}@example.test`,
          },
          relation: 'father',
          isPrimary: true,
        },
      ],
      enrolment: { classSectionId: sectionId, rollNo: 1 },
    });
    expect(st.statusCode).toBe(201);
    studentId = st.json().id;
    await withMigrator((c) =>
      c.query(`UPDATE guardians SET user_id = $1 WHERE mobile = '9876519881' AND school_id = $2`, [
        parent.id,
        school.id,
      ]),
    );
  });
  afterAll(async () => {
    await app.close();
  });

  const ids: Record<string, string> = {};
  it('the admin sets up the clinic, doctor, nurse, diseases and medicines; a teacher has no way in', async () => {
    expect(
      (await inject({ method: 'GET', url: '/clinic/visits', headers: h(teacher) })).statusCode,
    ).toBe(403);
    expect(
      (await inject({ method: 'GET', url: '/clinic/setup', headers: h(doctor) })).statusCode,
    ).toBe(403);
    for (const [key, body] of [
      ['clinic', { kind: 'clinic', name: 'Main clinic' }],
      [
        'doctor',
        { kind: 'doctor', name: 'Dr. Asha Rao', qualification: 'MBBS', regNo: 'KMC 12345' },
      ],
      ['nurse', { kind: 'nurse', name: 'Sr. Mary', mobile: '9876500012' }],
      ['fever', { kind: 'disease', name: 'Fever' }],
      ['headache', { kind: 'disease', name: 'Headache' }],
    ] as const) {
      const r = await post('/clinic/setup/masters', admin, body);
      expect(r.statusCode).toBe(201);
      ids[key] = (r.json().masters as Array<{ id: string; name: string }>).find(
        (m) => m.name === body.name,
      )!.id;
    }
    // the same name twice is refused
    expect(
      (await post('/clinic/setup/masters', admin, { kind: 'disease', name: 'fever' })).statusCode,
    ).toBe(409);
    const med = await post('/clinic/setup/medicines', admin, {
      name: 'Paracetamol',
      form: 'Tablet',
      strength: '500 mg',
      unit: 'tablet',
      lowStockAt: 20,
    });
    expect(med.statusCode).toBe(201);
    ids.para = (med.json().medicines as Array<{ id: string; name: string }>).find(
      (m) => m.name === 'Paracetamol',
    )!.id;
    const setup = await get('/clinic/setup', admin);
    expect(setup.fields.length).toBeGreaterThan(15);
    expect(setup.templates.some((t: { code: string }) => t.code === 'clinic_sent_home')).toBe(true);
  });

  it('stock: batches are received, given earliest-expiry first, refused when short, and written off', async () => {
    // nothing on the shelf yet
    const none = await post('/clinic/visits', doctor, {
      audience: 'student',
      studentId,
      complaint: 'Fever',
      medicines: [{ medicineId: ids.para, qty: 1 }],
    });
    expect(none.json()).toMatchObject({ type: expect.stringContaining('clinic.no_stock') });
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    await post('/clinic/stock', doctor, {
      medicineId: ids.para,
      qty: 10,
      batchNo: 'LATE',
      expiryOn: day(300),
    });
    await post('/clinic/stock', doctor, {
      medicineId: ids.para,
      qty: 4,
      batchNo: 'SOON',
      expiryOn: day(20),
    });
    const old = await post('/clinic/stock', doctor, {
      medicineId: ids.para,
      qty: 5,
      batchNo: 'OLD',
      expiryOn: day(-3),
    });
    const med = (
      old.json().medicines as Array<{ id: string; stock: number; expired: number; low: boolean }>
    ).find((m) => m.id === ids.para)!;
    // the expired batch does not count as stock; 14 is under the low-stock mark of 20
    expect(med).toMatchObject({ stock: 14, expired: 5, low: true });
    const visit = await post('/clinic/visits', doctor, {
      audience: 'student',
      studentId,
      clinicId: ids.clinic,
      doctorId: ids.doctor,
      nurseId: ids.nurse,
      complaint: 'Fever and headache',
      diseaseIds: [ids.fever, ids.headache],
      temperatureC: 38.4,
      pulse: 96,
      bp: '110/70',
      treatment: 'Rest and fluids',
      medicines: [{ medicineId: ids.para, qty: 6, dosage: '1 tablet after food' }],
      outcome: 'rest',
    });
    expect(visit.statusCode).toBe(201);
    ids.visit = visit.json().id;
    expect(visit.json()).toMatchObject({
      audience: 'student',
      admissionNo: `${s}-1`,
      diseases: ['Fever', 'Headache'],
      outcome: 'rest',
      doctor: 'Dr. Asha Rao',
    });
    expect(visit.json().number).toMatch(/^CV-\d{4}-\d{4,}$/);
    // a medicine was given: the father got the email
    expect(visit.json().notified).toBeGreaterThanOrEqual(1);
    const stock = await get('/clinic/stock');
    const left = Object.fromEntries(
      (stock.batches as Array<{ batchNo: string; qtyLeft: number }>).map((b) => [
        b.batchNo,
        b.qtyLeft,
      ]),
    );
    // 4 from the batch that expires first, 2 from the later one; the expired batch is untouched
    expect(left).toMatchObject({ LATE: 8, OLD: 5 });
    expect(left.SOON).toBeUndefined();
    const oldBatch = (stock.batches as Array<{ id: string; batchNo: string }>).find(
      (b) => b.batchNo === 'OLD',
    )!;
    const off = await post('/clinic/stock/write-off', doctor, {
      stockId: oldBatch.id,
      qty: 5,
      note: 'Expired',
    });
    expect(off.statusCode).toBe(200);
    expect((off.json().moves as Array<{ kind: string }>)[0]!.kind).toBe('written_off');
  });

  it('a first-aid visit tells nobody; sent home and referred tell the parents; staff visits are kept apart', async () => {
    const plain = await post('/clinic/visits', doctor, {
      audience: 'student',
      studentId,
      complaint: 'Scratch on the knee',
      treatment: 'Cleaned and dressed',
    });
    expect(plain.json()).toMatchObject({ notified: 0, outcome: 'back_to_class' });
    // referred needs the place
    expect(
      (
        await post('/clinic/visits', doctor, {
          audience: 'student',
          studentId,
          complaint: 'Fall',
          outcome: 'referred',
        })
      ).statusCode,
    ).toBe(400);
    const home = await post('/clinic/visits', doctor, {
      audience: 'student',
      studentId,
      complaint: 'Vomiting',
      outcome: 'sent_home',
    });
    expect(home.json().notified).toBeGreaterThanOrEqual(1);
    const staff = await post('/clinic/visits', doctor, {
      audience: 'staff',
      employeeId,
      complaint: 'Headache',
      diseaseIds: [ids.headache],
      medicines: [{ medicineId: ids.para, qty: 1 }],
    });
    expect(staff.json()).toMatchObject({ audience: 'staff', employee: 'Tara Clinic', notified: 0 });
    const out = await post(`/clinic/visits/${ids.visit}/out`, doctor);
    expect(out.json().outAt).toBeTruthy();
    const list = await get('/clinic/visits?tab=today');
    expect(list.page.total).toBe(4);
    expect(list.counts).toMatchObject({ today: 4, inClinic: 3 });
    expect((await get('/clinic/visits?tab=all&audience=staff')).page.total).toBe(1);
    expect((await get(`/clinic/visits?tab=all&diseaseId=${ids.headache}`)).page.total).toBe(2);
    const people = await get(`/clinic/people?audience=student&q=${s}-1`);
    expect(people.data[0]).toMatchObject({ id: studentId, visits90: 3 });
    const history = await get(`/clinic/history/student/${studentId}`);
    expect(history.visits).toHaveLength(3);
    const xl = await inject({
      method: 'GET',
      url: '/clinic/visits.xlsx?tab=all',
      headers: h(doctor),
    });
    expect(xl.statusCode).toBe(200);
  });

  it('a health check-up camp: the card is a draft until the doctor publishes the class', async () => {
    const camp = await post('/clinic/camps', doctor, {
      name: 'Annual check-up, first term',
      startsOn: new Date().toISOString().slice(0, 10),
      doctorId: ids.doctor,
      place: 'School clinic',
    });
    expect(camp.statusCode).toBe(201);
    const campId = camp.json().id;
    const sheet = await get(`/clinic/camps/${campId}/sections/${sectionId}`);
    expect(sheet.pupils).toHaveLength(1);
    expect(sheet.pupils[0].checkup).toBeNull();
    // a finding outside the form is refused
    expect(
      (
        await put(`/clinic/camps/${campId}/students/${studentId}`, doctor, {
          findings: { shoes: 'x' },
        })
      ).statusCode,
    ).toBe(400);
    const saved = await put(`/clinic/camps/${campId}/students/${studentId}`, doctor, {
      heightCm: 140,
      weightKg: 35,
      bloodGroup: 'B+',
      findings: {
        vision_right: '6/6',
        vision_left: '6/9',
        tooth_cavity: '2 cavities',
        skin: 'Normal',
      },
      remarks: 'Please see a dentist. Left eye to be checked.',
      needsAttention: true,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      status: 'draft',
      bmi: 17.9,
      bloodGroup: 'B+',
      needsAttention: true,
    });
    // the parents see no card yet
    expect((await get('/clinic/mine', parent)).data[0].cards).toHaveLength(0);
    const pub = await post(`/clinic/camps/${campId}/sections/${sectionId}/publish`, doctor);
    expect(pub.json()).toEqual({ published: 1 });
    const detail = await get(`/clinic/camps/${campId}`);
    expect(detail.sections[0]).toMatchObject({
      pupils: 1,
      examined: 1,
      published: 1,
      attention: 1,
    });
    // the family: the visits without the clinical notes, the card with its PDF
    const mine = await get('/clinic/mine', parent);
    expect(mine.data[0].visits).toHaveLength(3);
    expect(mine.data[0].visits[0].diagnosis).toBeUndefined();
    expect(mine.data[0].cards[0]).toMatchObject({ camp: 'Annual check-up, first term', bmi: 17.9 });
    const card = await get(`/clinic/mine/cards/${mine.data[0].cards[0].id}`, parent);
    expect(Buffer.from(card.base64, 'base64').subarray(0, 4).toString()).toBe('%PDF');
    // the doctor's own PDF and the camp sheet
    const pdf = await inject({
      method: 'GET',
      url: `/clinic/cards/${saved.json().id}/card.pdf`,
      headers: h(doctor),
    });
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const xl = await inject({
      method: 'GET',
      url: `/clinic/camps/${campId}/report.xlsx`,
      headers: h(doctor),
    });
    expect(xl.statusCode).toBe(200);
    // the older yearly record follows the published card
    const legacy = await withMigrator((c) =>
      c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM health_records WHERE student_id = $1`,
        [studentId],
      ),
    );
    expect(legacy.rows[0]!.n).toBe(1);
  });

  it('the dashboard counts visits, diseases, classes, medicines and check-up coverage', async () => {
    const d = await get('/clinic/dashboard');
    expect(d.today).toMatchObject({ visits: 4, sentHome: 1 });
    expect(d.months).toHaveLength(6);
    expect(d.months[5]).toMatchObject({ student: 3, staff: 1 });
    expect(d.days).toHaveLength(30);
    expect(d.diseases[0]).toMatchObject({ name: 'Headache', count: 2 });
    expect(d.classes[0]).toMatchObject({ name: 'VI-A', count: 3, people: 1 });
    expect(d.departments[0]).toMatchObject({ name: 'Science', count: 1 });
    expect(d.frequent[0]).toMatchObject({ name: 'Aanya Clinic', count: 3 });
    expect(d.lowStock[0]).toMatchObject({ name: 'Paracetamol', stock: 7 });
    expect(d.given[0]).toMatchObject({ qty: 7, visits: 2 });
    expect(d.camps[0]).toMatchObject({ examined: 1, published: 1, attention: 1 });
  });
});
