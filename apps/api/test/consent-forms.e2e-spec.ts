/**
 * Consent forms, part 1 (0166-0167, docs/design/28-consent-forms.md): the office builds a form with
 * rules, publishes it to a class and to staff; a parent answers for the child (with a drawn signature),
 * a staff member for themself and the office on behalf of a pupil; the server applies the rules and
 * the once-only rule; the register lists answered and pending, as Excel and PDF; a response has a
 * number and a PDF copy; a form with answers keeps its fields' keys and types.
 */
import { deflateSync } from 'node:zlib';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  createApp,
  headersFor,
  injector,
  seedSchool,
  seedUser,
  stamp,
  type SeededSchool,
  type SeededUser,
  withMigrator,
} from './helpers';

/** A small valid PNG (a grey box), as a canvas would send it. */
function pngDataUrl(): string {
  const w = 40;
  const h = 12;
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const cr = Buffer.alloc(4);
    cr.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cr]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h, 120);
  for (let y = 0; y < h; y += 1) raw[y * (w + 1)] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

describe('consent forms (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let parent: SeededUser;
  let teacher: SeededUser;
  const ids: Record<string, string> = {};
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const post = (url: string, json: unknown, u: SeededUser = admin) =>
    inject({ method: 'POST', url, headers: h(u), json });
  const put = (url: string, json: unknown, u: SeededUser = admin) =>
    inject({ method: 'PUT', url, headers: h(u), json });
  const get = (url: string, u: SeededUser = admin) => inject({ method: 'GET', url, headers: h(u) });

  const fields = [
    { key: 'intro', label: 'About the trip', type: 'heading' },
    {
      key: 'going',
      label: 'May your child go on the trip?',
      type: 'radio',
      required: true,
      options: ['Yes', 'No'],
    },
    {
      key: 'reason',
      label: 'Why not?',
      type: 'textarea',
      required: true,
      rule: {
        logic: 'all',
        action: 'show',
        conditions: [{ field: 'going', op: 'eq', value: 'No' }],
      },
    },
    {
      key: 'allergy',
      label: 'Any allergy?',
      type: 'yesno',
      required: true,
    },
    {
      key: 'allergy_note',
      label: 'Which allergy',
      type: 'text',
      rule: {
        logic: 'all',
        action: 'require',
        conditions: [{ field: 'allergy', op: 'eq', value: 'true' }],
      },
    },
    { key: 'seats', label: 'Seats', type: 'number', min: 1, max: 3 },
    { key: 'class_of', label: 'Class', type: 'select', source: 'classes' },
    { key: 'sign', label: 'Signature of the parent', type: 'signature', required: true },
    { key: 'agree', label: 'I agree to the trip rules', type: 'agree', required: true },
  ];

  beforeAll(async () => {
    const s = stamp('CF');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      teacher = await seedUser(c, school, `${s}-teacher`);
      const e = await c.query<{ id: string }>(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id, department) VALUES ($1, 'T1', 'Tara', 'Teacher', $2, 'Science') RETURNING id::text`,
        [school.id, teacher.id],
      );
      ids.emp = e.rows[0]!.id;
      const e2 = await c.query<{ id: string }>(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, department) VALUES ($1, 'T2', 'Om', 'Office', 'Admin') RETURNING id::text`,
        [school.id],
      );
      ids.emp2 = e2.rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
    const cls = await post('/academics/classes', { code: 'VI', name: 'Class VI', displayOrder: 6 });
    ids.cls = cls.json().id;
    ids.secA = (await post(`/academics/classes/${ids.cls}/sections`, { name: 'A' })).json().id;
    ids.secB = (await post(`/academics/classes/${ids.cls}/sections`, { name: 'B' })).json().id;
    for (const [key, sec, n] of [
      ['ana', ids.secA, 1],
      ['bo', ids.secA, 2],
      ['cy', ids.secB, 3],
    ] as const) {
      const st = await post('/people/students', {
        admissionNo: `${s}-${n}`,
        firstName: key,
        lastName: 'Pupil',
        guardians: [
          {
            guardian: { firstName: 'G', lastName: key, mobile: `98765123${n}0` },
            relation: 'mother',
            isPrimary: true,
          },
        ],
        enrolment: { classSectionId: sec, rollNo: n },
      });
      expect(st.statusCode).toBe(201);
      ids[key] = st.json().id;
    }
    await withMigrator((c) =>
      c.query(
        `UPDATE guardians SET user_id = $1 WHERE id = (SELECT guardian_id FROM student_guardians WHERE student_id = $2 LIMIT 1)`,
        [parent.id, ids.ana],
      ),
    );
  });
  afterAll(async () => app.close());

  it('builds a draft: keys unique, rules on other fields, choices need options', async () => {
    const dupKey = await post('/engagement/consent-forms', {
      title: 'Trip',
      fields: [
        { key: 'a', label: 'A', type: 'text' },
        { key: 'a', label: 'B', type: 'text' },
      ],
    });
    expect(dupKey.statusCode).toBe(400);
    const badRule = await post('/engagement/consent-forms', {
      title: 'Trip',
      fields: [
        {
          key: 'a',
          label: 'A',
          type: 'text',
          rule: { action: 'show', conditions: [{ field: 'zz', op: 'eq', value: 'x' }] },
        },
      ],
    });
    expect(badRule.json().type).toContain('consent.rule_field');
    const noOptions = await post('/engagement/consent-forms', {
      title: 'Trip',
      fields: [{ key: 'a', label: 'A', type: 'radio' }],
    });
    expect(noOptions.statusCode).toBe(400);
    const f = await post('/engagement/consent-forms', {
      title: 'Science City trip',
      description: 'A day trip on 20 November.',
      respondents: 'both',
      fields,
      audience: {
        pupils: 'filter',
        sectionIds: [ids.secA],
        staff: 'filter',
        departments: ['Science'],
      },
      settings: { repeat: 'once', success: 'Thank you.' },
    });
    expect(f.statusCode).toBe(201);
    ids.form = f.json().id;
    expect(f.json()).toMatchObject({ code: 'science_city_trip', status: 'draft', open: false });
    const lists = await get('/engagement/consent-forms/lists');
    expect(lists.json().sections.map((x: { id: string }) => x.id)).toContain(ids.secA);
  });

  it('a draft is not shown to families; publishing tells the audience; section A and the Science staff are asked', async () => {
    expect((await get('/engagement/mine/consent-forms', parent)).json().forms).toHaveLength(0);
    const p = await put(`/engagement/consent-forms/${ids.form}/status`, { status: 'published' });
    expect(p.statusCode).toBe(200);
    expect(p.json()).toMatchObject({ status: 'published', open: true });
    const one = await get(`/engagement/consent-forms/${ids.form}`);
    expect(one.json()).toMatchObject({ asked: 3, answered: 0 }); // ana, bo and the Science teacher
    const mine = (await get('/engagement/mine/consent-forms', parent)).json();
    expect(mine.forms).toHaveLength(1);
    expect(mine.forms[0].people).toEqual([
      expect.objectContaining({ kind: 'student', id: ids.ana, canAnswer: true }),
    ]);
    const staff = (await get('/engagement/mine/consent-forms', teacher)).json();
    expect(staff.forms[0].people).toEqual([
      expect.objectContaining({ kind: 'staff', id: ids.emp, canAnswer: true }),
    ]);
    const toFill = await get(
      `/engagement/mine/consent-forms/${ids.form}?studentId=${ids.ana}`,
      parent,
    );
    expect(toFill.statusCode).toBe(200);
    expect(toFill.json().lists.classes).toContain('Class VI');
  });

  it('the server applies the rules: a shown field is required, a rule-required one too, a hidden one is dropped', async () => {
    const url = `/engagement/mine/consent-forms/${ids.form}/responses`;
    const base = { going: 'No', allergy: false, sign: pngDataUrl(), agree: true };
    const noReason = await post(url, { studentId: ids.ana, answers: base }, parent);
    expect(noReason.statusCode).toBe(400);
    expect(noReason.json().detail).toContain('Why not?');
    const needNote = await post(
      url,
      { studentId: ids.ana, answers: { ...base, going: 'Yes', allergy: true } },
      parent,
    );
    expect(needNote.json().detail).toContain('Which allergy');
    const outOfRange = await post(
      url,
      { studentId: ids.ana, answers: { ...base, going: 'Yes', seats: 9 } },
      parent,
    );
    expect(outOfRange.json().detail).toContain('at most 3');
    const noSign = await post(
      url,
      { studentId: ids.ana, answers: { ...base, going: 'Yes', sign: 'scribble' } },
      parent,
    );
    expect(noSign.json().detail).toContain('please sign');
    const notMine = await post(
      url,
      { studentId: ids.cy, answers: { ...base, going: 'Yes' } },
      parent,
    );
    expect(notMine.statusCode).toBe(404);
    const ok = await post(
      url,
      {
        studentId: ids.ana,
        answers: {
          ...base,
          going: 'Yes',
          reason: 'hidden, dropped',
          seats: 2,
          class_of: 'Class VI',
        },
        signedName: 'G ana',
      },
      parent,
    );
    expect(ok.statusCode).toBe(201);
    expect(ok.json().number).toMatch(/^CF\/.+\/000001$/);
    expect(ok.json().success).toBe('Thank you.');
    ids.resp = ok.json().id;
    const again = await post(
      url,
      { studentId: ids.ana, answers: { ...base, going: 'Yes' } },
      parent,
    );
    expect(again.json().type).toContain('consent.already');
    const row = (await get(`/engagement/consent-forms/${ids.form}/responses/${ids.resp}`)).json();
    expect(row.answers).toEqual({
      going: 'Yes',
      allergy: false,
      seats: 2,
      class_of: 'Class VI',
      sign: true,
      agree: true,
    });
    expect(row.signed).toEqual(['sign']);
    const pdf = await get(`/engagement/mine/consent-forms/responses/${ids.resp}/pdf`, parent);
    expect(pdf.statusCode).toBe(200);
    expect(Buffer.from(pdf.json().base64, 'base64').subarray(0, 4).toString()).toBe('%PDF');
  });

  it('a staff member answers for themself; the office fills for a pupil; a pupil not asked is refused', async () => {
    const answers = { going: 'Yes', allergy: false, sign: pngDataUrl(), agree: true };
    const staff = await post(
      `/engagement/mine/consent-forms/${ids.form}/responses`,
      { answers },
      teacher,
    );
    expect(staff.statusCode).toBe(201);
    const notAsked = await post(`/engagement/consent-forms/${ids.form}/responses`, {
      studentId: ids.cy,
      answers,
    });
    expect(notAsked.json().type).toContain('consent.not_asked');
    const office = await post(`/engagement/consent-forms/${ids.form}/responses`, {
      studentId: ids.bo,
      answers,
      signedName: 'Paper form',
    });
    expect(office.statusCode).toBe(201);
  });

  it('the register: answered and pending, by section, as Excel and PDF; the response PDF for the office', async () => {
    const answered = (
      await get(`/engagement/consent-forms/${ids.form}/register?tab=answered`)
    ).json();
    expect(answered.total).toBe(3);
    expect(answered.data.map((x: { respondent: string }) => x.respondent).sort()).toEqual([
      'family',
      'office',
      'staff',
    ]);
    const pending = (
      await get(`/engagement/consent-forms/${ids.form}/register?tab=pending`)
    ).json();
    expect(pending.total).toBe(0);
    const bySection = (
      await get(`/engagement/consent-forms/${ids.form}/register?tab=answered&sectionId=${ids.secA}`)
    ).json();
    expect(bySection.total).toBe(2);
    for (const format of ['xlsx', 'pdf']) {
      const f = await get(`/engagement/consent-forms/${ids.form}/register/file?format=${format}`);
      expect(f.statusCode).toBe(200);
      expect(f.json().filename).toContain('science_city_trip');
    }
    const pdf = await get(`/engagement/consent-forms/${ids.form}/responses/${ids.resp}/pdf`);
    expect(pdf.json().filename).toMatch(/^CF-/);
    const list = (await get('/engagement/consent-forms')).json().data;
    expect(list[0]).toMatchObject({ id: ids.form, asked: 3, answered: 3 });
  });

  it('a form with answers keeps its fields: none removed, no type changed; adding one is fine', async () => {
    const one = (await get(`/engagement/consent-forms/${ids.form}`)).json();
    const body = {
      title: one.title,
      respondents: 'both',
      audience: one.audience,
      settings: one.settings,
    };
    const removed = await put(`/engagement/consent-forms/${ids.form}`, {
      ...body,
      fields: fields.filter((f) => f.key !== 'seats'),
    });
    expect(removed.json().type).toContain('consent.field_removed');
    const retyped = await put(`/engagement/consent-forms/${ids.form}`, {
      ...body,
      fields: fields.map((f) => (f.key === 'seats' ? { ...f, type: 'text' } : f)),
    });
    expect(retyped.json().type).toContain('consent.field_type');
    const added = await put(`/engagement/consent-forms/${ids.form}`, {
      ...body,
      fields: [...fields, { key: 'bus', label: 'Bus stop', type: 'text' }],
    });
    expect(added.statusCode).toBe(200);
    expect(
      (await put(`/engagement/consent-forms/${ids.form}/status`, { status: 'draft' })).json().type,
    ).toContain('consent.has_answers');
    const closed = await put(`/engagement/consent-forms/${ids.form}/status`, { status: 'closed' });
    expect(closed.json()).toMatchObject({ status: 'closed', open: false });
    const late = await post(
      `/engagement/mine/consent-forms/${ids.form}/responses`,
      { studentId: ids.ana, answers: {} },
      parent,
    );
    expect(late.json().type).toContain('consent.not_open');
  });

  it('several responses and a cap: the form closes when the cap is reached; a copy is a new draft', async () => {
    const f = await post('/engagement/consent-forms', {
      title: 'Annual day guest passes',
      respondents: 'family',
      fields: [{ key: 'guest', label: 'Guest name', type: 'text', required: true }],
      audience: { pupils: 'pupils', studentIds: [ids.ana] },
      settings: { repeat: 'many', cap: 2 },
    });
    const id = f.json().id;
    await put(`/engagement/consent-forms/${id}/status`, { status: 'published', push: false });
    const url = `/engagement/mine/consent-forms/${id}/responses`;
    expect(
      (await post(url, { studentId: ids.ana, answers: { guest: 'Uncle' } }, parent)).statusCode,
    ).toBe(201);
    expect(
      (await post(url, { studentId: ids.ana, answers: { guest: 'Aunt' } }, parent)).statusCode,
    ).toBe(201);
    const third = await post(url, { studentId: ids.ana, answers: { guest: 'Cousin' } }, parent);
    expect(third.json().type).toContain('consent.not_open');
    expect((await get(`/engagement/consent-forms/${id}`)).json().status).toBe('closed');
    const copy = await post(`/engagement/consent-forms/${id}/copy`, {});
    expect(copy.json()).toMatchObject({
      status: 'draft',
      responses: 0,
      title: 'Annual day guest passes (copy)',
    });
    expect(
      (
        await inject({
          method: 'DELETE',
          url: `/engagement/consent-forms/${copy.json().id}`,
          headers: h(),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await inject({ method: 'DELETE', url: `/engagement/consent-forms/${id}`, headers: h() })
      ).json().type,
    ).toContain('consent.not_draft');
  });

  // ---- part 2: fee, approval, edit ----------------------------------------------------------------
  const later = new Date(Date.now() + 5 * 86400000 + 330 * 60000).toISOString().slice(0, 16);
  const line = async (rid: string | undefined) =>
    (
      await withMigrator((c) =>
        c.query<{ amount: string; paid: string; status: string }>(
          `SELECT l.amount::text, l.paid::text, l.status FROM consent_form_responses x JOIN misc_fee_students l ON l.id = x.misc_line_id WHERE x.id = $1`,
          [rid],
        ),
      )
    ).rows[0] ?? null;

  it('a calculated fee is raised as a misc fee at once without approval; an edit until the date re-prices it, not once paid', async () => {
    const f = await post('/engagement/consent-forms', {
      title: 'Olympiad registration',
      respondents: 'family',
      fields: [
        { key: 'seats', label: 'Subjects', type: 'number', required: true, min: 1, max: 3 },
        { key: 'meal', label: 'Meal', type: 'radio', options: ['Veg', 'None'], required: true },
        { key: 'sign', label: 'Signature', type: 'signature', required: true },
      ],
      audience: { pupils: 'filter', sectionIds: [ids.secA] },
      settings: {
        editUntil: later,
        fee: {
          mode: 'calc',
          base: 100,
          items: [
            { field: 'seats', rate: 50 },
            { field: 'meal', prices: { Veg: 30 } },
          ],
        },
      },
    });
    expect(f.statusCode).toBe(201);
    ids.olympiad = f.json().id;
    await put(`/engagement/consent-forms/${ids.olympiad}/status`, {
      status: 'published',
      push: false,
    });
    const a = await post(
      `/engagement/mine/consent-forms/${ids.olympiad}/responses`,
      { studentId: ids.ana, answers: { seats: 2, meal: 'Veg', sign: pngDataUrl() } },
      parent,
    );
    expect(a.json()).toMatchObject({ fee: 230, waiting: false });
    ids.oly = a.json().id;
    expect(await line(ids.oly)).toMatchObject({ amount: '230.00', paid: '0.00', status: 'open' });
    // the parent sees the fee and may change the answer (keeping the signature)
    const mine = (await get('/engagement/mine/consent-forms', parent)).json();
    const resp = mine.forms.find((x: { id: string }) => x.id === ids.olympiad).people[0]
      .responses[0];
    expect(resp).toMatchObject({ fee: '230.00', canEdit: true });
    const toEdit = await get(
      `/engagement/mine/consent-forms/${ids.olympiad}?studentId=${ids.ana}&responseId=${ids.oly}`,
      parent,
    );
    expect(toEdit.json()).toMatchObject({ canEdit: true, editing: { signed: ['sign'] } });
    const e1 = await put(
      `/engagement/mine/consent-forms/responses/${ids.oly}`,
      { answers: { seats: 1, meal: 'Veg', sign: 'keep' } },
      parent,
    );
    expect(e1.json()).toMatchObject({ fee: 180 });
    expect(await line(ids.oly)).toMatchObject({ amount: '180.00' });
    const r = (await get(`/engagement/consent-forms/${ids.olympiad}/responses/${ids.oly}`)).json();
    expect(r).toMatchObject({ edits: 1, signed: ['sign'], answers: { seats: 1 } });
    expect(r.versions).toHaveLength(1);
    expect(r.versions[0].answers.seats).toBe(2);
    // paid at the counter: a change of amount is refused, the same amount is fine
    await withMigrator((c) =>
      c.query(
        `UPDATE misc_fee_students SET paid = 180, status = 'paid' WHERE id = (SELECT misc_line_id FROM consent_form_responses WHERE id = $1)`,
        [ids.oly],
      ),
    );
    const e2 = await put(
      `/engagement/mine/consent-forms/responses/${ids.oly}`,
      { answers: { seats: 3, meal: 'Veg', sign: 'keep' } },
      parent,
    );
    expect(e2.json().type).toContain('consent.fee_paid');
    const e3 = await put(
      `/engagement/mine/consent-forms/responses/${ids.oly}`,
      { answers: { seats: 1, meal: 'Veg', sign: pngDataUrl() } },
      parent,
    );
    expect(e3.statusCode).toBe(200);
  });

  it('approval by the class teacher then the school admin: the fee only after approval; a rejected answer raises none; decided answers cannot change', async () => {
    const ta = await post('/academics/teacher-assignments', {
      employeeId: ids.emp,
      classSectionId: ids.secA,
      kind: 'class_teacher',
    });
    expect(ta.statusCode).toBe(201);
    const f = await post('/engagement/consent-forms', {
      title: 'Overnight camp',
      respondents: 'both',
      fields: [{ key: 'ok', label: 'I allow the camp', type: 'agree', required: true }],
      audience: {
        pupils: 'filter',
        sectionIds: [ids.secA],
        staff: 'filter',
        departments: ['Science'],
      },
      settings: {
        editUntil: later,
        fee: { mode: 'fixed', amount: 1500 },
        approval: {
          on: true,
          levels: [
            { name: 'Class teacher', resolver: { kind: 'class_teacher' } },
            { name: 'Principal', resolver: { kind: 'role', roleCode: 'school_admin' } },
          ],
        },
      },
    });
    ids.camp = f.json().id;
    await put(`/engagement/consent-forms/${ids.camp}/status`, { status: 'published', push: false });
    const a = await post(
      `/engagement/mine/consent-forms/${ids.camp}/responses`,
      { studentId: ids.ana, answers: { ok: true } },
      parent,
    );
    expect(a.json()).toMatchObject({ fee: 1500, waiting: true });
    expect(await line(a.json().id)).toBeNull();
    // the class teacher sees it in the staff app and approves; then the school admin
    const mineT = (await get('/engagement/mine/consent-approvals', teacher)).json().data;
    expect(mineT).toHaveLength(1);
    expect(mineT[0]).toMatchObject({
      form: 'Overnight camp',
      level: 'Class teacher',
      fee: '1500.00',
    });
    expect(
      (
        await post(
          `/engagement/mine/consent-approvals/${mineT[0].stepId}`,
          { decision: 'approved' },
          teacher,
        )
      ).statusCode,
    ).toBe(201);
    const reg = (await get(`/engagement/consent-forms/${ids.camp}/register?status=waiting`)).json();
    expect(reg.data[0].waitingWith).toContain('Principal');
    const mineA = (await get('/engagement/mine/consent-approvals')).json().data;
    await post(`/engagement/mine/consent-approvals/${mineA[0].stepId}`, {
      decision: 'approved',
      note: 'See you at 7 am',
    });
    const done = (
      await get(`/engagement/consent-forms/${ids.camp}/responses/${a.json().id}`)
    ).json();
    expect(done).toMatchObject({ status: 'approved', decidedNote: 'See you at 7 am' });
    expect(await line(a.json().id)).toMatchObject({ amount: '1500.00', status: 'open' });
    const late = await put(
      `/engagement/mine/consent-forms/responses/${a.json().id}`,
      { answers: { ok: true } },
      parent,
    );
    expect(late.json().type).toContain('consent.decided');
    // the office fills for bo; the class teacher rejects: no fee
    const b = await post(`/engagement/consent-forms/${ids.camp}/responses`, {
      studentId: ids.bo,
      answers: { ok: true },
    });
    const stepB = (await get('/engagement/mine/consent-approvals', teacher)).json().data[0];
    await post(
      `/engagement/mine/consent-approvals/${stepB.stepId}`,
      { decision: 'rejected', note: 'Medical' },
      teacher,
    );
    expect(
      (await get(`/engagement/consent-forms/${ids.camp}/responses/${b.json().id}`)).json(),
    ).toMatchObject({
      status: 'rejected',
      decidedNote: 'Medical',
    });
    expect(await line(b.json().id)).toBeNull();
    // staff answers skip the class-teacher level: the principal approves the teacher's own answer
    const s = await post(
      `/engagement/mine/consent-forms/${ids.camp}/responses`,
      { answers: { ok: true } },
      teacher,
    );
    expect(s.json()).toMatchObject({ fee: 0, waiting: true });
    expect((await get('/engagement/mine/consent-approvals')).json().data[0]).toMatchObject({
      level: 'Principal',
    });
    // somebody else cannot decide a step that is not theirs
    expect(
      (
        await post(
          `/engagement/mine/consent-approvals/${stepB.stepId}`,
          { decision: 'approved' },
          parent,
        )
      ).statusCode,
    ).toBeGreaterThanOrEqual(400);
  });

  it('publish with a message channel: a template that cannot be used is reported, the form still publishes', async () => {
    const f = await post('/engagement/consent-forms', {
      title: 'Photo consent',
      fields: [{ key: 'ok', label: 'I agree', type: 'agree', required: true }],
      audience: { pupils: 'filter', sectionIds: [ids.secB] },
    });
    const p = await put(`/engagement/consent-forms/${f.json().id}/status`, {
      status: 'published',
      channels: [{ channel: 'sms', templateId: '999999999' }],
    });
    expect(p.statusCode).toBe(200);
    expect(p.json().status).toBe('published');
    expect(p.json().message.error).toBeTruthy();
    const n = await post(`/engagement/consent-forms/${f.json().id}/notify`, { channels: [] });
    expect(n.json()).toMatchObject({ message: null });
  });
});
