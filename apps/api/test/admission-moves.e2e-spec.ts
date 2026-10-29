/**
 * Moving a registration to the other school of the group (docs/design/64): the first school asks with a
 * reason, the other accepts it into a session and class. A fresh registration there (answers copied by
 * key or by what they map to, the Aadhaar number kept encrypted, the photo's bytes copied, the family's
 * login by mobile, its own number), the old one cancelled "Moved to …" with transfer-out lines on its
 * receipts; the money carried as receipts of mode "transfer": equal fee registered at once, a higher fee
 * waits for the difference, the rest is credit that pays the admission fee at the offer. Refused,
 * withdrawn, admitted, the same child already there, money taken meanwhile, schools outside the group.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { decryptField, encryptField } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import { STORAGE_DRIVER } from '../src/modules/files/storage';
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

type Json = Record<string, unknown>;
const field = (key: string, label: string, type: string, more: Json = {}) => ({
  key,
  label,
  type,
  step: 'main',
  ...more,
});
const BASE = [
  field('first_name', 'First name', 'text', { required: true, maps: 'first_name' }),
  field('last_name', 'Last name', 'text', { maps: 'last_name' }),
  field('dob', 'Date of birth', 'date', { required: true, maps: 'dob' }),
  field('father_name', "Father's name", 'text', { maps: 'father_name' }),
  field('aadhaar', 'Aadhaar number', 'text', { preset: 'aadhaar', maps: 'aadhaar_no' }),
  field('photo', 'Photo', 'photo'),
];
const def = (extra: Json[]) =>
  JSON.stringify({
    steps: [{ key: 'main', title: 'Main' }],
    settings: {},
    fields: [...BASE, ...extra],
  });

describe('moving a registration between the schools of the group (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let alpha: SeededSchool;
  let beta: SeededSchool;
  let outsider: SeededSchool;
  let adminA: SeededUser;
  let adminB: SeededUser;
  let adminX: SeededUser;
  let acctB: SeededUser;
  const s = stamp('MV');
  const ids: Record<string, string> = {};
  const apps: Record<string, string> = {};
  const moves: Record<string, string> = {};
  const as = (u: SeededUser, school: SeededSchool) => headersFor(u.sub, school.id);
  const call = (h: Record<string, string>, method: 'GET' | 'POST', url: string, json?: unknown) =>
    inject({ method, url, headers: h, ...(json === undefined ? {} : { json }) });
  const A = (method: 'GET' | 'POST', url: string, json?: unknown) =>
    call(as(adminA, alpha), method, url, json);
  const B = (method: 'GET' | 'POST', url: string, json?: unknown) =>
    call(as(adminB, beta), method, url, json);
  const appRow = (id: string) =>
    withMigrator(async (c) => {
      const r = await c.query<{
        school_id: string;
        status: string;
        application_no: string | null;
        registration_fee: string | null;
        transfer_credit: string;
        cancel_reason: string | null;
        admission_no: string | null;
        applicant_id: string;
        data: Record<string, unknown>;
      }>(
        `SELECT school_id::text, status::text, application_no, registration_fee::text, transfer_credit::text,
                cancel_reason, admission_no, applicant_id::text, data
           FROM applications WHERE id = $1`,
        [id],
      );
      return r.rows[0]!;
    });

  /** A class with a form, a session open for registrations and the class's fees. */
  const line = async (
    c: Parameters<Parameters<typeof withMigrator>[0]>[0],
    school: SeededSchool,
    key: string,
    cls: string,
    formDef: string,
    fees: { reg: number; adm: number },
  ) => {
    const form = (
      await c.query<{ id: string }>(
        `INSERT INTO admission_forms (school_id, name, def) VALUES ($1, $2, $3::jsonb) RETURNING id::text`,
        [school.id, `Form ${key}`, formDef],
      )
    ).rows[0]!.id;
    const cycle =
      ids[`cycle-${school.id}`] ??
      (
        await c.query<{ id: string }>(
          `INSERT INTO admission_cycles (school_id, academic_year_id, code, name, opens_at, closes_at)
           VALUES ($1, $2, 'ADM27', 'Admissions 2027-28', now() - interval '10 days', now() + interval '20 days') RETURNING id::text`,
          [school.id, school.yearId],
        )
      ).rows[0]!.id;
    ids[`cycle-${school.id}`] = cycle;
    await c.query(
      `INSERT INTO admission_class_criteria (school_id, cycle_id, class_id, seats, form_id) VALUES ($1, $2, $3, 10, $4)`,
      [school.id, cycle, cls, form],
    );
    await c.query(
      `INSERT INTO admission_fees (school_id, cycle_id, class_id, category_id, registration_fee, admission_fee)
       SELECT $1, $2, $3, id, $4, $5 FROM admission_fee_categories WHERE school_id = $1 AND is_default`,
      [school.id, cycle, cls, fees.reg, fees.adm],
    );
    ids[`form-${key}`] = form;
    return { form, cycle };
  };

  const classOf = async (h: Record<string, string>, code: string, order: number) =>
    (
      await call(h, 'POST', '/academics/classes', {
        code,
        name: `Class ${code}`,
        displayOrder: order,
      })
    ).json().id as string;

  beforeAll(async () => {
    await withMigrator(async (c) => {
      alpha = await seedSchool(c, `${s}A`);
      beta = await seedSchool(c, `${s}B`);
      outsider = await seedSchool(c, `${s}X`);
      const g = await c.query<{ id: string }>(
        `INSERT INTO school_groups (code, name) VALUES ($1, $1) RETURNING id::text`,
        [`${s}G`],
      );
      await c.query(`UPDATE schools SET group_id = $1 WHERE id IN ($2, $3)`, [
        g.rows[0]!.id,
        alpha.id,
        beta.id,
      ]);
      adminA = await seedUser(c, alpha, `${s}-adminA`, 'school_admin');
      adminB = await seedUser(c, beta, `${s}-adminB`, 'school_admin');
      adminX = await seedUser(c, outsider, `${s}-adminX`, 'school_admin');
      acctB = await seedUser(c, beta, `${s}-acctB`, 'accountant');
    });
    app = await createApp();
    inject = injector(app);
    // the default fee categories of each school
    for (const h of [as(adminA, alpha), as(adminB, beta)])
      expect((await call(h, 'GET', '/admissions/setup')).statusCode).toBe(200);
    ids.aSix = await classOf(as(adminA, alpha), 'VI', 6);
    ids.bSix = await classOf(as(adminB, beta), 'VI', 6);
    ids.bSeven = await classOf(as(adminB, beta), 'VII', 7);
    ids.bOne = await classOf(as(adminB, beta), 'I', 1);
    const storage = app.get<StorageDriver>(STORAGE_DRIVER);
    await withMigrator(async (c) => {
      const aLine = await line(
        c,
        alpha,
        'a6',
        ids.aSix!,
        def([field('mother', "Mother's name", 'text', { maps: 'mother_name' })]),
        {
          reg: 500,
          adm: 5000,
        },
      );
      // Beta's Class VI form asks for a blood group Alpha's did not, and calls the mother's field differently
      await line(
        c,
        beta,
        'b6',
        ids.bSix!,
        def([
          field('mother_full', "Mother's full name", 'text', { maps: 'mother_name' }),
          field('blood_group', 'Blood group', 'text', { required: true }),
        ]),
        { reg: 500, adm: 4000 },
      );
      await line(c, beta, 'b7', ids.bSeven!, def([]), { reg: 800, adm: 4000 });
      await line(c, beta, 'b1', ids.bOne!, def([]), { reg: 300, adm: 4000 });
      const heads: Record<string, string> = {};
      for (const [code, name] of [
        ['ADMREG', 'Registration fee'],
        ['ADMFEE', 'Admission fee'],
      ] as const)
        heads[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO fee_heads (school_id, code, name, kind, ledger, refundable, sort_order)
             VALUES ($1, $2, $3, 'misc', 'admission', false, 900) RETURNING id::text`,
            [alpha.id, code, name],
          )
        ).rows[0]!.id;
      const formDef = (
        await c.query<{ def: unknown }>(`SELECT def FROM admission_forms WHERE id = $1`, [
          aLine.form,
        ])
      ).rows[0]!.def;
      // Alpha's registrations: each its own family; DEV admitted; CHITRA paid the admission fee too
      const people = [
        ['ASHA', 'registered', [['ADMREG', 500]]],
        ['BALU', 'registered', [['ADMREG', 500]]],
        [
          'CHITRA',
          'fee_paid',
          [
            ['ADMREG', 500],
            ['ADMFEE', 3000],
            ['ADMFEE', 2000],
          ],
        ],
        ['DEV', 'admitted', [['ADMREG', 500]]],
        ['ESHA', 'under_review', [['ADMREG', 500]]],
        ['FARAH', 'registered', [['ADMREG', 500]]],
        ['GITA', 'offered', [['ADMREG', 500]]],
      ] as const;
      for (const [i, [name, status, paid]] of people.entries()) {
        const mobile = `9${String(Date.now()).slice(-7)}${String(i).padStart(2, '0')}`;
        ids[`mobile-${name}`] = mobile;
        const ap = await c.query<{ id: string }>(
          `INSERT INTO applicants (school_id, mobile, email, name) VALUES ($1, $2, $3, $4) RETURNING id::text`,
          [alpha.id, mobile, `${name.toLowerCase()}@example.invalid`, `Parent of ${name}`],
        );
        const a = await c.query<{ id: string }>(
          `INSERT INTO applications (school_id, cycle_id, class_id, applicant_id, child_first_name, child_last_name, child_dob,
                                     candidate_name, application_no, status, form_id, form_snapshot, data, submitted_at,
                                     registered_at, contact_mobile, contact_email, admission_no)
           VALUES ($1, $2, $3, $4, $5, 'MOVER', '2016-05-0${String(i + 1)}', $5 || ' MOVER', $6, $7, $8, $9::jsonb, '{}'::jsonb,
                   now(), now(), $10, $11, $12)
           RETURNING id::text`,
          [
            alpha.id,
            aLine.cycle,
            ids.aSix,
            ap.rows[0]!.id,
            name,
            `APP/${s}/${String(i + 1).padStart(4, '0')}`,
            status,
            aLine.form,
            JSON.stringify(formDef),
            mobile,
            `${name.toLowerCase()}@example.invalid`,
            status === 'fee_paid' || status === 'admitted' ? `ADM/${s}/${String(i + 1)}` : null,
          ],
        );
        const id = a.rows[0]!.id;
        apps[name] = id;
        // the photo and the answers as Alpha keeps them (the Aadhaar number encrypted)
        const key = `school-${alpha.id}/2026/10/admission-${id}-photo.png`;
        await storage.write(key, Buffer.from(`photo of ${name}`), 'image/png');
        const f = await c.query<{ id: string }>(
          `INSERT INTO files (school_id, bucket, object_key, content_type, size_bytes, original_name, owner_entity_type,
                              owner_entity_id, classification, storage_driver, status)
           VALUES ($1, $2, $3, 'image/png', 20, 'photo.png', 'application', $4, 'personal', $5, 'ready') RETURNING id::text`,
          [alpha.id, storage.bucket, key, id, storage.name],
        );
        ids[`photo-${name}`] = f.rows[0]!.id;
        await c.query(`UPDATE applications SET data = $2::jsonb WHERE id = $1`, [
          id,
          JSON.stringify({
            first_name: name,
            last_name: 'MOVER',
            dob: `2016-05-0${String(i + 1)}`,
            father_name: `FATHER OF ${name}`,
            mother: `MOTHER OF ${name}`,
            aadhaar: `enc:${encryptField('234567890124')}`,
            photo: [f.rows[0]!.id],
          }),
        ]);
        for (const [j, [head, amount]] of paid.entries())
          await c.query(
            `INSERT INTO misc_receipts (school_id, academic_year_id, financial_year_id, receipt_no, payer_kind, payer_name, head_id,
                                        amount, mode, application_id)
             VALUES ($1, $2, $3, $4, 'other', $5, $6, $7, 'cash', $8)`,
            [
              alpha.id,
              alpha.yearId,
              alpha.fyId,
              `R/${s}/${String(i)}${String(j)}`,
              name,
              heads[head],
              amount,
              id,
            ],
          );
      }
      // Beta already holds FARAH (the same child: name and date of birth)
      const bap = await c.query<{ id: string }>(
        `INSERT INTO applicants (school_id, mobile) VALUES ($1, '9000000001') RETURNING id::text`,
        [beta.id],
      );
      await c.query(
        `INSERT INTO applications (school_id, cycle_id, class_id, applicant_id, child_first_name, child_dob, candidate_name,
                                   application_no, status, form_id, data, submitted_at, registered_at)
         VALUES ($1, $2, $3, $4, 'FARAH', '2016-05-06', 'FARAH MOVER', $5, 'registered', $6, '{}'::jsonb, now(), now())`,
        [
          beta.id,
          ids[`cycle-${beta.id}`],
          ids.bOne,
          bap.rows[0]!.id,
          `APP/${s}/B1`,
          ids['form-b1'],
        ],
      );
    });
  });
  afterAll(async () => app.close());

  it('lists the group’s other schools; a school outside the group is refused', async () => {
    const t = await A('GET', '/admissions/moves/targets');
    expect(t.statusCode).toBe(200);
    expect(t.json().data).toEqual([{ id: beta.id, code: `${s}B`, name: `${s}B` }]);
    const x = await A('POST', `/admissions/registrations/${apps.ASHA!}/move`, {
      toSchoolId: outsider.id,
      reason: 'Wrong school',
    });
    expect(x.statusCode).toBe(400);
    expect(x.json().type).toBe('admissions.move.unknown_school');
  });

  it('refuses an admitted candidate and asks for a reason', async () => {
    const dev = await A('POST', `/admissions/registrations/${apps.DEV!}/move`, {
      toSchoolId: beta.id,
      reason: 'Wrong school',
    });
    expect(dev.statusCode).toBe(409);
    expect(dev.json().detail).toContain('Transfers between schools');
    expect(
      (
        await A('POST', `/admissions/registrations/${apps.ASHA!}/move`, {
          toSchoolId: beta.id,
          reason: 'x',
        })
      ).statusCode,
    ).toBe(400);
  });

  it('sends a registration: both schools see it, an outsider does not; one open move at a time', async () => {
    for (const name of ['ASHA', 'BALU', 'CHITRA', 'ESHA', 'FARAH', 'GITA']) {
      const r = await A('POST', `/admissions/registrations/${apps[name]!}/move`, {
        toSchoolId: beta.id,
        reason: `${name} registered in Alpha by mistake`,
      });
      expect(r.statusCode).toBe(201);
      moves[name] = r.json().id as string;
    }
    const again = await A('POST', `/admissions/registrations/${apps.ASHA!}/move`, {
      toSchoolId: beta.id,
      reason: 'Twice',
    });
    expect(again.statusCode).toBe(409);
    const out = (await A('GET', '/admissions/moves?box=outgoing')).json();
    expect(out.waiting).toEqual({ incoming: 0, outgoing: 6 });
    const chitra = out.data.find((m: { id: string }) => m.id === moves.CHITRA);
    expect(chitra).toMatchObject({
      direction: 'outgoing',
      status: 'requested',
      candidate: 'CHITRA MOVER',
      fromSchool: `${s}A`,
      toSchool: `${s}B`,
      applicationId: apps.CHITRA,
      money: { paid: 5500, registration: 500, admission: 5000 },
      carries: { files: 1, login: true },
      details: null,
    });
    const inc = await B('GET', `/admissions/moves/${moves.ASHA!}`);
    expect(inc.json()).toMatchObject({
      direction: 'incoming',
      applicationId: null,
      details: { dob: '2016-05-01', mobile: ids['mobile-ASHA'] },
    });
    // the family's answers stay out of the list (only counts and the fees)
    expect(JSON.stringify(inc.json())).not.toContain('234567890124');
    expect(
      (await call(as(adminX, outsider), 'GET', `/admissions/moves/${moves.ASHA!}`)).statusCode,
    ).toBe(404);
    // a line in Alpha's history
    const reg = (await A('GET', `/admissions/registrations/${apps.ASHA!}`)).json();
    expect(reg.moves[0]).toMatchObject({ status: 'requested', direction: 'outgoing' });
  });

  it('previews without keeping anything; the first school cannot accept its own move', async () => {
    const before = await withMigrator(
      async (c) =>
        (
          await c.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM applications WHERE school_id = $1`,
            [beta.id],
          )
        ).rows[0]!.n,
    );
    const p = await B('POST', `/admissions/moves/${moves.ASHA!}/preview`, {
      cycleId: ids[`cycle-${beta.id}`],
      classId: ids.bSix,
    });
    expect(p.statusCode).toBe(201);
    expect(p.json()).toMatchObject({
      preview: true,
      fee: 500,
      carried: 500,
      toRegistration: 500,
      differenceDue: 0,
      credit: 0,
      missing: ['Blood group'],
      className: 'Class VI',
    });
    const after = await withMigrator(
      async (c) =>
        (
          await c.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM applications WHERE school_id = $1`,
            [beta.id],
          )
        ).rows[0]!.n,
    );
    expect(after).toBe(before);
    const opts = (await B('GET', `/admissions/moves/${moves.ASHA!}/options`)).json();
    expect(opts.suggested).toEqual({ cycleId: ids[`cycle-${beta.id}`], classId: ids.bSix });
    expect(
      (
        await A('POST', `/admissions/moves/${moves.ASHA!}/accept`, {
          cycleId: ids[`cycle-${beta.id}`],
          classId: ids.bSix,
        })
      ).statusCode,
    ).toBe(404);
  });

  it('equal fee: registered there at once with the copy; the old one cancelled with a transfer-out line', async () => {
    const r = await B('POST', `/admissions/moves/${moves.ASHA!}/accept`, {
      cycleId: ids[`cycle-${beta.id}`],
      classId: ids.bSix,
      note: 'Seat available',
    });
    expect(r.statusCode).toBe(201);
    const newId = r.json().applicationId as string;
    apps.ASHA_B = newId;
    expect(r.json()).toMatchObject({
      status: 'accepted',
      money: { carried: 500, toRegistration: 500, differenceDue: 0, credit: 0 },
      missing: ['blood_group'],
    });
    const b = await appRow(newId);
    expect(b.school_id).toBe(beta.id);
    expect(b.application_no).toBeTruthy();
    expect(r.json().newNumber).toBe(b.application_no);
    // registered, then sent to the family for the answer Beta's form needs
    expect(b.status).toBe('sent_back');
    expect(b.data).toMatchObject({
      first_name: 'ASHA',
      father_name: 'FATHER OF ASHA',
      mother_full: 'MOTHER OF ASHA',
    });
    expect(String(b.data.aadhaar)).toMatch(/^enc:/);
    expect(decryptField(String(b.data.aadhaar).slice(4))).toBe('234567890124');
    // the photo's bytes copied into Beta's storage, owned by the new registration
    const photo = (b.data.photo as string[])[0]!;
    expect(photo).not.toBe(ids['photo-ASHA']);
    const f = await withMigrator(
      async (c) =>
        (
          await c.query<{ school_id: string; owner: string; key: string }>(
            `SELECT school_id::text, owner_entity_id::text AS owner, object_key AS key FROM files WHERE id = $1`,
            [photo],
          )
        ).rows[0]!,
    );
    expect(f).toMatchObject({ school_id: beta.id, owner: newId });
    expect((await app.get<StorageDriver>(STORAGE_DRIVER).read(f.key)).toString()).toBe(
      'photo of ASHA',
    );
    // the family's login: Beta's applicant with the same mobile
    const login = await withMigrator(
      async (c) =>
        (
          await c.query<{ school_id: string; mobile: string }>(
            `SELECT school_id::text, mobile FROM applicants WHERE id = $1`,
            [b.applicant_id],
          )
        ).rows[0]!,
    );
    expect(login).toEqual({ school_id: beta.id, mobile: ids['mobile-ASHA'] });
    // the money: a receipt of mode transfer in Beta for the registration fee
    const rec = await withMigrator(
      async (c) =>
        (
          await c.query<{ mode: string; amount: string; label: string; reference: string }>(
            `SELECT mode, amount::text, mode_label AS label, reference FROM misc_receipts WHERE application_id = $1`,
            [newId],
          )
        ).rows,
    );
    expect(rec).toEqual([
      {
        mode: 'transfer',
        amount: '500.00',
        label: 'Inter-school transfer',
        reference: `Move ${moves.ASHA!} from ${s}A`,
      },
    ]);
    // Alpha: cancelled "Moved to …", its receipt closed by a transfer-out line (Fees → Refunds)
    const a = await appRow(apps.ASHA!);
    expect(a.status).toBe('cancelled');
    expect(a.cancel_reason).toBe(
      `Moved to ${s}B (registration ${b.application_no!}): ASHA registered in Alpha by mistake`,
    );
    const refunds = (await A('GET', '/admissions/refunds?status=paid')).json().data as Array<{
      applicationId: string;
      amount: number;
      mode: string;
      reference: string;
    }>;
    expect(refunds.find((x) => x.applicationId === apps.ASHA)).toMatchObject({
      amount: 500,
      mode: 'transfer',
      reference: `Move ${moves.ASHA!} to ${s}B`,
    });
    // the correction asked and the family told (Beta's messages)
    const told = await withMigrator(
      async (c) =>
        (
          await c.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM comms_messages WHERE school_id = $1`,
            [beta.id],
          )
        ).rows[0]!.n,
    );
    expect(told).toBeGreaterThan(0);
    const reg = (await B('GET', `/admissions/registrations/${newId}`)).json();
    expect(reg.corrections[0]).toMatchObject({ fields: ['blood_group'], status: 'open' });
    expect(reg.moves[0]).toMatchObject({
      direction: 'incoming',
      fromSchool: `${s}A`,
      carried: 500,
    });
    // decided: no second accept
    expect(
      (
        await B('POST', `/admissions/moves/${moves.ASHA!}/accept`, {
          cycleId: ids[`cycle-${beta.id}`],
          classId: ids.bSix,
        })
      ).statusCode,
    ).toBe(409);
  });

  it('a higher fee waits for the difference; no registration number until it is paid', async () => {
    const r = await B('POST', `/admissions/moves/${moves.BALU!}/accept`, {
      cycleId: ids[`cycle-${beta.id}`],
      classId: ids.bSeven,
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      money: { carried: 500, toRegistration: 500, differenceDue: 300, credit: 0 },
      newNumber: null,
      to: { number: null, className: 'Class VII' },
    });
    const b = await appRow(r.json().applicationId as string);
    expect(b).toMatchObject({
      status: 'submitted',
      application_no: null,
      registration_fee: '300.00',
    });
    expect((await appRow(apps.BALU!)).cancel_reason).toBe(
      `Moved to ${s}B: BALU registered in Alpha by mistake`,
    );
    // Accounts take the difference at the counter: the registration number then
    const paid = await call(
      as(acctB, beta),
      'POST',
      `/fees/admission-counter/${r.json().applicationId as string}/collect`,
      { kind: 'registration', mode: 'cash' },
    );
    expect(paid.statusCode).toBe(201);
    expect(paid.json().number).toBeTruthy();
    expect(await appRow(r.json().applicationId as string)).toMatchObject({ status: 'registered' });
    // the move shows the number in both schools
    expect((await A('GET', `/admissions/moves/${moves.BALU!}`)).json().to).toMatchObject({
      number: paid.json().number,
    });
  });

  it('a lower fee leaves credit that pays the admission fee when admission is offered', async () => {
    const r = await B('POST', `/admissions/moves/${moves.CHITRA!}/accept`, {
      cycleId: ids[`cycle-${beta.id}`],
      classId: ids.bOne,
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().money).toMatchObject({
      carried: 5500,
      toRegistration: 300,
      differenceDue: 0,
      credit: 5200,
    });
    const newId = r.json().applicationId as string;
    expect(await appRow(newId)).toMatchObject({ status: 'registered', transfer_credit: '5200.00' });
    // each of Alpha's three receipts closed
    const lines = await withMigrator(
      async (c) =>
        (
          await c.query<{ amount: string; mode: string; status: string }>(
            `SELECT amount::text, mode, status FROM admission_refunds WHERE application_id = $1 ORDER BY receipt_id`,
            [apps.CHITRA],
          )
        ).rows,
    );
    expect(lines).toEqual([
      { amount: '500.00', mode: 'transfer', status: 'paid' },
      { amount: '3000.00', mode: 'transfer', status: 'paid' },
      { amount: '2000.00', mode: 'transfer', status: 'paid' },
    ]);
    // the offer: the credit pays the admission fee of 4000 at once, 1200 left
    await withMigrator((c) =>
      c.query(`UPDATE applications SET status = 'waitlisted' WHERE id = $1`, [newId]),
    );
    const offer = await B(
      'POST',
      `/admissions/cycles/${ids[`cycle-${beta.id}`]!}/selection/offer`,
      {
        applicationIds: [newId],
      },
    );
    expect(offer.statusCode).toBe(201);
    const after = await appRow(newId);
    expect(after).toMatchObject({ status: 'fee_paid', transfer_credit: '1200.00' });
    expect(after.admission_no).toBeTruthy();
    const adm = await withMigrator(
      async (c) =>
        (
          await c.query<{ amount: string; mode: string }>(
            `SELECT m.amount::text, m.mode FROM misc_receipts m JOIN fee_heads h ON h.id = m.head_id
            WHERE m.application_id = $1 AND h.code = 'ADMFEE'`,
            [newId],
          )
        ).rows,
    );
    expect(adm).toEqual([{ amount: '4000.00', mode: 'transfer' }]);
    expect((await B('GET', `/admissions/registrations/${newId}`)).json().credit).toBe(1200);
    // nothing left to use on it (Accounts use credit; the admission office may not take money)
    expect((await B('POST', `/admissions/registrations/${newId}/use-credit`)).statusCode).toBe(403);
    expect(
      (await call(as(acctB, beta), 'POST', `/admissions/registrations/${newId}/use-credit`))
        .statusCode,
    ).toBe(409);
  });

  it('refused: nothing changes in the first school; withdrawn by the first school', async () => {
    expect(
      (await B('POST', `/admissions/moves/${moves.ESHA!}/refuse`, { note: 'x' })).statusCode,
    ).toBe(400);
    const no = await B('POST', `/admissions/moves/${moves.ESHA!}/refuse`, {
      note: 'Class full here',
    });
    expect(no.statusCode).toBe(201);
    expect(no.json()).toMatchObject({ status: 'refused', decisionNote: 'Class full here' });
    expect((await appRow(apps.ESHA!)).status).toBe('under_review');
    // asked again, then withdrawn by Alpha (Beta cannot withdraw Alpha's move)
    const again = await A('POST', `/admissions/registrations/${apps.ESHA!}/move`, {
      toSchoolId: beta.id,
      reason: 'Asked again',
    });
    expect(again.statusCode).toBe(201);
    expect(
      (
        await B('POST', `/admissions/moves/${again.json().id as string}/withdraw`, {
          note: 'Not ours',
        })
      ).statusCode,
    ).toBe(404);
    const w = await A('POST', `/admissions/moves/${again.json().id as string}/withdraw`, {
      note: 'The family stays',
    });
    expect(w.json()).toMatchObject({ status: 'withdrawn' });
    expect((await appRow(apps.ESHA!)).status).toBe('under_review');
  });

  it('the same child already registered there, or money taken meanwhile, stops the accept', async () => {
    const dup = await B('POST', `/admissions/moves/${moves.FARAH!}/accept`, {
      cycleId: ids[`cycle-${beta.id}`],
      classId: ids.bOne,
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().type).toBe('admissions.move.duplicate');
    expect((await appRow(apps.FARAH!)).status).toBe('registered');
    // Alpha took a part of GITA's admission fee after asking
    await withMigrator((c) =>
      c.query(
        `INSERT INTO misc_receipts (school_id, academic_year_id, financial_year_id, receipt_no, payer_kind, payer_name, head_id,
                                    amount, mode, application_id)
         SELECT $1, $2, $3, $4, 'other', 'GITA', id, 1000, 'cash', $5 FROM fee_heads WHERE school_id = $1 AND code = 'ADMFEE'`,
        [alpha.id, alpha.yearId, alpha.fyId, `R/${s}/G2`, apps.GITA],
      ),
    );
    const late = await B('POST', `/admissions/moves/${moves.GITA!}/accept`, {
      cycleId: ids[`cycle-${beta.id}`],
      classId: ids.bOne,
    });
    expect(late.statusCode).toBe(409);
    expect(late.json().type).toBe('admissions.move.money_changed');
    expect((await appRow(apps.GITA!)).status).toBe('offered');
    expect((await B('GET', `/admissions/moves/${moves.GITA!}`)).json().status).toBe('requested');
  });

  it('keeps a register of moves in both schools (Excel and PDF)', async () => {
    const list = (await B('GET', '/admissions/moves?box=all')).json();
    expect(list.data.filter((m: { status: string }) => m.status === 'accepted')).toHaveLength(3);
    for (const [who, format, magic] of [
      [A, 'xlsx', 'PK'],
      [B, 'pdf', '%PDF'],
    ] as const) {
      const r = await who('GET', `/admissions/moves/export?format=${format}`);
      expect(r.statusCode).toBe(200);
      expect(
        Buffer.from(r.json().base64 as string, 'base64')
          .subarray(0, magic.length)
          .toString(),
      ).toBe(magic);
    }
  });
});
