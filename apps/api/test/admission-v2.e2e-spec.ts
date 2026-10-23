/**
 * Online admission (docs/design/39): part 1 — the form builder (ready forms, checks, mapping to the
 * student master, additional student fields). Later parts add their cases here.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
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

describe('online admission (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let clerk: SeededUser;
  let formIx: string;
  let formXi: string;
  let cycleId: string;
  let classIx: string;
  let classXi: string;
  let categories: Array<{ id: string; code: string; isDefault: boolean }> = [];
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);

  beforeAll(async () => {
    process.env.PUBLIC_POW_DIFFICULTY = '1';
    process.env.PAYU_MODE = 'mock';
    const redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      lazyConnect: true,
    });
    await redis.connect();
    const keys = await redis.keys('edupro:throttle:*');
    if (keys.length) await redis.del(...keys);
    await redis.quit();
    const s = stamp('AV');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      clerk = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
    });
    app = await createApp();
    inject = injector(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('part 1: form builder', () => {
    it('makes forms from the ready forms; their "copy" answers become additional student fields', async () => {
      const ix = await inject({
        method: 'POST',
        url: '/admissions/forms',
        headers: h(),
        json: { name: 'Registration IX', template: 'general' },
      });
      expect(ix.statusCode).toBe(201);
      formIx = ix.json().id;
      expect(ix.json().def.steps).toHaveLength(8);
      const xi = await inject({
        method: 'POST',
        url: '/admissions/forms',
        headers: h(),
        json: { name: 'Registration XI', template: 'class_xi' },
      });
      expect(xi.statusCode).toBe(201);
      formXi = xi.json().id;
      const meta = await inject({ method: 'GET', url: '/admissions/forms/meta', headers: h() });
      expect(meta.statusCode).toBe(200);
      const extra = (meta.json().extraFields as Array<{ key: string }>).map((x) => x.key);
      expect(extra).toEqual(
        expect.arrayContaining(['second_language', 'mother_maiden_name', 'subjects', 'medium']),
      );
      expect(meta.json().options.Language).toContain('Sanskrit');
      expect(meta.json().templates).toHaveLength(2);
      const dup = await inject({
        method: 'POST',
        url: '/admissions/forms',
        headers: h(),
        json: { name: 'registration ix', template: 'general' },
      });
      expect(dup.statusCode).toBe(409);
    });

    it('refuses a form whose mapping does not match the student master or whose rules point nowhere', async () => {
      const form = (
        await inject({ method: 'GET', url: `/admissions/forms/${formIx}`, headers: h() })
      ).json();
      const badList = structuredClone(form.def);
      badList.fields.find((f: { key: string }) => f.key === 'gender').list = 'YesNo';
      const r1 = await inject({
        method: 'PUT',
        url: `/admissions/forms/${formIx}`,
        headers: h(),
        json: { name: form.name, def: badList },
      });
      expect(r1.statusCode).toBe(400);
      expect(r1.json().detail).toMatch(/use the Gender list/);
      const badRule = structuredClone(form.def);
      badRule.fields[0].rules = [
        { logic: 'all', action: 'show', conditions: [{ field: 'nowhere', op: 'eq', value: 'x' }] },
      ];
      const r2 = await inject({
        method: 'PUT',
        url: `/admissions/forms/${formIx}`,
        headers: h(),
        json: { name: form.name, def: badRule },
      });
      expect(r2.statusCode).toBe(400);
      expect(r2.json().detail).toMatch(/does not exist/);
      const auto = structuredClone(form.def);
      auto.fields.push({ key: 'my_age', label: 'Age', type: 'text', step: 'student', maps: 'age' });
      const r3 = await inject({
        method: 'PUT',
        url: `/admissions/forms/${formIx}`,
        headers: h(),
        json: { name: form.name, def: auto },
      });
      expect(r3.statusCode).toBe(400);
    });

    it('edits, copies and archives a form; only managers may change it', async () => {
      const form = (
        await inject({ method: 'GET', url: `/admissions/forms/${formXi}`, headers: h() })
      ).json();
      const def = structuredClone(form.def);
      def.settings.dobFrom = '2009-04-01';
      def.settings.dobTo = '2012-03-31';
      def.fields.push({ key: 'hobby', label: 'Hobby', type: 'text', step: 'other', copy: true });
      const ok = await inject({
        method: 'PUT',
        url: `/admissions/forms/${formXi}`,
        headers: h(),
        json: { name: 'Registration XI', description: 'Written test', def },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().def.settings.dobTo).toBe('2012-03-31');
      const denied = await inject({
        method: 'PUT',
        url: `/admissions/forms/${formXi}`,
        headers: h(clerk),
        json: { name: 'x', def },
      });
      expect(denied.statusCode).toBe(403);
      const seen = await inject({
        method: 'GET',
        url: `/admissions/forms/${formXi}`,
        headers: h(clerk),
      });
      expect(seen.statusCode).toBe(200);
      const copy = await inject({
        method: 'POST',
        url: `/admissions/forms/${formXi}/copy`,
        headers: h(),
        json: { name: 'Registration XI (copy)' },
      });
      expect(copy.statusCode).toBe(201);
      const arch = await inject({
        method: 'POST',
        url: `/admissions/forms/${copy.json().id}/archive`,
        headers: h(),
      });
      expect(arch.json().status).toBe('archived');
      const list = await inject({ method: 'GET', url: '/admissions/forms', headers: h() });
      expect(list.json().data.map((f: { name: string }) => f.name)).toEqual(
        expect.arrayContaining(['Registration IX', 'Registration XI', 'Registration XI (copy)']),
      );
    });
  });
  describe('part 2: session, classes and fees', () => {
    beforeAll(async () => {
      const ix = await inject({
        method: 'POST',
        url: '/academics/classes',
        headers: h(),
        json: { code: 'IX', name: 'Class IX' },
      });
      classIx = ix.json().id;
      const xi = await inject({
        method: 'POST',
        url: '/academics/classes',
        headers: h(),
        json: { code: 'XI', name: 'Class XI' },
      });
      classXi = xi.json().id;
      const cyc = await inject({
        method: 'POST',
        url: '/admissions/cycles',
        headers: h(),
        json: {
          academicYearId: school.yearId,
          code: 'ADM-T',
          name: 'Admissions test',
          opensAt: new Date(Date.now() - 86400000).toISOString(),
          closesAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        },
      });
      expect(cyc.statusCode).toBe(201);
      cycleId = cyc.json().id;
    });

    it('starts the school with fee categories and settings; only set-up managers change them', async () => {
      const setup = await inject({ method: 'GET', url: '/admissions/setup', headers: h() });
      expect(setup.statusCode).toBe(200);
      categories = setup.json().categories;
      expect(categories.map((c) => c.code)).toEqual([
        'ews',
        'staff_ward',
        'sibling',
        'alumni',
        'general',
      ]);
      expect(categories.find((c) => c.isDefault)?.code).toBe('general');
      expect(setup.json().settings).toMatchObject({
        regReceiptPrefix: 'RF',
        admReceiptPrefix: 'AF',
      });
      const same = await inject({
        method: 'PUT',
        url: '/admissions/setup/settings',
        headers: h(),
        json: { signinChannels: ['email'], regReceiptPrefix: 'RF', admReceiptPrefix: 'RF' },
      });
      expect(same.statusCode).toBe(400);
      const ok = await inject({
        method: 'PUT',
        url: '/admissions/setup/settings',
        headers: h(),
        json: {
          signinChannels: ['email', 'sms'],
          regReceiptPrefix: 'REG',
          admReceiptPrefix: 'ADM',
        },
      });
      expect(ok.json()).toMatchObject({
        signinChannels: ['email', 'sms'],
        regReceiptPrefix: 'REG',
      });
      const denied = await inject({
        method: 'PUT',
        url: '/admissions/setup/settings',
        headers: h(clerk),
        json: { signinChannels: ['email'], regReceiptPrefix: 'RF', admReceiptPrefix: 'AF' },
      });
      expect(denied.statusCode).toBe(403);
      const twoDefaults = await inject({
        method: 'PUT',
        url: '/admissions/setup/categories',
        headers: h(),
        json: {
          categories: setup
            .json()
            .categories.map((c: Record<string, unknown>) => ({ ...c, isDefault: true })),
        },
      });
      expect(twoDefaults.statusCode).toBe(400);
    });

    it('gives classes their form, seats and window, and a fee per category', async () => {
      const r = await inject({
        method: 'PUT',
        url: `/admissions/cycles/${cycleId}/classes`,
        headers: h(),
        json: {
          classes: [
            { classId: classIx, formId: formIx, seats: 20, ageAsOn: '2027-03-31', status: 'open' },
            {
              classId: classXi,
              formId: formXi,
              seats: 30,
              dobFrom: '2009-04-01',
              dobTo: '2012-03-31',
              status: 'open',
            },
          ],
        },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json().classes.map((c: { formId: string }) => c.formId)).toEqual([formIx, formXi]);
      expect(r.json().session.url).toMatch(/\/admission\?session=ADM-T$/);
      const bad = await inject({
        method: 'PUT',
        url: `/admissions/cycles/${cycleId}/classes`,
        headers: h(),
        json: {
          classes: [
            {
              classId: classIx,
              formId: formIx,
              seats: 1,
              dobFrom: '2012-01-01',
              dobTo: '2010-01-01',
            },
          ],
        },
      });
      expect(bad.statusCode).toBe(400);
      const general = categories.find((c) => c.isDefault)!.id;
      const ews = categories.find((c) => c.code === 'ews')!.id;
      const fees = await inject({
        method: 'PUT',
        url: `/admissions/cycles/${cycleId}/fees`,
        headers: h(),
        json: {
          fees: [
            { classId: classIx, categoryId: general, registrationFee: 1000, admissionFee: 25000 },
            { classId: classIx, categoryId: ews, registrationFee: 0, admissionFee: 0 },
            { classId: classXi, categoryId: general, registrationFee: 1500, admissionFee: 30000 },
          ],
        },
      });
      expect(fees.statusCode).toBe(200);
      expect(fees.json().fees).toHaveLength(3);
      const notInSession = await inject({
        method: 'PUT',
        url: `/admissions/cycles/${cycleId}/fees`,
        headers: h(),
        json: {
          fees: [{ classId: '999999', categoryId: general, registrationFee: 1, admissionFee: 1 }],
        },
      });
      expect(notInSession.statusCode).toBe(400);
      // the fee heads of the admission ledger exist now
      const heads = await withMigrator((c) =>
        c.query<{ code: string; ledger: string }>(
          `SELECT code, ledger::text FROM fee_heads WHERE school_id = $1 AND code IN ('ADMREG', 'ADMFEE') ORDER BY code`,
          [school.id],
        ),
      );
      expect(heads.rows).toEqual([
        { code: 'ADMFEE', ledger: 'admission' },
        { code: 'ADMREG', ledger: 'admission' },
      ]);
    });

    it('serves the public link QR and the A4 poster', async () => {
      const qr = await inject({
        method: 'GET',
        url: `/admissions/cycles/${cycleId}/qr`,
        headers: h(),
      });
      expect(qr.json()).toMatchObject({ contentType: 'image/png' });
      const poster = await inject({
        method: 'GET',
        url: `/admissions/cycles/${cycleId}/poster`,
        headers: h(),
      });
      expect(poster.json().contentType).toBe('application/pdf');
      expect(Buffer.from(poster.json().base64, 'base64').subarray(0, 4).toString()).toBe('%PDF');
    });
  });
  let classMini: string;
  let tokenA: string;
  let tokenB: string;
  let appA: string;
  let appEws: string;
  let appWalkIn: string;
  const pub = (token?: string): Record<string, string> =>
    token ? { authorization: `Bearer ${token}` } : {};
  describe('part 3: candidate portal and office desk', () => {
    const mobileA = `9${String(Date.now()).slice(-9)}`;
    const emailB = `fam.${Date.now()}@example.com`;
    const answers = (extra: Record<string, unknown> = {}) => ({
      first_name: 'Asha',
      last_name: 'Verma',
      dob: '2012-05-01',
      gender: 'Female',
      sms_mobile: mobileA,
      primary_email: 'asha.parent@example.com',
      aadhaar_no: '1234 5678 9012',
      ews: 'No',
      ...extra,
    });
    const signIn = async (identifier: string) => {
      const ch = await inject({ method: 'POST', url: '/public/admissions/challenge', headers: {} });
      const nonce = PowService.solve(ch.json().challenge, ch.json().difficulty);
      const code = await inject({
        method: 'POST',
        url: '/public/admission/code',
        headers: {},
        json: { schoolCode: school.code, identifier, challenge: ch.json().challenge, nonce },
      });
      expect(code.statusCode).toBe(201);
      const ok = await inject({
        method: 'POST',
        url: '/public/admission/code/verify',
        headers: {},
        json: { schoolCode: school.code, identifier, code: code.json().devCode },
      });
      expect(ok.statusCode).toBe(201);
      expect(ok.json().token).toMatch(/^adm\./);
      return ok.json().token as string;
    };

    beforeAll(async () => {
      // a one-tab form made from the ready form's student tab
      const general = await inject({
        method: 'GET',
        url: `/admissions/forms/${formIx}`,
        headers: h(),
      });
      const def = general.json().def;
      const keep = [
        'first_name',
        'last_name',
        'dob',
        'gender',
        'sms_mobile',
        'primary_email',
        'aadhaar_no',
        'ews',
      ];
      const mini = await inject({
        method: 'POST',
        url: '/admissions/forms',
        headers: h(),
        json: {
          name: 'Mini registration',
          def: {
            steps: [def.steps[0]],
            fields: def.fields.filter((f: { key: string }) => keep.includes(f.key)),
            settings: def.settings,
          },
        },
      });
      expect(mini.statusCode).toBe(201);
      const cls = await inject({
        method: 'POST',
        url: '/academics/classes',
        headers: h(),
        json: { code: 'MINI', name: 'Class Mini' },
      });
      classMini = cls.json().id;
      const r = await inject({
        method: 'PUT',
        url: `/admissions/cycles/${cycleId}/classes`,
        headers: h(),
        json: {
          classes: [
            { classId: classIx, formId: formIx, seats: 20, ageAsOn: '2027-03-31', status: 'open' },
            {
              classId: classXi,
              formId: formXi,
              seats: 30,
              dobFrom: '2009-04-01',
              dobTo: '2012-03-31',
              status: 'open',
            },
            { classId: classMini, formId: mini.json().id, seats: 10, status: 'open' },
          ],
        },
      });
      expect(r.statusCode).toBe(200);
      const general_ = categories.find((c) => c.isDefault)!.id;
      const ews = categories.find((c) => c.code === 'ews')!.id;
      const fees = await inject({
        method: 'PUT',
        url: `/admissions/cycles/${cycleId}/fees`,
        headers: h(),
        json: {
          fees: [
            { classId: classIx, categoryId: general_, registrationFee: 1000, admissionFee: 25000 },
            { classId: classMini, categoryId: general_, registrationFee: 500, admissionFee: 20000 },
            { classId: classMini, categoryId: ews, registrationFee: 0, admissionFee: 0 },
          ],
        },
      });
      expect(fees.statusCode).toBe(200);
      await withMigrator((c) =>
        c.query(`UPDATE admission_cycles SET status = 'open' WHERE id = $1`, [cycleId]),
      );
    });

    it('shows the open session with each class and its fee to anyone', async () => {
      const r = await inject({
        method: 'GET',
        url: `/public/admission/schools/${school.code}`,
        headers: {},
      });
      expect(r.statusCode).toBe(200);
      const sess = r.json().sessions.find((x: { id: string }) => x.id === cycleId);
      const mini = sess.classes.find((k: { id: string }) => k.id === classMini);
      expect(mini).toMatchObject({ open: true, registrationFee: 500, feeFrom: 0 });
    });

    it("signs in by mobile and by email; a token never opens another family's registration", async () => {
      tokenA = await signIn(mobileA);
      tokenB = await signIn(emailB);
      const none = await inject({ method: 'GET', url: '/public/admission/me', headers: pub() });
      expect(none.statusCode).toBe(401);
      const start = await inject({
        method: 'POST',
        url: '/public/admission/me/applications',
        headers: pub(tokenA),
        json: { cycleId, classId: classMini },
      });
      expect(start.statusCode).toBe(201);
      appA = start.json().id;
      const other = await inject({
        method: 'GET',
        url: `/public/admission/me/applications/${appA}`,
        headers: pub(tokenB),
      });
      expect(other.statusCode).toBe(404);
      const me = await inject({ method: 'GET', url: '/public/admission/me', headers: pub(tokenA) });
      expect(me.json().applications.map((a: { id: string }) => a.id)).toContain(appA);
    });

    it("checks each tab on save with the school's messages, then submits with a fee due", async () => {
      const bad = await inject({
        method: 'PUT',
        url: `/public/admission/me/applications/${appA}/step`,
        headers: pub(tokenA),
        json: { step: 'student', answers: answers({ aadhaar_no: '123' }) },
      });
      expect(bad.statusCode).toBe(200);
      expect(bad.json().errors.aadhaar_no).toBe('Please enter 12 digit Aadhar number');
      const ok = await inject({
        method: 'PUT',
        url: `/public/admission/me/applications/${appA}/step`,
        headers: pub(tokenA),
        json: { step: 'student', answers: answers() },
      });
      expect(ok.json().errors).toEqual({});
      const view = await inject({
        method: 'GET',
        url: `/public/admission/me/applications/${appA}`,
        headers: pub(tokenA),
      });
      expect(view.json().answers.aadhaar_no).toBe('XXXX-XXXX-9012');
      expect(view.json().answers.first_name).toBe('ASHA');
      const stored = await withMigrator((c) =>
        c.query<{ v: string }>(`SELECT data->>'aadhaar_no' AS v FROM applications WHERE id = $1`, [
          appA,
        ]),
      );
      expect(stored.rows[0]!.v).toMatch(/^enc:/);
      // the masked value sent back as shown keeps the number
      const sub = await inject({
        method: 'POST',
        url: `/public/admission/me/applications/${appA}/submit`,
        headers: pub(tokenA),
        json: { answers: view.json().answers },
      });
      expect(sub.statusCode).toBe(201);
      expect(sub.json()).toMatchObject({ fee: 500, registered: false });
      expect(sub.json().application).toMatchObject({
        status: 'submitted',
        number: null,
        feeDue: 500,
        category: 'General',
      });
    });

    it('registers after the online payment, with an RF receipt and a registration number', async () => {
      const pay = await inject({
        method: 'POST',
        url: `/public/admission/me/applications/${appA}/pay?school=${school.code}`,
        headers: pub(tokenA),
        json: {},
      });
      expect(pay.statusCode).toBe(201);
      const form = pay.json().checkout as { action: string; fields: Record<string, string> };
      expect(form.fields.amount).toBe('500.00');
      const paid = await inject({
        method: 'POST',
        url: '/payments/payu/mock',
        headers: {},
        json: { txnid: form.fields.txnid, outcome: 'success' },
      });
      expect(paid.json()).toMatchObject({ outcome: 'applied', status: 'succeeded' });
      const view = await inject({
        method: 'GET',
        url: `/public/admission/me/applications/${appA}`,
        headers: pub(tokenA),
      });
      expect(view.json()).toMatchObject({ status: 'registered', feeDue: 0, hasPdf: true });
      expect(view.json().number).toBeTruthy();
      expect(view.json().receipts[0].receiptNo).toMatch(/^REG\//);
      const pdf = await inject({
        method: 'GET',
        url: `/public/admission/me/applications/${appA}/pdf`,
        headers: pub(tokenA),
      });
      expect(Buffer.from(pdf.json().base64, 'base64').subarray(0, 4).toString()).toBe('%PDF');
      const rec = await inject({
        method: 'GET',
        url: `/public/admission/me/applications/${appA}/receipts/${view.json().receipts[0].id}`,
        headers: pub(tokenA),
      });
      expect(Buffer.from(rec.json().base64, 'base64').subarray(0, 4).toString()).toBe('%PDF');
      // a registration number signs in too
      const byNo = await signIn(view.json().number);
      const me = await inject({ method: 'GET', url: '/public/admission/me', headers: pub(byNo) });
      expect(me.json().applications.map((a: { id: string }) => a.id)).toContain(appA);
      const locked = await inject({
        method: 'PUT',
        url: `/public/admission/me/applications/${appA}/step`,
        headers: pub(tokenA),
        json: { step: 'student', answers: answers({ last_name: 'Other' }) },
      });
      expect(locked.statusCode).toBe(409);
    });

    it('registers an EWS candidate at once (no fee)', async () => {
      const start = await inject({
        method: 'POST',
        url: '/public/admission/me/applications',
        headers: pub(tokenB),
        json: { cycleId, classId: classMini },
      });
      appEws = start.json().id;
      const sub = await inject({
        method: 'POST',
        url: `/public/admission/me/applications/${appEws}/submit`,
        headers: pub(tokenB),
        json: { answers: answers({ ews: 'Yes', first_name: 'Ravi', aadhaar_no: '999988887777' }) },
      });
      expect(sub.statusCode).toBe(201);
      expect(sub.json()).toMatchObject({ fee: 0, registered: true });
      expect(sub.json().application).toMatchObject({ status: 'registered', category: 'EWS / DG' });
    });

    it("lets the office fill a walk-in's form and take the fee at the desk", async () => {
      const walkIn = await inject({
        method: 'POST',
        url: '/admissions/desk/applications',
        headers: h(clerk),
        json: { cycleId, classId: classMini, mobile: '9876500011' },
      });
      expect(walkIn.statusCode).toBe(201);
      const id = walkIn.json().id as string;
      appWalkIn = id;
      const form = await inject({
        method: 'GET',
        url: `/admissions/applications/${id}/form`,
        headers: h(),
      });
      expect(form.statusCode).toBe(200);
      const sub = await inject({
        method: 'POST',
        url: `/admissions/applications/${id}/form/submit`,
        headers: h(),
        json: {
          answers: answers({
            first_name: 'Meena',
            aadhaar_no: '111122223333',
            sms_mobile: '9876500011',
          }),
        },
      });
      expect(sub.statusCode).toBe(201);
      const noRight = await inject({
        method: 'POST',
        url: `/admissions/applications/${id}/registration-fee`,
        headers: h(clerk),
        json: { mode: 'cash' },
      });
      expect(noRight.statusCode).toBe(403);
      const fee = await inject({
        method: 'POST',
        url: `/admissions/applications/${id}/registration-fee`,
        headers: h(),
        json: { mode: 'cash' },
      });
      expect(fee.statusCode).toBe(201);
      expect(fee.json().receiptNo).toMatch(/^REG\//);
      expect(fee.json().number).toBeTruthy();
      const twice = await inject({
        method: 'POST',
        url: `/admissions/applications/${id}/registration-fee`,
        headers: h(),
        json: { mode: 'cash' },
      });
      expect(twice.statusCode).toBe(409);
      const pdf = await inject({
        method: 'GET',
        url: `/admissions/receipts/${fee.json().receiptId}/pdf`,
        headers: h(),
      });
      expect(Buffer.from(pdf.json().base64, 'base64').subarray(0, 4).toString()).toBe('%PDF');
    });
  });
  describe('part 4: approval process', () => {
    let stages: Array<{ id: string; name: string; kind: string }>;
    let processId: string;
    let slotId: string;
    const st = (kind: string) => stages.find((s) => s.kind === kind)!.id;
    const reg = (id: string, u: SeededUser = admin) =>
      inject({ method: 'GET', url: `/admissions/registrations/${id}`, headers: h(u) });
    const decide = (id: string, json: Record<string, unknown>, u: SeededUser = admin) =>
      inject({
        method: 'POST',
        url: `/admissions/registrations/${id}/decide`,
        headers: h(u),
        json,
      });

    it('starts the school with stages; a process reaching registrations in progress needs a confirmation', async () => {
      const setup = await inject({ method: 'GET', url: '/admissions/process-setup', headers: h() });
      expect(setup.statusCode).toBe(200);
      stages = setup.json().stages;
      expect(stages.map((s) => s.kind)).toEqual([
        'document_check',
        'test',
        'interview',
        'interaction',
        'selection',
      ]);
      const body = {
        name: 'Senior',
        classIds: [classMini],
        steps: [
          {
            stageId: st('document_check'),
            levels: [
              { name: 'Office check', by: 'anyone' },
              { name: 'Principal', by: 'role', roleCode: 'school_admin' },
            ],
          },
          { stageId: st('test'), levels: [{ name: 'Test cell', by: 'anyone' }] },
          { stageId: st('selection'), levels: [{ name: 'Admission committee', by: 'anyone' }] },
        ],
      };
      const badOrder = await inject({
        method: 'POST',
        url: '/admissions/processes',
        headers: h(),
        json: { ...body, steps: [body.steps[2], body.steps[0]] },
      });
      expect(badOrder.statusCode).toBe(400);
      const ask = await inject({
        method: 'POST',
        url: '/admissions/processes',
        headers: h(),
        json: body,
      });
      expect(ask.statusCode).toBe(409);
      expect(ask.json()).toMatchObject({ type: 'admissions.confirm_process', affected: 3 });
      const ok = await inject({
        method: 'POST',
        url: '/admissions/processes',
        headers: h(),
        json: { ...body, confirm: true },
      });
      expect(ok.statusCode).toBe(201);
      processId = ok.json().id;
      const r = await reg(appA);
      expect(r.json().process).toMatchObject({ stageNo: 0, levelNo: 1, hasProcess: true });
      expect(r.json().process.current).toMatchObject({
        kind: 'document_check',
        levelName: 'Office check',
      });
      const denied = await inject({
        method: 'PUT',
        url: `/admissions/processes/${processId}`,
        headers: h(clerk),
        json: body,
      });
      expect(denied.statusCode).toBe(403);
    });

    it("moves level by level; only the level's people decide; Document check confirms the category", async () => {
      const l1 = await decide(appA, { decision: 'approve', remarks: 'Papers fine' }, clerk);
      expect(l1.statusCode).toBe(201);
      expect(l1.json().process).toMatchObject({ stageNo: 0, levelNo: 2 });
      expect(l1.json().status).toBe('under_review');
      const notMine = await decide(appA, { decision: 'approve' }, clerk);
      expect(notMine.statusCode).toBe(403);
      const marksHere = await decide(appA, { decision: 'approve', marks: 10 });
      expect(marksHere.statusCode).toBe(400);
      const sibling = categories.find((c) => c.code === 'sibling')!.id;
      const l2 = await decide(appA, { decision: 'approve', categoryId: sibling });
      expect(l2.statusCode).toBe(201);
      expect(l2.json().process.current).toMatchObject({ kind: 'test' });
      expect(l2.json().category).toBe('Sibling in school');
    });

    it('sends the form back for correction; the family corrects only those answers and it returns to the same level', async () => {
      const bad = await inject({
        method: 'POST',
        url: `/admissions/registrations/${appEws}/send-back`,
        headers: h(),
        json: { fields: ['nonsense'], remark: 'Fix it' },
      });
      expect(bad.statusCode).toBe(400);
      const sb = await inject({
        method: 'POST',
        url: `/admissions/registrations/${appEws}/send-back`,
        headers: h(),
        json: {
          fields: ['last_name'],
          remark: 'Surname as on the birth certificate',
          dueOn: '2027-01-15',
        },
      });
      expect(sb.statusCode).toBe(201);
      expect(sb.json().status).toBe('sent_back');
      const fam = await inject({
        method: 'GET',
        url: `/public/admission/me/applications/${appEws}`,
        headers: pub(tokenB),
      });
      expect(fam.json()).toMatchObject({
        status: 'sent_back',
        onlyFields: ['last_name'],
        correction: { dueOn: '2027-01-15' },
      });
      const blocked = await decide(appEws, { decision: 'approve' });
      expect(blocked.statusCode).toBe(409);
      const answers = { ...fam.json().answers, last_name: 'Sharma', first_name: 'Changed' };
      const re = await inject({
        method: 'POST',
        url: `/public/admission/me/applications/${appEws}/submit`,
        headers: pub(tokenB),
        json: { answers },
      });
      expect(re.statusCode).toBe(201);
      const after = await reg(appEws);
      expect(after.json()).toMatchObject({ status: 'under_review', candidate: 'RAVI SHARMA' });
      expect(after.json().process).toMatchObject({ stageNo: 0, levelNo: 1 });
      expect(after.json().corrections[0].status).toBe('resubmitted');
    });

    it('allots a test slot with an admit card; marks are checked against the maximum', async () => {
      const slot = await inject({
        method: 'POST',
        url: `/admissions/cycles/${cycleId}/slots`,
        headers: h(),
        json: {
          stageId: st('test'),
          classId: classMini,
          startsAt: new Date(Date.now() + 3 * 86400000).toISOString(),
          minutes: 90,
          venue: 'Hall A',
          capacity: 1,
        },
      });
      expect(slot.statusCode).toBe(201);
      slotId = slot.json().id;
      expect(slot.json().waiting).toBe(1);
      const allot = await inject({
        method: 'POST',
        url: `/admissions/slots/${slotId}/allot`,
        headers: h(),
        json: {},
      });
      expect(allot.statusCode).toBe(201);
      expect(allot.json().candidates).toMatchObject([
        { applicationId: appA, rollNo: 1, notified: true },
      ]);
      const full = await inject({
        method: 'POST',
        url: `/admissions/slots/${slotId}/allot`,
        headers: h(),
        json: {},
      });
      expect(full.statusCode).toBe(409);
      const card = await inject({
        method: 'GET',
        url: `/public/admission/me/applications/${appA}/admit-card`,
        headers: pub(tokenA),
      });
      expect(Buffer.from(card.json().base64, 'base64').subarray(0, 4).toString()).toBe('%PDF');
      const fam = await inject({
        method: 'GET',
        url: `/public/admission/me/applications/${appA}`,
        headers: pub(tokenA),
      });
      expect(fam.json().slot).toMatchObject({ venue: 'Hall A', rollNo: 1 });
      expect(fam.json().steps.map((x: { state: string }) => x.state)).toEqual([
        'done',
        'current',
        'waiting',
      ]);
      const over = await inject({
        method: 'PUT',
        url: `/admissions/slots/${slotId}/results`,
        headers: h(),
        json: {
          rows: [{ applicationId: appA, attendance: 'present', marks: 150, decision: 'approve' }],
        },
      });
      expect(over.statusCode).toBe(400);
      const ok = await inject({
        method: 'PUT',
        url: `/admissions/slots/${slotId}/results`,
        headers: h(),
        json: {
          rows: [{ applicationId: appA, attendance: 'present', marks: 72, decision: 'approve' }],
        },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().saved).toBe(1);
      const r = await reg(appA);
      expect(r.json()).toMatchObject({ merit: 72 });
      expect(r.json().process.current).toMatchObject({ kind: 'selection' });
    });

    it('offers from the merit list with the admission fee; undo; waiting list and the next offer', async () => {
      const sel = await inject({
        method: 'GET',
        url: `/admissions/cycles/${cycleId}/selection/${classMini}`,
        headers: h(),
      });
      expect(sel.statusCode).toBe(200);
      expect(sel.json().merit.map((x: { id: string }) => x.id)).toEqual([appA]);
      const offer = await inject({
        method: 'POST',
        url: `/admissions/cycles/${cycleId}/selection/offer`,
        headers: h(),
        json: { applicationIds: [appA] },
      });
      expect(offer.statusCode).toBe(201);
      let r = await reg(appA);
      expect(r.json()).toMatchObject({ status: 'offered', offer: { admissionFee: 20000 } });
      const fam = await inject({
        method: 'GET',
        url: `/public/admission/me/applications/${appA}`,
        headers: pub(tokenA),
      });
      expect(fam.json().offer).toMatchObject({ admissionFee: 20000 });
      const undo = await inject({
        method: 'POST',
        url: `/admissions/registrations/${appA}/undo`,
        headers: h(),
        json: { reason: 'Offer made by mistake' },
      });
      expect(undo.statusCode).toBe(201);
      expect(undo.json()).toMatchObject({ status: 'under_review', offer: null });
      expect(undo.json().process.current).toMatchObject({ kind: 'selection' });
      const wl = await inject({
        method: 'POST',
        url: `/admissions/cycles/${cycleId}/selection/waitlist`,
        headers: h(),
        json: { applicationIds: [appA] },
      });
      expect(wl.statusCode).toBe(201);
      r = await reg(appA);
      expect(r.json()).toMatchObject({ status: 'waitlisted', waitRank: 1 });
      const next = await inject({
        method: 'POST',
        url: `/admissions/cycles/${cycleId}/selection/next`,
        headers: h(),
        json: { classId: classMini },
      });
      expect(next.statusCode).toBe(201);
      expect(next.json().offered).toBe(appA);
      r = await reg(appA);
      expect(r.json().status).toBe('offered');
    });

    it('draws among the candidates at Selection: seats offered, the rest wait-listed in draw order', async () => {
      for (const id of [appEws, appWalkIn]) {
        await decide(id, { decision: 'approve' });
        await decide(id, { decision: 'approve' });
        const t = await decide(id, { decision: 'approve', marks: 50 });
        expect(t.json().process.current).toMatchObject({ kind: 'selection' });
      }
      const draw = await inject({
        method: 'POST',
        url: `/admissions/cycles/${cycleId}/selection/draw`,
        headers: h(),
        json: { classId: classMini, seats: 1, seed: 'fixed-seed' },
      });
      expect(draw.statusCode).toBe(201);
      expect(draw.json().seed).toBe('fixed-seed');
      expect(draw.json().offered).toHaveLength(1);
      expect(draw.json().waitlisted).toHaveLength(1);
      const sel = await inject({
        method: 'GET',
        url: `/admissions/cycles/${cycleId}/selection/${classMini}`,
        headers: h(),
      });
      expect(sel.json().offered).toHaveLength(2);
      expect(sel.json().waiting).toHaveLength(1);
      const list = await inject({
        method: 'GET',
        url: `/admissions/registrations?cycleId=${cycleId}&status=offered`,
        headers: h(),
      });
      expect(list.json().total).toBe(2);
    });
  });
  describe('part 5: communication', () => {
    it('sends from Compose to the candidates of a session; it shows in the family inbox', async () => {
      const draft = {
        title: 'Orientation for new families',
        category: 'service',
        channels: [{ channel: 'email', custom: true }],
        subject: 'Orientation for {{candidate_name}}',
        body: '<p>Dear parent, the orientation for {{class_sought}} is on Monday.</p>',
        bodyFormat: 'html',
        audience: 'candidates',
        targets: [],
        rule: { candidates: { cycleId, classIds: [classMini], statuses: ['offered'] } },
      };
      const preview = await inject({
        method: 'POST',
        url: '/comms/requests/preview',
        headers: h(),
        json: draft,
      });
      expect(preview.statusCode).toBe(201);
      expect(preview.json().total).toBeGreaterThanOrEqual(1);
      const created = await inject({
        method: 'POST',
        url: '/comms/requests',
        headers: h(),
        json: draft,
      });
      expect(created.statusCode).toBe(201);
      if (created.json().status === 'pending_approval') {
        const inbox = await inject({ method: 'GET', url: '/workflow/inbox', headers: h() });
        const step = inbox
          .json()
          .data.find(
            (x: { instance: { entityId: string } }) => x.instance.entityId === created.json().id,
          );
        await inject({
          method: 'POST',
          url: `/workflow/steps/${step.id}/approve`,
          headers: h(),
          json: {},
        });
      }
      const fam = await inject({
        method: 'GET',
        url: '/public/admission/me/inbox',
        headers: pub(tokenA),
      });
      expect(fam.statusCode).toBe(200);
      const subjects = (fam.json().messages as Array<{ subject: string | null }>).map(
        (m) => m.subject ?? '',
      );
      expect(subjects).toContain('Orientation for ASHA VERMA');
      // the automatic admission emails are there too (the offer of part 4)
      expect(subjects.some((x) => /offer/i.test(x))).toBe(true);
      const other = await inject({
        method: 'GET',
        url: '/public/admission/me/inbox',
        headers: pub(tokenB),
      });
      expect(
        (other.json().messages as Array<{ subject: string | null }>).map((m) => m.subject),
      ).not.toContain('Orientation for ASHA VERMA');
    });

    it('publishes a notice for candidates of a class; only the families seeking it see it', async () => {
      const mk = (title: string, classId: string) =>
        inject({
          method: 'POST',
          url: '/academics/notices',
          headers: h(),
          json: {
            title,
            body: 'Bring the original birth certificate for verification.',
            audience: 'candidates',
            targets: [{ type: 'admission_class', id: classId }],
            publish: true,
          },
        });
      const mini = await mk('Document verification (Mini)', classMini);
      expect(mini.statusCode).toBe(201);
      expect(mini.json().targets[0].label).toBe('Candidates: Class Mini');
      const ix = await mk('Document verification (IX)', classIx);
      expect(ix.statusCode).toBe(201);
      const fam = await inject({
        method: 'GET',
        url: '/public/admission/me/inbox',
        headers: pub(tokenA),
      });
      const titles = (fam.json().notices as Array<{ title: string }>).map((n) => n.title);
      expect(titles).toContain('Document verification (Mini)');
      expect(titles).not.toContain('Document verification (IX)');
      const reach = await inject({
        method: 'POST',
        url: '/academics/notices/reach',
        headers: h(),
        json: { audience: 'candidates', targets: [{ type: 'admission_class', id: classMini }] },
      });
      expect(reach.json()).toMatchObject({ students: 0, employees: 0 });
      expect(reach.json().candidates).toBeGreaterThanOrEqual(3);
    });
  });
  describe('part 6: admission fee, Admit and cancellation', () => {
    let sectionA: string;
    let sectionB: string;
    let second: string;

    it('takes the admission fee online: the admission number, the AF receipt and the admission form', async () => {
      const pay = await inject({
        method: 'POST',
        url: `/public/admission/me/applications/${appA}/pay?school=${school.code}`,
        headers: pub(tokenA),
        json: {},
      });
      expect(pay.statusCode).toBe(201);
      const form = pay.json().checkout as { fields: Record<string, string> };
      expect(form.fields.amount).toBe('20000.00');
      const paid = await inject({
        method: 'POST',
        url: '/payments/payu/mock',
        headers: {},
        json: { txnid: form.fields.txnid, outcome: 'success' },
      });
      expect(paid.json()).toMatchObject({ outcome: 'applied' });
      const fam = await inject({
        method: 'GET',
        url: `/public/admission/me/applications/${appA}`,
        headers: pub(tokenA),
      });
      expect(fam.json()).toMatchObject({
        status: 'fee_paid',
        admissionFeeDue: 0,
        hasAdmissionForm: true,
      });
      expect(fam.json().admissionNo).toBeTruthy();
      expect(fam.json().receipts.map((r: { receiptNo: string }) => r.receiptNo)).toEqual(
        expect.arrayContaining([expect.stringMatching(/^ADM\//)]),
      );
      const pdf = await inject({
        method: 'GET',
        url: `/public/admission/me/applications/${appA}/admission-form`,
        headers: pub(tokenA),
      });
      expect(Buffer.from(pdf.json().base64, 'base64').subarray(0, 4).toString()).toBe('%PDF');
    });

    it('takes (or confirms) the admission fee at the desk', async () => {
      const list = await inject({
        method: 'GET',
        url: `/admissions/registrations?cycleId=${cycleId}&status=offered`,
        headers: h(),
      });
      second = (list.json().data as Array<{ id: string }>).find((x) => x.id !== appA)!.id;
      const noRight = await inject({
        method: 'POST',
        url: `/admissions/registrations/${second}/admission-fee`,
        headers: h(clerk),
        json: { mode: 'cash' },
      });
      expect(noRight.statusCode).toBe(403);
      const fee = await inject({
        method: 'POST',
        url: `/admissions/registrations/${second}/admission-fee`,
        headers: h(),
        json: { mode: 'cash' },
      });
      expect(fee.statusCode).toBe(201);
      expect(fee.json().admissionNo).toBeTruthy();
      const twice = await inject({
        method: 'POST',
        url: `/admissions/registrations/${second}/admission-fee`,
        headers: h(),
        json: { mode: 'cash' },
      });
      expect(twice.statusCode).toBe(409);
    });

    it('admits into the student master with a class-section, one by one and in bulk', async () => {
      sectionA = (
        await inject({
          method: 'POST',
          url: `/academics/classes/${classMini}/sections`,
          headers: h(),
          json: { name: 'A' },
        })
      ).json().id;
      sectionB = (
        await inject({
          method: 'POST',
          url: `/academics/classes/${classMini}/sections`,
          headers: h(),
          json: { name: 'B' },
        })
      ).json().id;
      const waiting = await inject({
        method: 'GET',
        url: `/admissions/cycles/${cycleId}/admit/${classMini}`,
        headers: h(),
      });
      expect(waiting.statusCode).toBe(200);
      expect(waiting.json().sections.map((x: { name: string }) => x.name)).toEqual(['A', 'B']);
      expect(
        waiting
          .json()
          .candidates.map((x: { id: string }) => x.id)
          .sort(),
      ).toEqual([appA, second].sort());
      const wrong = await inject({
        method: 'POST',
        url: `/admissions/registrations/${appA}/admit`,
        headers: h(),
        json: { classSectionId: '999999' },
      });
      expect(wrong.statusCode).toBe(400);
      const one = await inject({
        method: 'POST',
        url: `/admissions/registrations/${appA}/admit`,
        headers: h(),
        json: { classSectionId: sectionA, rollNo: 1 },
      });
      expect(one.statusCode).toBe(201);
      expect(one.json()).toMatchObject({ section: 'A' });
      expect(one.json().skipped).toEqual({});
      const student = await withMigrator((c) =>
        c.query<{ admission_no: string; first_name: string; status: string; section: string }>(
          `SELECT s.admission_no, s.first_name, s.status::text, cs.name AS section FROM students s
             JOIN enrolments e ON e.student_id = s.id AND e.status = 'active' JOIN class_sections cs ON cs.id = e.class_section_id
            WHERE s.id = $1`,
          [one.json().studentId],
        ),
      );
      expect(student.rows[0]).toMatchObject({
        admission_no: one.json().admissionNo,
        first_name: 'ASHA',
        section: 'A',
      });
      const again = await inject({
        method: 'POST',
        url: `/admissions/registrations/${appA}/admit`,
        headers: h(),
        json: { classSectionId: sectionA },
      });
      expect(again.statusCode).toBe(409);
      const bulk = await inject({
        method: 'POST',
        url: '/admissions/admit-bulk',
        headers: h(),
        json: {
          items: [
            { applicationId: second, classSectionId: sectionB },
            { applicationId: appA, classSectionId: sectionB },
          ],
        },
      });
      expect(bulk.statusCode).toBe(201);
      expect(bulk.json().admitted).toBe(1);
      expect(
        bulk.json().results.find((r: { applicationId: string }) => r.applicationId === appA),
      ).toMatchObject({ ok: false });
    });

    it('cancels an admission with the admission fee refunded less the deduction, after approval', async () => {
      await inject({
        method: 'PUT',
        url: `/admissions/cycles/${cycleId}/settings`,
        headers: h(),
        json: { refundDeductionPct: 10 },
      });
      const preview = await inject({
        method: 'GET',
        url: `/admissions/registrations/${appA}/cancel`,
        headers: h(),
      });
      expect(preview.json().refund).toMatchObject({
        paid: 20000,
        pct: 10,
        deduction: 2000,
        amount: 18000,
      });
      const denied = await inject({
        method: 'POST',
        url: `/admissions/registrations/${appA}/cancel`,
        headers: h(clerk),
        json: { reason: 'Family moved' },
      });
      expect(denied.statusCode).toBe(403);
      const cancel = await inject({
        method: 'POST',
        url: `/admissions/registrations/${appA}/cancel`,
        headers: h(),
        json: { reason: 'Family moved city' },
      });
      expect(cancel.statusCode).toBe(201);
      expect(cancel.json().refund).toMatchObject({ amount: 18000 });
      const enrol = await withMigrator((c) =>
        c.query<{ status: string }>(
          `SELECT e.status::text FROM enrolments e JOIN applications a ON a.student_id = e.student_id WHERE a.id = $1`,
          [appA],
        ),
      );
      expect(enrol.rows[0]!.status).toBe('withdrawn');
      const refunds = await inject({
        method: 'GET',
        url: '/admissions/refunds?status=requested',
        headers: h(),
      });
      const r = (refunds.json().data as Array<{ id: string; applicationId: string }>).find(
        (x) => x.applicationId === appA,
      )!;
      const early = await inject({
        method: 'POST',
        url: `/admissions/refunds/${r.id}/pay`,
        headers: h(),
        json: { mode: 'bank' },
      });
      expect(early.statusCode).toBe(409);
      const ok = await inject({
        method: 'POST',
        url: `/admissions/refunds/${r.id}/decide`,
        headers: h(),
        json: { approve: true },
      });
      expect(ok.json().status).toBe('approved');
      const paid = await inject({
        method: 'POST',
        url: `/admissions/refunds/${r.id}/pay`,
        headers: h(),
        json: { mode: 'bank', reference: 'NEFT123' },
      });
      expect(paid.json().status).toBe('paid');
      const fam = await inject({
        method: 'GET',
        url: `/public/admission/me/applications/${appA}`,
        headers: pub(tokenA),
      });
      expect(fam.json()).toMatchObject({ status: 'cancelled', cancelReason: 'Family moved city' });
    });

    it('cancels a registration before the fee: nothing to refund', async () => {
      const list = await inject({
        method: 'GET',
        url: `/admissions/registrations?cycleId=${cycleId}&status=waitlisted`,
        headers: h(),
      });
      const id = (list.json().data as Array<{ id: string }>)[0]!.id;
      const cancel = await inject({
        method: 'POST',
        url: `/admissions/registrations/${id}/cancel`,
        headers: h(),
        json: { reason: 'Took admission elsewhere' },
      });
      expect(cancel.statusCode).toBe(201);
      expect(cancel.json()).toMatchObject({ status: 'cancelled', refund: null });
    });
  });
});
