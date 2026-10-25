/**
 * Online admission (docs/design/39): part 1 — the form builder (ready forms, checks, mapping to the
 * student master, additional student fields). Later parts add their cases here.
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
    // the portal calls above count against the public rate limit: leave it clear for the next suite
    const redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      lazyConnect: true,
    });
    await redis.connect();
    const keys = await redis.keys('edupro:throttle:*');
    if (keys.length) await redis.del(...keys);
    await redis.quit();
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

    it('does not overwrite a save made after the builder opened the form, unless asked', async () => {
      const opened = (
        await inject({ method: 'GET', url: `/admissions/forms/${formIx}`, headers: h() })
      ).json();
      // someone else saves first
      const first = await inject({
        method: 'PUT',
        url: `/admissions/forms/${formIx}`,
        headers: h(),
        json: { name: opened.name, def: opened.def, baseUpdatedAt: opened.updatedAt },
      });
      expect(first.statusCode).toBe(200);
      // the page opened before that save is stopped, and told who saved and when
      const late = await inject({
        method: 'PUT',
        url: `/admissions/forms/${formIx}`,
        headers: h(),
        json: { name: opened.name, def: opened.def, baseUpdatedAt: opened.updatedAt },
      });
      expect(late.statusCode).toBe(409);
      expect(late.json().type).toMatch(/stale/);
      expect(late.json().updatedAt).toBe(first.json().updatedAt);
      // replacing it on purpose: against the version it was told about
      const replace = await inject({
        method: 'PUT',
        url: `/admissions/forms/${formIx}`,
        headers: h(),
        json: { name: opened.name, def: opened.def, baseUpdatedAt: late.json().updatedAt },
      });
      expect(replace.statusCode).toBe(200);
    });

    it('edits, copies and archives a form; only managers may change it', async () => {
      const form = (
        await inject({ method: 'GET', url: `/admissions/forms/${formXi}`, headers: h() })
      ).json();
      const def = structuredClone(form.def);
      def.settings.maxFileMb = 8;
      // the DOB range is the session's (its class line), no longer the form's: not kept
      def.settings.dobTo = '2012-03-31';
      def.fields.push({ key: 'hobby', label: 'Hobby', type: 'text', step: 'other', copy: true });
      const ok = await inject({
        method: 'PUT',
        url: `/admissions/forms/${formXi}`,
        headers: h(),
        json: { name: 'Registration XI', description: 'Written test', def },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().def.settings.maxFileMb).toBe(8);
      expect(ok.json().def.settings.dobTo).toBeUndefined();
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

    // docs/design/43, part 5: a category whose question the form does not ask is flagged, and opening asks
    it('flags a fee category the form cannot decide, and opens only when that is confirmed', async () => {
      const setup = (
        await inject({ method: 'GET', url: '/admissions/setup', headers: h() })
      ).json();
      const original = setup.categories as Array<Record<string, unknown>>;
      const pointNowhere = original.map((c) =>
        c.code === 'ews'
          ? { ...c, conditions: [{ field: 'no_such_question', op: 'eq', value: 'Yes' }] }
          : c,
      );
      const save = (categories: Array<Record<string, unknown>>) =>
        inject({
          method: 'PUT',
          url: '/admissions/setup/categories',
          headers: h(),
          json: { categories },
        });
      expect((await save(pointNowhere)).statusCode).toBe(200);
      try {
        const cyc = await inject({
          method: 'POST',
          url: '/admissions/cycles',
          headers: h(),
          json: {
            academicYearId: school.yearId,
            code: 'ADM-GAP',
            name: 'Gap check',
            opensAt: new Date(Date.now() - 86400000).toISOString(),
            closesAt: new Date(Date.now() + 30 * 86400000).toISOString(),
          },
        });
        expect(cyc.statusCode).toBe(201);
        const gapCycle = cyc.json().id as string;
        await inject({
          method: 'PUT',
          url: `/admissions/cycles/${gapCycle}/classes`,
          headers: h(),
          json: { classes: [{ classId: classIx, formId: formIx, seats: 5, status: 'open' }] },
        });
        const plan = (
          await inject({ method: 'GET', url: `/admissions/cycles/${gapCycle}/plan`, headers: h() })
        ).json();
        const gap = (
          plan.categoryGaps as Array<{
            categoryName: string;
            missing: string[];
            never: boolean;
            classes: string[];
          }>
        ).find((g) => g.missing.includes('no_such_question'))!;
        expect(gap).toMatchObject({ categoryName: 'EWS / DG', never: true, classes: ['Class IX'] });
        const listed = (
          await inject({ method: 'GET', url: '/admissions/setup', headers: h() })
        ).json();
        expect(
          (listed.categoryGaps as Array<{ cycleId: string }>).some((g) => g.cycleId === gapCycle),
        ).toBe(true);
        const refused = await inject({
          method: 'PATCH',
          url: `/admissions/cycles/${gapCycle}`,
          headers: h(),
          json: { status: 'open' },
        });
        expect(refused.statusCode).toBe(409);
        expect(refused.json().type).toMatch(/category_gaps/);
        expect(refused.json().detail).toMatch(/EWS \/ DG: the form does not ask no_such_question/);
        const opened = await inject({
          method: 'PATCH',
          url: `/admissions/cycles/${gapCycle}`,
          headers: h(),
          json: { status: 'open', confirmCategoryGaps: true },
        });
        expect(opened.statusCode).toBe(200);
        expect(opened.json().status).toBe('open');
        // closed again: the other tests use their own session
        await inject({
          method: 'PATCH',
          url: `/admissions/cycles/${gapCycle}`,
          headers: h(),
          json: { status: 'closed' },
        });
      } finally {
        expect((await save(original)).statusCode).toBe(200);
      }
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
      // the PIN codes and the alumni pass-out year are the class line's (moved from the form)
      const rules = await inject({
        method: 'PUT',
        url: `/admissions/cycles/${cycleId}/classes`,
        headers: h(),
        json: {
          classes: r.json().classes.map((k: Record<string, unknown>) => ({
            classId: k.classId,
            formId: k.formId,
            seats: k.seats,
            ageAsOn: k.ageAsOn,
            dobFrom: k.dobFrom,
            dobTo: k.dobTo,
            status: k.status,
            ...(k.classId === classIx
              ? { pincodePrefixes: ['110', '122'], passOutBefore: 2020 }
              : {}),
          })),
        },
      });
      expect(rules.statusCode).toBe(200);
      const ix = (rules.json().classes as Array<Record<string, unknown>>).find(
        (k) => k.classId === classIx,
      )!;
      expect(ix).toMatchObject({ pincodePrefixes: ['110', '122'], passOutBefore: 2020 });
      // an older screen that does not send them keeps them
      const kept = await inject({
        method: 'PUT',
        url: `/admissions/cycles/${cycleId}/classes`,
        headers: h(),
        json: {
          classes: r.json().classes.map((k: Record<string, unknown>) => ({
            classId: k.classId,
            formId: k.formId,
            seats: k.seats,
            ageAsOn: k.ageAsOn,
            dobFrom: k.dobFrom,
            dobTo: k.dobTo,
            status: k.status,
          })),
        },
      });
      expect(
        (kept.json().classes as Array<Record<string, unknown>>).find((k) => k.classId === classIx),
      ).toMatchObject({ pincodePrefixes: ['110', '122'], passOutBefore: 2020 });
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

    it('keeps merit points for the session and a class of its own (docs/design/40)', async () => {
      const empty = await inject({
        method: 'GET',
        url: `/admissions/cycles/${cycleId}/points`,
        headers: h(),
      });
      expect(empty.statusCode).toBe(200);
      expect(empty.json()).toMatchObject({ editable: true, session: [] });
      // the questions come from the classes' forms
      expect(empty.json().fields.map((f: { key: string }) => f.key)).toContain('gender');
      const sibling = {
        name: 'Sibling studies here',
        logic: 'all',
        conditions: [{ field: 'siblings', op: 'gte', value: '1' }],
        points: 20,
      };
      const girl = {
        name: 'Girl child',
        logic: 'all',
        conditions: [{ field: 'gender', op: 'eq', value: 'Female' }],
        points: 5,
      };
      const saved = await inject({
        method: 'PUT',
        url: `/admissions/cycles/${cycleId}/points`,
        headers: h(),
        json: {
          session: [sibling, girl],
          classes: [
            { classId: classIx, own: false, rules: [] },
            { classId: classXi, own: true, rules: [{ ...sibling, points: 10 }] },
          ],
        },
      });
      expect(saved.statusCode).toBe(200);
      const body = saved.json();
      expect(body.session.map((r: { name: string }) => r.name)).toEqual([
        'Sibling studies here',
        'Girl child',
      ]);
      const xi = body.classes.find((k: { classId: string }) => k.classId === classXi);
      expect(xi).toMatchObject({
        own: true,
        rules: [{ name: 'Sibling studies here', points: 10 }],
      });
      const ix = body.classes.find((k: { classId: string }) => k.classId === classIx);
      expect(ix).toMatchObject({ own: false, rules: [] });
      // 0 points, no condition, a class not in the session, a clerk: refused
      for (const json of [
        { session: [{ ...girl, points: 0 }], classes: [] },
        { session: [{ ...girl, conditions: [] }], classes: [] },
        { session: [], classes: [{ classId: '999999', own: true, rules: [girl] }] },
      ]) {
        const r = await inject({
          method: 'PUT',
          url: `/admissions/cycles/${cycleId}/points`,
          headers: h(),
          json,
        });
        expect(r.statusCode).toBe(400);
      }
      const denied = await inject({
        method: 'PUT',
        url: `/admissions/cycles/${cycleId}/points`,
        headers: h(clerk),
        json: { session: [], classes: [] },
      });
      expect(denied.statusCode).toBe(403);
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

    it('sends sign-in codes first and never late; a new code waits 30 s; codes on screen are recorded (docs/design/41)', async () => {
      const ask = async (identifier: string) => {
        const ch = await inject({
          method: 'POST',
          url: '/public/admissions/challenge',
          headers: {},
        });
        const nonce = PowService.solve(ch.json().challenge, ch.json().difficulty);
        return inject({
          method: 'POST',
          url: '/public/admission/code',
          headers: {},
          json: { schoolCode: school.code, identifier, challenge: ch.json().challenge, nonce },
        });
      };
      const email = `codes.${Date.now()}@example.com`;
      const first = await ask(email);
      expect(first.statusCode).toBe(201);
      expect(first.json()).toMatchObject({ resendAfter: 30 });
      expect(first.json().screenCode).toBeUndefined();
      // the code's email: on the urgent queue, with the code's expiry
      const msg = await withMigrator((c) =>
        c.query<{ urgent: boolean; expires: boolean }>(
          `SELECT o.queue = 'urgent' AS urgent, m.expires_at > now() AS expires
             FROM comms_messages m JOIN jobs_outbox o ON o.payload -> 'payload' ->> 'messageId' = m.id::text
            WHERE m.school_id = $1 AND m.recipient_address = $2 ORDER BY m.id DESC LIMIT 1`,
          [school.id, email],
        ),
      );
      expect(msg.rows[0]).toEqual({ urgent: true, expires: true });
      // asked again at once: the wait is told
      const soon = await ask(email);
      expect(soon.statusCode).toBe(429);
      expect(soon.json().retryAfter).toBeGreaterThan(0);
      // the school shows codes on screen while its mail is set up: the code comes back, recorded
      const settings = (
        await inject({ method: 'GET', url: '/admissions/setup', headers: h() })
      ).json().settings;
      const put = (on: boolean) =>
        inject({
          method: 'PUT',
          url: '/admissions/setup/settings',
          headers: h(),
          json: {
            signinChannels: settings.signinChannels,
            regReceiptPrefix: settings.regReceiptPrefix,
            admReceiptPrefix: settings.admReceiptPrefix,
            otpOnScreen: on,
          },
        });
      expect((await put(true)).statusCode).toBe(200);
      const shown = await ask(`9${String(Date.now()).slice(-9)}`);
      expect(shown.statusCode).toBe(201);
      expect(shown.json().screenCode).toMatch(/^\d{6}$/);
      const after = await put(false);
      expect(after.json()).toMatchObject({ otpOnScreen: false });
      expect(after.json().codesShown7d).toBeGreaterThanOrEqual(1);
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

    it('keeps one live registration per child per year; an admin may let a second one through at the desk (docs/design/41)', async () => {
      // the family tries Asha again (a second form) in the same year
      const start = await inject({
        method: 'POST',
        url: '/public/admission/me/applications',
        headers: pub(tokenA),
        json: { cycleId, classId: classMini },
      });
      expect(start.statusCode).toBe(201);
      const again = start.json().id as string;
      const same = await inject({
        method: 'POST',
        url: `/public/admission/me/applications/${again}/submit`,
        headers: pub(tokenA),
        json: { answers: answers() },
      });
      expect(same.statusCode).toBe(409);
      expect(same.json().type).toMatch(/duplicate_child/);
      expect(same.json().detail).toMatch(/already has registration .* this year/);
      // another first name, the same Aadhaar: still the same child
      const byAadhaar = await inject({
        method: 'POST',
        url: `/public/admission/me/applications/${again}/submit`,
        headers: pub(tokenA),
        json: { answers: answers({ first_name: 'Tara' }) },
      });
      expect(byAadhaar.statusCode).toBe(409);
      // the refused form stays a draft
      const still = await inject({
        method: 'GET',
        url: `/public/admission/me/applications/${again}`,
        headers: pub(tokenA),
      });
      expect(still.json().status).toBe('draft');
      // at the desk: refused, a clerk cannot override, an admin can with a reason
      const walkIn = await inject({
        method: 'POST',
        url: '/admissions/desk/applications',
        headers: h(clerk),
        json: { cycleId, classId: classMini, mobile: '9876500012' },
      });
      const id = walkIn.json().id as string;
      const desk = (headers: Record<string, string>, extra: Record<string, unknown> = {}) =>
        inject({
          method: 'POST',
          url: `/admissions/applications/${id}/form/submit`,
          headers,
          json: { answers: answers({ sms_mobile: '9876500012' }), ...extra },
        });
      expect((await desk(h())).statusCode).toBe(409);
      expect(
        (
          await desk(h(clerk), {
            duplicateReason: 'Second form kept on the written request of the parents',
          })
        ).statusCode,
      ).toBe(403);
      const ok = await desk(h(), {
        duplicateReason: 'Second form kept on the written request of the parents',
      });
      expect(ok.statusCode).toBe(201);
      const hist = await inject({
        method: 'GET',
        url: `/admissions/registrations/${id}`,
        headers: h(),
      });
      expect(
        hist
          .json()
          .events.some((e: { note: string | null }) =>
            /let through by the office/.test(e.note ?? ''),
          ),
      ).toBe(true);
      // withdrawn again so the later steps see one live registration of Asha
      await withMigrator((c) =>
        c.query(`UPDATE applications SET status = 'withdrawn' WHERE id = $1`, [id]),
      );
    });

    it('locks a closed class for families; a late-entry passcode opens it for one family (docs/design/41)', async () => {
      const step = (id: string, token: string) =>
        inject({
          method: 'PUT',
          url: `/public/admission/me/applications/${id}/step`,
          headers: pub(token),
          json: { step: 'student', answers: answers({ first_name: 'Late' }) },
        });
      const draft = (
        await inject({
          method: 'POST',
          url: '/public/admission/me/applications',
          headers: pub(tokenA),
          json: { cycleId, classId: classMini, another: true },
        })
      ).json().id as string;
      // the class closes
      await withMigrator((c) =>
        c.query(
          `UPDATE admission_class_criteria SET closes_at = now() - interval '1 minute' WHERE cycle_id = $1 AND class_id = $2`,
          [cycleId, classMini],
        ),
      );
      try {
        const fresh = await inject({
          method: 'POST',
          url: '/public/admission/me/applications',
          headers: pub(tokenA),
          json: { cycleId, classId: classMini, another: true },
        });
        expect(fresh.statusCode).toBe(409);
        expect(fresh.json().detail).toMatch(/closed.*late-entry passcode/);
        expect((await step(draft, tokenA)).statusCode).toBe(409);
        const sub = await inject({
          method: 'POST',
          url: `/public/admission/me/applications/${draft}/submit`,
          headers: pub(tokenA),
          json: { answers: answers({ first_name: 'Late' }) },
        });
        expect(sub.statusCode).toBe(409);
        const seen = await inject({
          method: 'GET',
          url: `/public/admission/me/applications/${draft}`,
          headers: pub(tokenA),
        });
        expect(seen.json().locked).toBeTruthy();
        // the school admin opens it for family A until tomorrow; a clerk cannot
        const tomorrow = new Date(Date.now() + 86_400_000 + 330 * 60_000)
          .toISOString()
          .slice(0, 10);
        const give = {
          classId: classMini,
          email: `late.${Date.now()}@example.com`,
          mobile: mobileA,
          childName: 'Asha Verma',
          validUntil: tomorrow,
        };
        const denied = await inject({
          method: 'POST',
          url: `/admissions/cycles/${cycleId}/passcodes`,
          headers: h(clerk),
          json: give,
        });
        expect(denied.statusCode).toBe(403);
        const given = await inject({
          method: 'POST',
          url: `/admissions/cycles/${cycleId}/passcodes`,
          headers: h(),
          json: give,
        });
        expect(given.statusCode).toBe(201);
        expect(given.json()[0]).toMatchObject({ email: give.email, state: 'sent' });
        // the formatted email carries the passcode; the database only its hash
        const mail = await withMigrator((c) =>
          c.query<{ body: string }>(
            `SELECT m.body FROM comms_messages m JOIN comms_templates t ON t.id = m.template_id
              WHERE m.school_id = $1 AND t.code = 'admission_passcode' AND m.recipient_address = $2 ORDER BY m.id DESC LIMIT 1`,
            [school.id, give.email],
          ),
        );
        const code = /[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/.exec(mail.rows[0]!.body)![0];
        const use = (token: string, c: string) =>
          inject({
            method: 'POST',
            url: '/public/admission/me/passcode',
            headers: pub(token),
            json: { code: c },
          });
        expect((await use(tokenA, 'ZZZZ-ZZZZ')).statusCode).toBe(400);
        // another family cannot use it
        expect((await use(tokenB, code)).statusCode).toBe(403);
        const ok = await use(tokenA, code.toLowerCase().replace('-', ' '));
        expect(ok.statusCode).toBe(201);
        expect(ok.json()).toMatchObject({ cycleId, classId: classMini });
        expect((await step(draft, tokenA)).statusCode).toBe(200);
        const open = await inject({
          method: 'GET',
          url: `/public/admission/me/applications/${draft}`,
          headers: pub(tokenA),
        });
        expect(open.json()).toMatchObject({ locked: null });
        expect(open.json().passUntil).toBeTruthy();
        // revoked: closed again
        const id = given.json()[0].id as string;
        const rev = await inject({
          method: 'POST',
          url: `/admissions/passcodes/${id}/revoke`,
          headers: h(),
        });
        expect(rev.json()[0]).toMatchObject({ state: 'revoked' });
        expect((await step(draft, tokenA)).statusCode).toBe(409);
      } finally {
        await withMigrator((c) =>
          c.query(
            `UPDATE admission_class_criteria SET closes_at = NULL WHERE cycle_id = $1 AND class_id = $2`,
            [cycleId, classMini],
          ),
        );
        await inject({
          method: 'DELETE',
          url: `/public/admission/me/applications/${draft}`,
          headers: pub(tokenA),
          json: {},
        });
      }
    });

    it("opens the family's draft for the class again; another child starts a new form on purpose (docs/design/41)", async () => {
      const start = (extra: Record<string, unknown> = {}) =>
        inject({
          method: 'POST',
          url: '/public/admission/me/applications',
          headers: pub(tokenA),
          json: { cycleId, classId: classMini, ...extra },
        });
      // the draft left by the refused second form of Asha opens again
      const first = await start();
      expect(first.statusCode).toBe(201);
      expect(first.json().resumed).toBe(true);
      const again = await start();
      expect(again.json()).toEqual({ id: first.json().id, resumed: true });
      // another child: a new form
      const other = await start({ another: true });
      expect(other.json().resumed).toBeUndefined();
      expect(other.json().id).not.toBe(first.json().id);
      // My registrations: drafts first, with the class to continue
      const me = await inject({ method: 'GET', url: '/public/admission/me', headers: pub(tokenA) });
      const list = me.json().applications as Array<{ id: string; status: string; classId: string }>;
      const drafts = list.filter((x) => x.status === 'draft');
      expect(list.slice(0, drafts.length).every((x) => x.status === 'draft')).toBe(true);
      expect(drafts.map((x) => x.id)).toEqual(
        expect.arrayContaining([first.json().id, other.json().id]),
      );
      expect(drafts[0]!.classId).toBe(classMini);
      // deleted drafts leave the family as before
      for (const id of [first.json().id, other.json().id]) {
        const del = await inject({
          method: 'DELETE',
          url: `/public/admission/me/applications/${id}`,
          headers: pub(tokenA),
          json: {},
        });
        expect(del.statusCode).toBeLessThan(300);
      }
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
      // merit = the form's points (a girl: 5, docs/design/40) + the marks
      expect(r.json()).toMatchObject({ merit: 77, points: { total: 5 } });
      expect(r.json().process.current).toMatchObject({ kind: 'selection' });
    });

    it('works merit points out from the answers; the office confirms or awards differently with a reason (docs/design/40)', async () => {
      const r = await reg(appA);
      expect(r.json().points).toMatchObject({ total: 5, confirmedAt: null });
      expect(r.json().points.lines).toEqual([
        { name: 'Sibling studies here', max: 20, auto: 0, points: 0 },
        { name: 'Girl child', max: 5, auto: 5, points: 5 },
      ]);
      const check = (json: unknown) =>
        inject({
          method: 'POST',
          url: `/admissions/registrations/${appA}/points`,
          headers: h(),
          json,
        });
      // awarding differently needs a reason
      const noReason = await check({
        action: 'confirm',
        lines: [{ name: 'Sibling studies here', points: 20 }],
      });
      expect(noReason.statusCode).toBe(400);
      const ok = await check({
        action: 'confirm',
        lines: [
          {
            name: 'Sibling studies here',
            points: 20,
            reason: 'Brother in class VII, name spelt differently',
          },
        ],
      });
      expect(ok.statusCode).toBe(201);
      expect(ok.json()).toMatchObject({ total: 25 });
      expect(ok.json().confirmedAt).toBeTruthy();
      expect((await reg(appA)).json()).toMatchObject({ merit: 97 });
      // the family sees what gave points, not the office's reasons
      const fam = await inject({
        method: 'GET',
        url: `/public/admission/me/applications/${appA}`,
        headers: pub(tokenA),
      });
      expect(fam.json().points).toEqual({
        total: 25,
        confirmed: true,
        lines: [
          { name: 'Sibling studies here', points: 20 },
          { name: 'Girl child', points: 5 },
        ],
      });
      // confirmed points stay when the criteria change; worked out again they follow them
      const now = (
        await inject({ method: 'GET', url: `/admissions/cycles/${cycleId}/points`, headers: h() })
      ).json();
      const lists = (girl: number) => ({
        session: now.session.map((x: { name: string; points: number }) => ({
          ...x,
          points: x.name === 'Girl child' ? girl : x.points,
        })),
        classes: now.classes.map((k: { classId: string; own: boolean; rules: unknown[] }) => ({
          classId: k.classId,
          own: k.own,
          rules: k.rules,
        })),
      });
      const put = (girl: number) =>
        inject({
          method: 'PUT',
          url: `/admissions/cycles/${cycleId}/points`,
          headers: h(),
          json: lists(girl),
        });
      expect((await put(7)).statusCode).toBe(200);
      expect((await reg(appA)).json().points.total).toBe(25);
      const again = await check({ action: 'recalculate' });
      expect(again.json()).toMatchObject({ total: 7, confirmedAt: null });
      expect((await reg(appA)).json()).toMatchObject({ merit: 79 });
      // back as it was: the unconfirmed registration follows
      const back = await put(5);
      expect(back.json().recalculated).toBeGreaterThanOrEqual(1);
      expect((await reg(appA)).json()).toMatchObject({ merit: 77, points: { total: 5 } });
    });

    it("gives the family's home in one call: a summary per registration (docs/design/42)", async () => {
      const d = await inject({
        method: 'GET',
        url: '/public/admission/me/dashboard',
        headers: pub(tokenA),
      });
      expect(d.statusCode).toBe(200);
      const a = d.json().registrations.find((x: { id: string }) => x.id === appA);
      expect(a).toMatchObject({
        candidate: 'ASHA VERMA',
        feeDue: 0,
        points: { total: 5, confirmed: false },
        locked: null,
      });
      expect(a.number).toBeTruthy();
      expect(a.steps.length).toBeGreaterThan(0);
      expect(a.steps.some((s: { state: string }) => s.state === 'current')).toBe(true);
      // another family sees only its own
      const b = await inject({
        method: 'GET',
        url: '/public/admission/me/dashboard',
        headers: pub(tokenB),
      });
      expect(b.json().registrations.map((x: { id: string }) => x.id)).not.toContain(appA);
      expect(d.json().parentPortalUrl).toMatch(/^http/);
    });

    it('offers from the merit list with the admission fee; undo; waiting list and the next offer', async () => {
      const sel = await inject({
        method: 'GET',
        url: `/admissions/cycles/${cycleId}/selection/${classMini}`,
        headers: h(),
      });
      expect(sel.statusCode).toBe(200);
      expect(sel.json().merit.map((x: { id: string }) => x.id)).toEqual([appA]);
      // the list shows points, marks and merit; one candidate: no tie, no draw seed yet
      expect(sel.json().merit[0]).toMatchObject({
        rank: 1,
        points: 5,
        marks: 72,
        merit: 77,
        tie: null,
        dob: '2012-05-01',
      });
      expect(sel.json().tieBreak).toMatchObject({ seed: null });
      expect(sel.json().tieBreak.rule).toMatch(/older child first/);
      const pdf = await inject({
        method: 'GET',
        url: `/admissions/cycles/${cycleId}/selection/${classMini}/merit-list`,
        headers: h(),
      });
      expect(pdf.statusCode).toBe(200);
      expect(pdf.json().contentType).toBe('application/pdf');
      expect(Buffer.from(pdf.json().base64, 'base64').subarray(0, 4).toString()).toBe('%PDF');
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
  describe('doc 37 case 1b: the office corrects an application before Admit', () => {
    const correct = (
      id: string,
      answers: Record<string, unknown>,
      reason = 'Typed wrong at the desk',
    ) =>
      inject({
        method: 'POST',
        url: `/admissions/registrations/${id}/correct`,
        headers: h(),
        json: { answers, reason },
      });

    it('changes only the answers sent and keeps each one, old and new', async () => {
      const before = await inject({
        method: 'GET',
        url: `/admissions/registrations/${appWalkIn}`,
        headers: h(),
      });
      expect(before.json().canCorrect).toBe(true);
      const oldName = before.json().answers.first_name as string;
      const r = await correct(appWalkIn, { first_name: 'Corrected', gender: 'Female' });
      expect(r.statusCode).toBe(201);
      expect(r.json().changed.map((x: { key: string }) => x.key)).toContain('first_name');
      const after = await inject({
        method: 'GET',
        url: `/admissions/registrations/${appWalkIn}`,
        headers: h(),
      });
      expect(after.json().answers.first_name).toBe('CORRECTED');
      const change = (
        after.json().answerChanges as Array<{
          label: string;
          from: string;
          to: string;
          reason: string;
        }>
      ).find((x) => x.to === 'CORRECTED')!;
      expect(change).toMatchObject({ from: oldName, reason: 'Typed wrong at the desk' });
      expect(after.json().events[0].note).toMatch(/^Corrected by the office/);
      // the same values again: nothing to change
      const same = await correct(appWalkIn, { first_name: 'CORRECTED' });
      expect(same.statusCode).toBe(400);
    });

    it('checks each answer against the form', async () => {
      const bad = await correct(appWalkIn, { gender: 'Unknown' });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().errors).toHaveProperty('gender');
      const unknown = await correct(appWalkIn, { not_on_form: 'x' });
      expect(unknown.statusCode).toBe(400);
      expect(unknown.json().errors.not_on_form).toMatch(/not a question/);
      const reasonless = await inject({
        method: 'POST',
        url: `/admissions/registrations/${appWalkIn}/correct`,
        headers: h(),
        json: { answers: { first_name: 'X' } },
      });
      expect(reasonless.statusCode).toBe(400);
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
      // unread until the family opens it (docs/design/42, part 4)
      const notice = (
        fam.json().notices as Array<{ id: string; title: string; read: boolean }>
      ).find((n) => n.title === 'Document verification (Mini)')!;
      expect(notice.read).toBe(false);
      expect(fam.json().unread).toBeGreaterThanOrEqual(1);
      const mark = await inject({
        method: 'POST',
        url: '/public/admission/me/inbox/read',
        headers: pub(tokenA),
        json: { items: [{ kind: 'notice', id: notice.id }] },
      });
      expect(mark.statusCode).toBe(201);
      expect(mark.json().marked).toBe(1);
      const again = await inject({
        method: 'GET',
        url: '/public/admission/me/inbox',
        headers: pub(tokenA),
      });
      expect(
        (again.json().notices as Array<{ id: string; read: boolean }>).find(
          (n) => n.id === notice.id,
        )!.read,
      ).toBe(true);
      // something not in the family's inbox is not marked
      const foreign = await inject({
        method: 'POST',
        url: '/public/admission/me/inbox/read',
        headers: pub(tokenA),
        json: { items: [{ kind: 'message', id: '999999999' }] },
      });
      expect(foreign.json().marked).toBe(0);
      await inject({
        method: 'POST',
        url: '/public/admission/me/inbox/read',
        headers: pub(tokenA),
        json: { all: true },
      });
      const none = await inject({
        method: 'GET',
        url: '/public/admission/me/inbox',
        headers: pub(tokenA),
      });
      expect(none.json().unread).toBe(0);
      const reach = await inject({
        method: 'POST',
        url: '/academics/notices/reach',
        headers: h(),
        json: { audience: 'candidates', targets: [{ type: 'admission_class', id: classMini }] },
      });
      expect(reach.json()).toMatchObject({ students: 0, employees: 0 });
      expect(reach.json().candidates).toBeGreaterThanOrEqual(3);
    });

    it('a notice for candidates by session, class and status (docs/design/43, part 2)', async () => {
      const mk = (title: string, candidateStatuses: string[]) =>
        inject({
          method: 'POST',
          url: '/academics/notices',
          headers: h(),
          json: {
            title,
            body: 'Pay the admission fee by Friday.',
            audience: 'candidates',
            targets: [
              { type: 'admission_cycle', id: cycleId },
              { type: 'admission_class', id: classMini },
            ],
            candidateStatuses,
            publish: true,
          },
        });
      const offered = await mk('Admission fee reminder', ['offered']);
      expect(offered.statusCode).toBe(201);
      expect(offered.json().candidateStatuses).toEqual(['offered']);
      expect((offered.json().targets as Array<{ label: string }>).map((t) => t.label)).toContain(
        'Candidates: Class Mini',
      );
      const waiting = await mk('Waiting list update', ['waitlisted']);
      expect(waiting.statusCode).toBe(201);
      const fam = await inject({
        method: 'GET',
        url: '/public/admission/me/inbox',
        headers: pub(tokenA),
      });
      const titles = (fam.json().notices as Array<{ title: string }>).map((n) => n.title);
      // family A's registration is offered a seat: the reminder, not the waiting-list notice
      expect(titles).toContain('Admission fee reminder');
      expect(titles).not.toContain('Waiting list update');
      // a status nobody is in reaches nobody; the offered status reaches family A
      const count = (statuses: string[]) =>
        inject({
          method: 'POST',
          url: '/academics/notices/reach',
          headers: h(),
          json: {
            audience: 'candidates',
            targets: [{ type: 'admission_cycle', id: cycleId }],
            candidateStatuses: statuses,
          },
        }).then((r) => r.json().candidates as number);
      expect(await count(['offered'])).toBeGreaterThanOrEqual(1);
      expect(await count(['admitted'])).toBe(0);
      const bad = await inject({
        method: 'POST',
        url: '/academics/notices/reach',
        headers: h(),
        json: { audience: 'candidates', targets: [], candidateStatuses: ['nonsense'] },
      });
      expect(bad.statusCode).toBe(400);
    });
  });
  describe('docs/design/43, part 4: Ask the school', () => {
    let qid: string;

    it('a family asks about its registration; the admission desk of the Helpdesk gets it', async () => {
      const opts = await inject({
        method: 'GET',
        url: '/public/admission/me/queries/options',
        headers: pub(tokenA),
      });
      expect(opts.statusCode).toBe(200);
      const heads = (opts.json().heads as Array<{ code: string }>).map((x) => x.code);
      expect(heads).toEqual(expect.arrayContaining(['fees', 'documents', 'form', 'test', 'other']));
      expect((opts.json().registrations as Array<{ id: string }>).map((x) => x.id)).toContain(appA);
      // not the family's registration
      const foreign = await inject({
        method: 'POST',
        url: '/public/admission/me/queries',
        headers: pub(tokenB),
        json: {
          applicationId: appA,
          categoryCode: 'fees',
          subject: 'Fee question',
          body: 'Can I pay in two parts?',
        },
      });
      expect(foreign.statusCode).toBe(404);
      // a file with the question: uploaded for the registration, then named on the question
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64',
      );
      const slot = await inject({
        method: 'POST',
        url: '/public/admission/me/files/slot',
        headers: pub(tokenA),
        json: {
          applicationId: appA,
          fieldKey: 'query_file',
          fileName: 'fee-slip.png',
          contentType: 'image/png',
          sizeBytes: png.length,
        },
      });
      expect(slot.statusCode).toBe(201);
      const put = await inject({
        method: 'PUT',
        url: slot.json().upload.url,
        headers: {},
        raw: { body: png, contentType: 'image/png' },
      });
      expect(put.statusCode).toBe(200);
      const fileId = slot.json().file.id as string;
      const asked = await inject({
        method: 'POST',
        url: '/public/admission/me/queries',
        headers: pub(tokenA),
        json: {
          applicationId: appA,
          categoryCode: 'fees',
          subject: 'Fee question',
          body: 'Can I pay the admission fee in two parts?',
          fileIds: [fileId],
        },
      });
      expect(asked.statusCode).toBe(201);
      expect(asked.json().fileIds).toEqual([fileId]);
      const file = await inject({
        method: 'GET',
        url: `/public/admission/me/queries/${asked.json().id}/files/${fileId}`,
        headers: pub(tokenA),
      });
      expect(file.statusCode).toBe(200);
      expect(file.json()).toMatchObject({ contentType: 'image/png' });
      // another family cannot name it on its own question
      const theirs = await inject({
        method: 'GET',
        url: `/public/admission/me/queries/${asked.json().id}/files/${fileId}`,
        headers: pub(tokenB),
      });
      expect(theirs.statusCode).toBe(404);
      qid = asked.json().id;
      expect(asked.json()).toMatchObject({ status: 'open', head: 'Fee and payment' });
      expect(asked.json().number).toMatch(/^A\//);
      const desk = await inject({
        method: 'GET',
        url: '/helpdesk/tickets?desk=candidate',
        headers: h(),
      });
      expect(desk.statusCode).toBe(200);
      const t = (
        desk.json().data as Array<{ id: string; raisedBy: string; registration: { id: string } }>
      ).find((x) => x.id === qid)!;
      expect(t.registration.id).toBe(appA);
      expect(t.raisedBy).toBeTruthy();
      const byReg = await inject({
        method: 'GET',
        url: `/helpdesk/tickets?desk=candidate&applicationId=${appA}`,
        headers: h(),
      });
      expect((byReg.json().data as Array<{ id: string }>).map((x) => x.id)).toContain(qid);
    });

    it('the school answers; the family reads it, writes back, and rates it once closed', async () => {
      const take = await inject({
        method: 'POST',
        url: `/helpdesk/tickets/${qid}/take-over`,
        headers: h(),
      });
      expect(take.statusCode).toBeLessThan(300);
      const ans = await inject({
        method: 'POST',
        url: `/helpdesk/tickets/${qid}/replies`,
        headers: h(),
        json: { body: 'Yes: half now and half before the session starts.' },
      });
      expect(ans.statusCode).toBeLessThan(300);
      expect(ans.json().status).toBe('answered');
      const list = await inject({
        method: 'GET',
        url: '/public/admission/me/queries',
        headers: pub(tokenA),
      });
      expect(list.json().data.find((x: { id: string }) => x.id === qid)).toMatchObject({
        status: 'answered',
        unread: true,
      });
      const one = await inject({
        method: 'GET',
        url: `/public/admission/me/queries/${qid}`,
        headers: pub(tokenA),
      });
      expect(
        one
          .json()
          .replies.map((r: { body: string; fromFamily: boolean }) => [r.fromFamily, r.body]),
      ).toEqual([[false, 'Yes: half now and half before the session starts.']]);
      const after = await inject({
        method: 'GET',
        url: '/public/admission/me/queries',
        headers: pub(tokenA),
      });
      expect(after.json().unread).toBe(0);
      const back = await inject({
        method: 'POST',
        url: `/public/admission/me/queries/${qid}/reply`,
        headers: pub(tokenA),
        json: { body: 'Thank you. By when is the second half due?' },
      });
      expect(back.json().status).toBe('open');
      const close = await inject({
        method: 'POST',
        url: `/helpdesk/tickets/${qid}/close`,
        headers: h(),
        json: { resolution: 'By 31 March; a reminder goes out a week before.' },
      });
      expect(close.statusCode).toBeLessThan(300);
      const rated = await inject({
        method: 'POST',
        url: `/public/admission/me/queries/${qid}/rate`,
        headers: pub(tokenA),
        json: { rating: 5 },
      });
      expect(rated.json()).toMatchObject({ status: 'closed', rating: 5 });
      expect(rated.json().you.canReopen).toBe(true);
      const reopened = await inject({
        method: 'POST',
        url: `/public/admission/me/queries/${qid}/reopen`,
        headers: pub(tokenA),
        json: { reason: 'One more question about the reminder.' },
      });
      expect(reopened.json().status).toBe('open');
      // someone else's question stays hidden
      const other = await inject({
        method: 'GET',
        url: `/public/admission/me/queries/${qid}`,
        headers: pub(tokenB),
      });
      expect(other.statusCode).toBe(404);
    });
  });

  describe('docs/design/44, part 1: Messages by who sent them', () => {
    it("groups the family's messages, links each to its registration or question, and filters", async () => {
      const box = (q = '') =>
        inject({ method: 'GET', url: `/public/admission/me/inbox${q}`, headers: pub(tokenA) }).then(
          (r) => {
            expect(r.statusCode).toBe(200);
            return r.json() as {
              counts: Record<string, number>;
              registrations: Array<{ id: string }>;
              items: Array<{
                kind: string;
                id: string;
                group: string;
                origin?: string;
                code?: string | null;
                channels?: string[];
                subject?: string | null;
                title?: string;
                registration?: { id: string } | null;
                link?: { to: string; action: string } | null;
              }>;
            };
          },
        );
      const all = await box();
      const groups = new Set(all.items.map((x) => x.group));
      expect([...groups]).toEqual(expect.arrayContaining(['school', 'automatic', 'notice']));
      // Compose: from the school
      const compose = all.items.find((x) => x.subject === 'Orientation for ASHA VERMA')!;
      expect(compose).toMatchObject({ group: 'school', origin: 'compose', channels: ['email'] });
      // the answer to Ask the school: from the school, with its question
      const answer = all.items.find((x) => x.origin === 'answer')!;
      expect(answer.group).toBe('school');
      expect(answer.link?.action).toBe('question');
      expect(answer.registration?.id).toBe(appA);
      // the offer: an automatic update about Asha's registration, sending the family to pay
      const offer = all.items.find((x) => x.code === 'admission_offer')!;
      expect(offer).toMatchObject({ group: 'automatic', registration: { id: appA } });
      expect(offer.link).toMatchObject({ action: 'pay', to: `application/${appA}?tab=payments` });
      // filters: one tab, one child, words
      const auto = await box('?group=automatic');
      expect(auto.items.every((x) => x.group === 'automatic')).toBe(true);
      expect(auto.items.length).toBeGreaterThan(0);
      const child = await box(`?applicationId=${appA}`);
      expect(child.items.every((x) => x.kind === 'notice' || x.registration?.id === appA)).toBe(
        true,
      );
      const words = await box('?q=orientation');
      expect(words.items.map((x) => x.subject)).toContain('Orientation for ASHA VERMA');
      // mark the automatic tab read: the other tabs keep their unread
      const before = await box();
      const mark = await inject({
        method: 'POST',
        url: '/public/admission/me/inbox/read',
        headers: pub(tokenA),
        json: { all: true, group: 'automatic' },
      });
      expect(mark.statusCode).toBe(201);
      const after = await box();
      expect(after.counts.automatic).toBe(0);
      expect(after.counts.school).toBe(before.counts.school);
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
      // admitted: details are corrected on the student page now (doc 37 part 1)
      const late = await inject({
        method: 'POST',
        url: `/admissions/registrations/${appA}/correct`,
        headers: h(),
        json: { answers: { first_name: 'Late' }, reason: 'Too late for the form' },
      });
      expect(late.statusCode).toBe(409);
      expect(late.json().detail).toMatch(/student page/);
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
      // admitted: the registration page sends the office to Cancel admission on the student page
      const here = await inject({
        method: 'POST',
        url: `/admissions/registrations/${appA}/cancel`,
        headers: h(),
        json: { reason: 'Family moved city' },
      });
      expect(here.statusCode).toBe(409);
      expect(here.json().detail).toMatch(/Cancel admission on the student page/);
      const sid = await withMigrator(
        async (c) =>
          (
            await c.query<{ id: string }>(
              `SELECT student_id::text AS id FROM applications WHERE id = $1`,
              [appA],
            )
          ).rows[0]!.id,
      );
      const cancel = await inject({
        method: 'POST',
        url: `/people/students/${sid}/admission-cancellations`,
        headers: h(),
        json: { settlement: 'refund', reason: 'Family moved city' },
      });
      expect(cancel.statusCode).toBe(201);
      expect(cancel.json().preview.admissionFee).toMatchObject({ paid: 20000, refund: 18000 });
      const inbox = await inject({ method: 'GET', url: '/workflow/inbox', headers: h() });
      const step = (
        inbox.json().data as Array<{ id: string; instance: { entityType: string } }>
      ).find((x) => x.instance.entityType === 'admission_cancellation')!;
      await inject({
        method: 'POST',
        url: `/workflow/steps/${step.id}/approve`,
        headers: h(),
        json: {},
      });
      const enrol = await withMigrator((c) =>
        c.query<{ status: string }>(
          `SELECT e.status::text FROM enrolments e JOIN applications a ON a.student_id = e.student_id WHERE a.id = $1`,
          [appA],
        ),
      );
      expect(enrol.rows[0]!.status).toBe('cancelled');
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
  describe('part 7: reports and dashboard', () => {
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

    it('lists registrations on the report engine: any column, filters, search, tabs, export', async () => {
      const fields = await inject({
        method: 'GET',
        url: '/admissions/registrations/grid/fields',
        headers: h(),
      });
      expect(fields.statusCode).toBe(200);
      const keys = (fields.json().fields as Array<{ key: string }>).map((f) => f.key);
      expect(keys).toEqual(
        expect.arrayContaining([
          'registration_no',
          'status',
          'admission_no',
          'f_first_name',
          'f_aadhaar_no',
        ]),
      );
      const grid = await inject({
        method: 'POST',
        url: '/admissions/registrations/grid',
        headers: h(),
        json: {
          columns: [
            { key: 'class_sought' },
            { key: 'status' },
            { key: 'f_aadhaar_no' },
            { key: 'admission_fee' },
          ],
          filters: [{ key: 'class_sought', op: 'in', values: ['Class Mini'] }],
          sort: [],
          status: 'all',
          size: 50,
          page: 1,
        },
      });
      expect(grid.statusCode).toBe(201);
      expect(grid.json().total).toBeGreaterThanOrEqual(3);
      expect(grid.json().stats.closed).toBeGreaterThanOrEqual(2);
      const asha = (grid.json().rows as Array<Record<string, unknown>>).find(
        (r) => r.candidate === 'ASHA VERMA',
      )!;
      expect(asha).toMatchObject({ status: 'Cancelled', f_aadhaar_no: 'XXXX-XXXX-9012' });
      const search = await inject({
        method: 'POST',
        url: '/admissions/registrations/grid',
        headers: h(),
        json: {
          columns: [],
          filters: [],
          sort: [],
          status: 'in_progress',
          size: 50,
          page: 1,
          search: 'ravi',
        },
      });
      expect(search.json().rows.map((r: { candidate: string }) => r.candidate)).toContain(
        'RAVI SHARMA',
      );
      const exp = await inject({
        method: 'POST',
        url: '/admissions/registrations/grid/export',
        headers: h(),
        json: {
          columns: [{ key: 'status' }],
          filters: [],
          sort: [],
          status: 'all',
          size: 50,
          page: 1,
          format: 'xlsx',
        },
      });
      expect(exp.statusCode).toBe(201);
      expect(exp.json().spec.dataset).toBe('admissions');
    });

    it('offers the Admissions dataset in the report builder', async () => {
      const f = await inject({
        method: 'GET',
        url: '/reports/builder/fields?dataset=admissions',
        headers: h(),
      });
      expect(f.statusCode).toBe(200);
      expect(f.json().dataset).toBe('admissions');
      const preview = await inject({
        method: 'POST',
        url: '/reports/builder/preview',
        headers: h(),
        json: {
          spec: {
            dataset: 'admissions',
            columns: [{ key: 'registration_no' }, { key: 'candidate' }, { key: 'status' }],
            filters: [{ key: 'status', op: 'eq', values: ['Admitted'] }],
            sort: [],
            options: { paper: 'A4', orientation: 'auto' },
          },
          limit: 20,
        },
      });
      expect(preview.statusCode).toBe(201);
      expect(preview.json().total).toBe(1);
    });

    it('reports the admission fee collection with refunds, and the day book shows both', async () => {
      const r = await inject({
        method: 'GET',
        url: `/reports/datasets/admission_fee_collection/rows?from=${today}&to=${today}&cycleId=${cycleId}`,
        headers: h(),
      });
      expect(r.statusCode).toBe(200);
      const rows = r.json().rows as Array<{ kind: string; amount: number | string }>;
      expect(rows.map((x) => x.kind)).toEqual(
        expect.arrayContaining(['Registration fee', 'Admission fee', 'Refund']),
      );
      expect(rows.find((x) => x.kind === 'Refund')!.amount).toEqual(expect.anything());
      // 500 (online) + 500 (desk) registration + 20000 admission (+ the second's fee, if any) − 18000 refund
      const net = rows.reduce((t, x) => t + Number(x.amount), 0);
      expect(net).toBeGreaterThanOrEqual(3000);
      const book = await inject({
        method: 'GET',
        url: `/reports/datasets/fee_day_book/rows?from=${today}&to=${today}&ledger=admission`,
        headers: h(),
      });
      expect(book.statusCode).toBe(200);
      const kinds = (book.json().rows as Array<{ kind: string; ledger: string }>).map(
        (x) => `${x.kind}:${x.ledger}`,
      );
      expect(kinds).toEqual(expect.arrayContaining(['misc:admission', 'refund:admission']));
    });

    it('gives the dashboard figures, the funnel per class and the last 30 days', async () => {
      const o = await inject({
        method: 'GET',
        url: `/admissions/overview?cycleId=${cycleId}`,
        headers: h(),
      });
      expect(o.statusCode).toBe(200);
      expect(o.json().figures).toMatchObject({ admitted: 1, cancelled: 2, refunds: 18000 });
      expect(o.json().figures.registrationFees).toBe(1000);
      const mini = (o.json().byClass as Array<{ className: string; registered: number }>).find(
        (x) => x.className === 'Class Mini',
      )!;
      expect(mini.registered).toBe(3);
      expect(o.json().daily).toHaveLength(30);
    });
  });
  describe('part 8: enquiries', () => {
    let walkInSource: string;
    let enquiryId: string;
    const mobileE = `8${String(Date.now()).slice(-9)}`;
    const mobileF = `7${String(Date.now()).slice(-9)}`;

    it('takes an enquiry at the desk with a counsellor and the next follow-up', async () => {
      const meta = await inject({ method: 'GET', url: '/admissions/enquiries/meta', headers: h() });
      expect(meta.statusCode).toBe(200);
      walkInSource = (meta.json().sources as Array<{ id: string; name: string }>).find(
        (x) => x.name === 'Walk-in',
      )!.id;
      const bad = await inject({
        method: 'POST',
        url: '/admissions/enquiries',
        headers: h(),
        json: { parentName: 'Mr Gupta' },
      });
      expect(bad.statusCode).toBe(400);
      const e = await inject({
        method: 'POST',
        url: '/admissions/enquiries',
        headers: h(clerk),
        json: {
          parentName: 'Mr Gupta',
          childName: 'Neha Gupta',
          childDob: '2012-07-15',
          classId: classMini,
          cycleId,
          sourceId: walkInSource,
          mobile: mobileE,
        },
      });
      expect(e.statusCode).toBe(201);
      enquiryId = e.json().id;
      expect(e.json()).toMatchObject({ status: 'new', counsellorUserId: clerk.id });
      const tomorrow = new Date(Date.now() + 86400000 + 330 * 60_000).toISOString().slice(0, 10);
      const f = await inject({
        method: 'POST',
        url: `/admissions/enquiries/${enquiryId}/followups`,
        headers: h(clerk),
        json: {
          mode: 'call',
          outcome: 'Wants to see the campus first',
          nextOn: tomorrow,
          status: 'interested',
        },
      });
      expect(f.json()).toMatchObject({ status: 'interested', nextFollowUpOn: tomorrow });
      const list = await inject({
        method: 'GET',
        url: '/admissions/enquiries?status=open&counsellor=me',
        headers: h(clerk),
      });
      expect(list.json().data.map((x: { id: string }) => x.id)).toContain(enquiryId);
      expect(list.json().counts.open).toBeGreaterThanOrEqual(1);
    });

    it('invites the family with a link that fills the form, and converts the enquiry on registration', async () => {
      const inv = await inject({
        method: 'POST',
        url: `/admissions/enquiries/${enquiryId}/invite`,
        headers: h(),
        json: {},
      });
      expect(inv.statusCode).toBe(201);
      const token = /enquiry=([A-Za-z0-9_-]+)/.exec(inv.json().link as string)![1]!;
      const ch = await inject({ method: 'POST', url: '/public/admissions/challenge', headers: {} });
      const nonce = PowService.solve(ch.json().challenge, ch.json().difficulty);
      const code = await inject({
        method: 'POST',
        url: '/public/admission/code',
        headers: {},
        json: {
          schoolCode: school.code,
          identifier: mobileE,
          challenge: ch.json().challenge,
          nonce,
        },
      });
      const ok = await inject({
        method: 'POST',
        url: '/public/admission/code/verify',
        headers: {},
        json: { schoolCode: school.code, identifier: mobileE, code: code.json().devCode },
      });
      const tok = ok.json().token as string;
      const start = await inject({
        method: 'POST',
        url: '/public/admission/me/applications',
        headers: pub(tok),
        json: { cycleId, classId: classMini, enquiry: token },
      });
      expect(start.statusCode).toBe(201);
      const id = start.json().id as string;
      const view = await inject({
        method: 'GET',
        url: `/public/admission/me/applications/${id}`,
        headers: pub(tok),
      });
      expect(view.json().answers).toMatchObject({
        first_name: 'Neha',
        last_name: 'Gupta',
        dob: '2012-07-15',
        sms_mobile: mobileE,
      });
      const sub = await inject({
        method: 'POST',
        url: `/public/admission/me/applications/${id}/submit`,
        headers: pub(tok),
        json: {
          answers: {
            ...view.json().answers,
            gender: 'Female',
            primary_email: 'gupta.family@example.com',
            aadhaar_no: '555566667777',
            ews: 'No',
          },
        },
      });
      expect(sub.statusCode).toBe(201);
      const fee = await inject({
        method: 'POST',
        url: `/admissions/applications/${id}/registration-fee`,
        headers: h(),
        json: { mode: 'cash' },
      });
      expect(fee.statusCode).toBe(201);
      const e = await inject({
        method: 'GET',
        url: `/admissions/enquiries/${enquiryId}`,
        headers: h(),
      });
      expect(e.json()).toMatchObject({ status: 'converted' });
      expect(e.json().application).toMatchObject({ id });
    });

    it('converts an enquiry when the same mobile registers without the link', async () => {
      const e = await inject({
        method: 'POST',
        url: '/admissions/enquiries',
        headers: h(),
        json: {
          parentName: 'Mrs Rao',
          childName: 'Tara Rao',
          classId: classMini,
          sourceId: walkInSource,
          mobile: mobileF,
        },
      });
      const walkIn = await inject({
        method: 'POST',
        url: '/admissions/desk/applications',
        headers: h(),
        json: { cycleId, classId: classMini, mobile: mobileF },
      });
      const id = walkIn.json().id as string;
      // matched when the form begins (docs/design/46, part 3): the lead shows Registration started
      const begun = (
        await inject({ method: 'GET', url: `/admissions/enquiries/${e.json().id}`, headers: h() })
      ).json();
      const started = (begun.stages as Array<{ id: string; kind: string }>).find(
        (x) => x.kind === 'started',
      )!;
      expect(begun.stageId).toBe(started.id);
      expect(
        (begun.followups as Array<{ outcome: string }>).some((f) =>
          /started the registration form \(matched by mobile\)/.test(f.outcome),
        ),
      ).toBe(true);
      await inject({
        method: 'POST',
        url: `/admissions/applications/${id}/form/submit`,
        headers: h(),
        json: {
          answers: {
            first_name: 'Tara',
            last_name: 'Rao',
            dob: '2012-05-01',
            gender: 'Female',
            sms_mobile: mobileF,
            primary_email: 'rao.family@example.com',
            aadhaar_no: '888877776666',
            ews: 'No',
          },
        },
      });
      await inject({
        method: 'POST',
        url: `/admissions/applications/${id}/registration-fee`,
        headers: h(),
        json: { mode: 'upi' },
      });
      const after = await inject({
        method: 'GET',
        url: `/admissions/enquiries/${e.json().id}`,
        headers: h(),
      });
      expect(after.json().status).toBe('converted');
      expect(after.json().application?.id).toBe(id);
    });

    it("takes the website's enquiry form and reports conversion by source and class", async () => {
      const ch = await inject({ method: 'POST', url: '/public/admissions/challenge', headers: {} });
      const nonce = PowService.solve(ch.json().challenge, ch.json().difficulty);
      const web = await inject({
        method: 'POST',
        url: '/public/admission/enquiry',
        headers: {},
        json: {
          schoolCode: school.code,
          challenge: ch.json().challenge,
          nonce,
          parentName: 'Web Parent',
          childName: 'Web Child',
          classId: classMini,
          email: 'web.parent@example.com',
        },
      });
      expect(web.statusCode).toBe(201);
      const list = await inject({
        method: 'GET',
        url: '/admissions/enquiries?q=Web%20Parent',
        headers: h(),
      });
      expect(list.json().data[0]).toMatchObject({
        source: 'Website',
        fromWebsite: true,
        status: 'new',
      });
      const rep = await inject({
        method: 'GET',
        url: `/admissions/enquiries/report?cycleId=${cycleId}`,
        headers: h(),
      });
      expect(rep.statusCode).toBe(200);
      const walk = (
        rep.json().bySource as Array<{ name: string; enquiries: number; registered: number }>
      ).find((x) => x.name === 'Walk-in')!;
      expect(walk).toMatchObject({ enquiries: 2, registered: 2, toRegistration: 100 });
      const mini = (rep.json().byClass as Array<{ name: string; enquiries: number }>).find(
        (x) => x.name === 'Class Mini',
      )!;
      expect(mini.enquiries).toBe(3);
    });

    // docs/design/43, part 3: assigned on arrival, acknowledged with a number, answered from the desk
    const webEnquiry = async (parentName: string) => {
      const ch = await inject({ method: 'POST', url: '/public/admissions/challenge', headers: {} });
      const nonce = PowService.solve(ch.json().challenge, ch.json().difficulty);
      return inject({
        method: 'POST',
        url: '/public/admission/enquiry',
        headers: {},
        json: {
          schoolCode: school.code,
          challenge: ch.json().challenge,
          nonce,
          parentName,
          classId: classMini,
          email: `${parentName.toLowerCase().replace(/\s+/g, '.')}@example.com`,
        },
      });
    };
    const findEnquiry = async (q: string) =>
      (
        await inject({
          method: 'GET',
          url: `/admissions/enquiries?q=${encodeURIComponent(q)}`,
          headers: h(),
        })
      ).json().data[0] as { id: string; counsellor: string | null };

    it('assigns a website enquiry on arrival and acknowledges it with its number', async () => {
      const desk = await inject({
        method: 'PUT',
        url: '/admissions/enquiries/desk',
        headers: h(),
        json: { autoAssign: true, counsellors: [clerk.id], acknowledge: true },
      });
      expect(desk.statusCode).toBe(200);
      expect(desk.json()).toMatchObject({ autoAssign: true, counsellors: [clerk.id] });
      const web = await webEnquiry('Ack Parent');
      expect(web.statusCode).toBe(201);
      expect(web.json().enquiryNo).toMatch(/^ENQ-\d{6}$/);
      const row = await findEnquiry('Ack Parent');
      const one = await inject({
        method: 'GET',
        url: `/admissions/enquiries/${row.id}`,
        headers: h(),
      });
      expect(one.json()).toMatchObject({
        counsellorUserId: clerk.id,
        number: web.json().enquiryNo,
      });
      const notes = (one.json().followups as Array<{ outcome: string }>).map((f) => f.outcome);
      expect(notes.some((x) => /^Assigned to .+ on arrival$/.test(x))).toBe(true);
      expect(notes.some((x) => /^Acknowledgement sent/.test(x))).toBe(true);
      // switched off: the next one waits unassigned and gets no acknowledgement
      await inject({
        method: 'PUT',
        url: '/admissions/enquiries/desk',
        headers: h(),
        json: { autoAssign: false, counsellors: [], acknowledge: false },
      });
      await webEnquiry('Quiet Parent');
      const quiet = await findEnquiry('Quiet Parent');
      expect(quiet.counsellor).toBeNull();
      const restore = await inject({
        method: 'PUT',
        url: '/admissions/enquiries/desk',
        headers: h(),
        json: { autoAssign: true, counsellors: [], acknowledge: true },
      });
      expect(restore.statusCode).toBe(200);
      const wrong = await inject({
        method: 'PUT',
        url: '/admissions/enquiries/desk',
        headers: h(clerk),
        json: { autoAssign: true, counsellors: [], acknowledge: true },
      });
      expect(wrong.statusCode).toBe(403);
    });

    // docs/design/45, part 1: the school's stages of a lead, moved by hand and by the registration
    it('leads have stages: New, Contacted on the first call, moved, lost with a reason, in bulk', async () => {
      const meta = (
        await inject({ method: 'GET', url: '/admissions/enquiries/meta', headers: h() })
      ).json();
      const stages = meta.stages as Array<{ id: string; code: string; name: string; kind: string }>;
      expect(stages.map((x) => x.name)).toEqual([
        'New',
        'Contacted',
        'Interested',
        'Campus visit',
        'Registration started',
        'Registered',
        'Admitted',
        'Lost',
      ]);
      const by = (code: string) => stages.find((x) => x.code === code)!.id;
      const e = await inject({
        method: 'POST',
        url: '/admissions/enquiries',
        headers: h(clerk),
        json: {
          parentName: 'Lead Parent',
          childName: 'Lead Child',
          mobile: `6${String(Date.now()).slice(-9)}`,
        },
      });
      expect(e.statusCode).toBe(201);
      const id = e.json().id as string;
      expect(e.json()).toMatchObject({ stageId: by('new'), firstContactAt: null });
      const call = await inject({
        method: 'POST',
        url: `/admissions/enquiries/${id}/followups`,
        headers: h(clerk),
        json: { mode: 'call', outcome: 'Spoke to the mother' },
      });
      expect(call.json().stageId).toBe(by('contacted'));
      expect(call.json().firstContactAt).toBeTruthy();
      const visit = await inject({
        method: 'POST',
        url: `/admissions/enquiries/${id}/stage`,
        headers: h(clerk),
        json: { stageId: by('campus_visit') },
      });
      expect(visit.json()).toMatchObject({ stageId: by('campus_visit'), status: 'follow_up' });
      // registered and admitted move by themselves
      const reg = await inject({
        method: 'POST',
        url: `/admissions/enquiries/${id}/stage`,
        headers: h(clerk),
        json: { stageId: by('registered') },
      });
      expect(reg.statusCode).toBe(400);
      const noReason = await inject({
        method: 'POST',
        url: `/admissions/enquiries/${id}/stage`,
        headers: h(clerk),
        json: { stageId: by('lost') },
      });
      expect(noReason.statusCode).toBe(400);
      const bulk = await inject({
        method: 'POST',
        url: '/admissions/enquiries/bulk',
        headers: h(clerk),
        json: { ids: [id], score: 'hot', counsellorUserId: clerk.id },
      });
      expect(bulk.json()).toMatchObject({ done: 1, skipped: 0 });
      const lost = await inject({
        method: 'POST',
        url: '/admissions/enquiries/bulk',
        headers: h(clerk),
        json: { ids: [id], stageId: by('lost'), lostReason: 'Distance' },
      });
      expect(lost.json().done).toBe(1);
      const one = (
        await inject({ method: 'GET', url: `/admissions/enquiries/${id}`, headers: h(clerk) })
      ).json();
      expect(one).toMatchObject({
        stageId: by('lost'),
        status: 'not_interested',
        score: 'hot',
        lostReason: 'Distance',
        counsellorUserId: clerk.id,
      });
      const list = (
        await inject({
          method: 'GET',
          url: `/admissions/enquiries?stageId=${by('lost')}`,
          headers: h(),
        })
      ).json();
      expect(list.data.map((x: { id: string }) => x.id)).toContain(id);
      expect(
        (list.byStage as Array<{ stageId: string; leads: number }>).find(
          (x) => x.stageId === by('lost'),
        )!.leads,
      ).toBeGreaterThanOrEqual(1);
      // the converted enquiry of the invitation test sits in Registered (or Admitted)
      const converted = (
        await inject({ method: 'GET', url: '/admissions/enquiries?status=converted', headers: h() })
      ).json();
      expect(
        (converted.data as Array<{ stage: { kind: string } }>).every((x) =>
          ['registered', 'admitted'].includes(x.stage.kind),
        ),
      ).toBe(true);
      // the school renames a stage and adds one; the four kinds it must keep stay
      const renamed = await inject({
        method: 'PUT',
        url: '/admissions/enquiries/stages',
        headers: h(),
        json: {
          stages: [
            ...stages.map((x) => ({
              id: x.id,
              name: x.code === 'campus_visit' ? 'School tour' : x.name,
              kind: x.kind,
            })),
            { name: 'Test booked', kind: 'open' },
          ],
        },
      });
      expect(renamed.statusCode).toBe(200);
      expect((renamed.json() as Array<{ name: string }>).map((x) => x.name)).toEqual(
        expect.arrayContaining(['School tour', 'Test booked']),
      );
      const broken = await inject({
        method: 'PUT',
        url: '/admissions/enquiries/stages',
        headers: h(),
        json: {
          stages: stages
            .filter((x) => x.kind !== 'lost')
            .map((x) => ({ id: x.id, name: x.name, kind: x.kind })),
        },
      });
      expect(broken.statusCode).toBe(400);
    });

    // docs/design/45, part 3: assignment rules with escalation
    it("a rule gives a class's leads to its pool and escalates a lead not contacted in time", async () => {
      const meta = (
        await inject({ method: 'GET', url: '/admissions/enquiries/meta', headers: h() })
      ).json();
      const rules = meta.rules as Array<Record<string, unknown> & { isDefault: boolean }>;
      expect(rules.filter((x) => x.isDefault)).toHaveLength(1);
      const saved = await inject({
        method: 'PUT',
        url: '/admissions/enquiries/rules',
        headers: h(),
        json: {
          rules: [
            {
              name: 'Mini leads',
              classIds: [classMini],
              pool: [clerk.id],
              firstContactHours: 4,
              level2Role: 'school_admin',
              acknowledge: false,
            },
            ...rules.map((x) => ({
              id: x.id,
              name: x.name,
              classIds: x.classIds,
              sourceIds: x.sourceIds,
              autoAssign: x.autoAssign,
              pool: x.pool,
              firstContactHours: x.firstContactHours,
              level2UserId: x.level2UserId,
              level2Role: x.level2Role,
              acknowledge: x.acknowledge,
              isDefault: x.isDefault,
            })),
          ],
        },
      });
      expect(saved.statusCode).toBe(200);
      const mini = (saved.json() as Array<{ id: string; name: string }>).find(
        (x) => x.name === 'Mini leads',
      )!;
      // two "everything else" rules are refused
      const two = await inject({
        method: 'PUT',
        url: '/admissions/enquiries/rules',
        headers: h(),
        json: {
          rules: [
            { name: 'A', isDefault: true },
            { name: 'B', isDefault: true },
          ],
        },
      });
      expect(two.statusCode).toBe(400);
      const ch = await inject({ method: 'POST', url: '/public/admissions/challenge', headers: {} });
      const nonce = PowService.solve(ch.json().challenge, ch.json().difficulty);
      const web = await inject({
        method: 'POST',
        url: '/public/admission/enquiry',
        headers: {},
        json: {
          schoolCode: school.code,
          challenge: ch.json().challenge,
          nonce,
          parentName: 'Rule Parent',
          classId: classMini,
          email: 'rule.parent@example.com',
        },
      });
      expect(web.statusCode).toBe(201);
      const row = (
        await inject({ method: 'GET', url: '/admissions/enquiries?q=Rule%20Parent', headers: h() })
      ).json().data[0] as { id: string };
      const before = (
        await inject({ method: 'GET', url: `/admissions/enquiries/${row.id}`, headers: h() })
      ).json();
      expect(before).toMatchObject({ rule: 'Mini leads', level: 1, counsellorUserId: clerk.id });
      expect(before.contactDueAt).toBeTruthy();
      // the first contact is past due: the workers' run gives it to level 2
      const moved = await withMigrator(async (c) => {
        await c.query(
          `UPDATE admission_enquiries SET contact_due_at = now() - interval '1 minute' WHERE id = $1`,
          [row.id],
        );
        await c.query('BEGIN');
        await c.query(`SELECT set_config('app.school_id', $1, true)`, [school.id]);
        const r = await c.query<{ n: number }>('SELECT app.enquiry_escalate_due() AS n');
        await c.query('COMMIT');
        return r.rows[0]!.n;
      });
      expect(moved).toBeGreaterThanOrEqual(1);
      const after = (
        await inject({ method: 'GET', url: `/admissions/enquiries/${row.id}`, headers: h() })
      ).json();
      expect(after.level).toBe(2);
      expect(after.escalatedAt).toBeTruthy();
      expect(after.counsellorUserId).not.toBe(clerk.id);
      expect(
        (after.followups as Array<{ outcome: string }>).some((f) =>
          /^Not contacted within 4 working hours by .+: escalated to /.test(f.outcome),
        ),
      ).toBe(true);
      void mini;
    });

    // docs/design/45, part 4: the admission desk finds any registration and sends a walk-in the link
    it('the desk finds registrations and enquiries, and sends a walk-in the form link', async () => {
      const byNo = await inject({
        method: 'GET',
        url: '/admissions/desk/find?q=ASHA',
        headers: h(),
      });
      expect(byNo.statusCode).toBe(200);
      expect(
        (byNo.json().registrations as Array<{ candidate: string | null }>).some((r) =>
          /ASHA/i.test(r.candidate ?? ''),
        ),
      ).toBe(true);
      const short = await inject({ method: 'GET', url: '/admissions/desk/find?q=a', headers: h() });
      expect(short.statusCode).toBe(400);
      const cycles = (
        await inject({ method: 'GET', url: '/admissions/enquiries/meta', headers: h() })
      ).json().cycles as Array<{ id: string; status: string }>;
      const open = cycles.find((x) => x.status === 'open')!;
      const link = await inject({
        method: 'POST',
        url: '/admissions/enquiries/desk-link',
        headers: h(clerk),
        json: {
          cycleId: open.id,
          classId: classMini,
          parentName: 'Counter Parent',
          childName: 'Counter Child',
          childDob: '2021-05-04',
          email: 'counter.parent@example.com',
        },
      });
      expect(link.statusCode).toBe(201);
      expect(link.json().sent).toBeGreaterThanOrEqual(1);
      const lead = (
        await inject({
          method: 'GET',
          url: `/admissions/enquiries/${link.json().enquiryId}`,
          headers: h(clerk),
        })
      ).json();
      expect(lead).toMatchObject({ childName: 'Counter Child', counsellorUserId: clerk.id });
      expect(lead.firstContactAt).toBeTruthy();
      expect(lead.invitedAt).toBeTruthy();
      const found = (
        await inject({ method: 'GET', url: '/admissions/desk/find?q=Counter', headers: h() })
      ).json();
      expect((found.enquiries as Array<{ id: string }>).map((x) => x.id)).toContain(
        link.json().enquiryId,
      );
    });

    // docs/design/46, part 1: the list's leads as Excel at once and as a queued PDF
    it('exports the leads of the filters as Excel and queues them as a PDF', async () => {
      const x = await inject({
        method: 'GET',
        url: '/admissions/enquiries/list.xlsx?q=Parent',
        headers: h(),
      });
      expect(x.statusCode).toBe(200);
      expect(x.headers['content-type']).toMatch(/spreadsheetml/);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(x.rawPayload as unknown as ArrayBuffer);
      const ws = wb.worksheets[0]!;
      expect(String(ws.getCell('A1').value)).toMatch(
        /^Admission enquiries · "Parent" · \d+ enquiries$/,
      );
      expect(ws.getRow(3).values).toEqual(expect.arrayContaining(['Enquiry', 'Parent', 'Stage']));
      expect(String(ws.getCell('A4').value)).toMatch(/^ENQ-\d{6}$/);
      const none = await inject({
        method: 'GET',
        url: '/admissions/enquiries/list.xlsx?q=zzzz-nobody',
        headers: h(),
      });
      expect(none.statusCode).toBe(400);
      const pdf = await inject({
        method: 'POST',
        url: '/admissions/enquiries/export-pdf',
        headers: h(),
        json: { q: 'Parent' },
      });
      expect(pdf.statusCode).toBe(202);
      const queued = await withMigrator((c) =>
        c.query<{ dataset: string; ids: number }>(
          `SELECT dataset, jsonb_array_length(params->'ids') AS ids FROM exports WHERE id = $1`,
          [pdf.json().id],
        ),
      );
      expect(queued.rows[0]).toMatchObject({ dataset: 'admission_enquiries' });
      expect(queued.rows[0]!.ids).toBeGreaterThan(0);
    });

    // docs/design/46, part 2: a pool by role takes whoever holds the role when the lead arrives
    it('a rule whose pool is a role gives its leads to the role holders', async () => {
      const rules = (
        await inject({ method: 'GET', url: '/admissions/enquiries/meta', headers: h() })
      ).json().rules as Array<Record<string, unknown> & { status: string }>;
      const saved = await inject({
        method: 'PUT',
        url: '/admissions/enquiries/rules',
        headers: h(),
        json: {
          rules: [
            {
              name: 'IX by role',
              classIds: [classIx],
              poolRoles: ['academic_coordinator'],
              acknowledge: false,
            },
            ...rules
              .filter((x) => x.status === 'active')
              .map((x) => ({
                id: x.id,
                name: x.name,
                classIds: x.classIds,
                sourceIds: x.sourceIds,
                autoAssign: x.autoAssign,
                pool: x.pool,
                poolRoles: x.poolRoles,
                firstContactHours: x.firstContactHours,
                level2UserId: x.level2UserId,
                level2Role: x.level2Role,
                acknowledge: x.acknowledge,
                isDefault: x.isDefault,
              })),
          ],
        },
      });
      expect(saved.statusCode).toBe(200);
      expect(
        (saved.json() as Array<{ name: string; poolRoles: string[] }>).find(
          (x) => x.name === 'IX by role',
        )!.poolRoles,
      ).toEqual(['academic_coordinator']);
      const wrong = await inject({
        method: 'PUT',
        url: '/admissions/enquiries/rules',
        headers: h(),
        json: { rules: [{ name: 'Everything', isDefault: true, poolRoles: ['no_such_role'] }] },
      });
      expect(wrong.statusCode).toBe(400);
      const ch = await inject({ method: 'POST', url: '/public/admissions/challenge', headers: {} });
      const nonce = PowService.solve(ch.json().challenge, ch.json().difficulty);
      const web = await inject({
        method: 'POST',
        url: '/public/admission/enquiry',
        headers: {},
        json: {
          schoolCode: school.code,
          challenge: ch.json().challenge,
          nonce,
          parentName: 'Role Pool Parent',
          classId: classIx,
          email: 'role.pool.parent@example.com',
        },
      });
      expect(web.statusCode).toBe(201);
      const row = (
        await inject({ method: 'GET', url: '/admissions/enquiries?q=Role%20Pool', headers: h() })
      ).json().data[0] as { id: string };
      const one = (
        await inject({ method: 'GET', url: `/admissions/enquiries/${row.id}`, headers: h() })
      ).json();
      expect(one).toMatchObject({ rule: 'IX by role', counsellorUserId: clerk.id });
    });

    it('imports enquiries from a sheet: a wrong row stops it; duplicates are left out', async () => {
      const format = await inject({
        method: 'GET',
        url: '/admissions/enquiries/import-format.xlsx',
        headers: h(),
      });
      expect(format.statusCode).toBe(200);
      expect(format.headers['content-type']).toMatch(/spreadsheetml/);
      const sheet = async (rows: string[][]) => {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Enquiries');
        ws.addRow([
          'Parent name *',
          'Child name',
          'Child date of birth',
          'Mobile',
          'Email',
          'Class',
          'Source',
          'Locality',
          'Notes',
        ]);
        for (const r of rows) ws.addRow(r);
        return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
      };
      const fresh = `7${String(Date.now()).slice(-9)}`;
      const bad = await inject({
        method: 'POST',
        url: '/admissions/enquiries/import',
        headers: h(clerk),
        json: {
          fileBase64: await sheet([
            ['Fair Parent', 'Fair Child', '14-07-2021', fresh, '', 'Class Mini', 'Walk-in', '', ''],
            ['No Contact', '', '', '', '', '', '', '', ''],
          ]),
        },
      });
      expect(bad.statusCode).toBe(200);
      expect(bad.json()).toMatchObject({ added: 0 });
      expect(bad.json().errors[0]).toMatchObject({
        row: 3,
        message: 'give the mobile or the email',
      });
      const ok = await inject({
        method: 'POST',
        url: '/admissions/enquiries/import',
        headers: h(clerk),
        json: {
          fileBase64: await sheet([
            ['Fair Parent', 'Fair Child', '14-07-2021', fresh, '', 'Class Mini', 'Walk-in', '', ''],
            ['Web Parent Again', '', '', '', 'web.parent@example.com', '', '', '', ''],
            ['Fair Parent Twin', '', '', fresh, '', '', '', '', ''],
          ]),
        },
      });
      expect(ok.json()).toMatchObject({ added: 1, errors: [] });
      expect((ok.json().duplicates as Array<{ row: number }>).map((x) => x.row)).toEqual([3, 4]);
      const found = (
        await inject({ method: 'GET', url: '/admissions/enquiries?q=Fair%20Parent', headers: h() })
      ).json();
      expect(found.data[0]).toMatchObject({ childName: 'Fair Child', className: 'Class Mini' });
    });

    it('a new lead lands on the first active stage when "New" is switched off', async () => {
      const stages = (
        await inject({ method: 'GET', url: '/admissions/enquiries/meta', headers: h() })
      ).json().stages as Array<{
        id: string;
        code: string;
        name: string;
        kind: string;
        status: string;
      }>;
      const keep = stages.filter((x) => x.status === 'active' && x.code !== 'new');
      const off = await inject({
        method: 'PUT',
        url: '/admissions/enquiries/stages',
        headers: h(),
        json: { stages: keep.map((x) => ({ id: x.id, name: x.name, kind: x.kind })) },
      });
      expect(off.statusCode).toBe(200);
      try {
        const e = await inject({
          method: 'POST',
          url: '/admissions/enquiries',
          headers: h(clerk),
          json: { parentName: 'After New Parent', mobile: `6${String(Date.now() + 7).slice(-9)}` },
        });
        expect(e.statusCode).toBe(201);
        expect(e.json().stageId).toBe(keep.find((x) => x.kind === 'open')!.id);
      } finally {
        // New back on, as the other tests expect it
        await inject({
          method: 'PUT',
          url: '/admissions/enquiries/stages',
          headers: h(),
          json: {
            stages: stages
              .filter((x) => x.status === 'active' || x.code === 'new')
              .map((x) => ({ id: x.id, name: x.name, kind: x.kind })),
          },
        });
      }
    });

    it('replies to the family from the enquiry; the reply is kept with the follow-ups', async () => {
      const row = await findEnquiry('Ack Parent');
      const sent = await inject({
        method: 'POST',
        url: `/admissions/enquiries/${row.id}/reply`,
        headers: h(clerk),
        json: { message: 'Campus tours run on Saturdays at 10 am.', email: true, mobile: false },
      });
      expect(sent.statusCode).toBe(201);
      expect(sent.json().sent).toBeGreaterThanOrEqual(1);
      expect(sent.json().enquiry.status).toBe('follow_up');
      expect(sent.json().enquiry.followups[0]).toMatchObject({
        mode: 'reply',
        outcome: 'Reply by email: Campus tours run on Saturdays at 10 am.',
      });
      // the enquiry has no mobile: an SMS-only reply is refused
      const sms = await inject({
        method: 'POST',
        url: `/admissions/enquiries/${row.id}/reply`,
        headers: h(clerk),
        json: { message: 'Hello', email: false, mobile: true },
      });
      expect(sms.statusCode).toBe(400);
      const none = await inject({
        method: 'POST',
        url: `/admissions/enquiries/${row.id}/reply`,
        headers: h(clerk),
        json: { message: 'Hello', email: false, mobile: false },
      });
      expect(none.statusCode).toBe(400);
    });
  });
});
