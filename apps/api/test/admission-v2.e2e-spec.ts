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
  describe('part 3: candidate portal and office desk', () => {
    let classMini: string;
    let tokenA: string;
    let tokenB: string;
    let appA: string;
    let appEws: string;
    const mobileA = `9${String(Date.now()).slice(-9)}`;
    const emailB = `fam.${Date.now()}@example.com`;
    const pub = (token?: string): Record<string, string> =>
      token ? { authorization: `Bearer ${token}` } : {};
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
});
