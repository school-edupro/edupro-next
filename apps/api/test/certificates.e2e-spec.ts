/**
 * Certificate management, phase A (docs/design/87): the types made on first use; numbering per type and year under
 * concurrency, never reused; the checks and the principal's override (the right, a fresh MFA sign-in, the reason
 * recorded); duplicates and cancels; the frozen paper (a later template or record change does not change it); the TC
 * issued through the register from the register and the profile; the register's filters, figures and files.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { CacheService } from '../src/common/cache/cache.service';
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

interface Cert {
  id: string;
  number: string;
  copyNo: number;
  status: string;
  bookNo: number | null;
  slNo: number | null;
  overrideReason: string | null;
  exportId: string | null;
  transferCertificateId: string | null;
  checks: Array<{ key: string; ok: boolean; detail: string }>;
}

describe('certificate register (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let other: SeededSchool;
  let admin: SeededUser;
  let office: SeededUser;
  let teacher: SeededUser;
  let outsider: SeededUser;
  let section: string;
  const pupils: Record<string, string> = {};
  let bonafide: Cert;
  let tc: Cert;

  const h = (u: SeededUser = admin, extra: Record<string, string> = {}) =>
    headersFor(u.sub, school.id, extra);
  const issue = (json: Record<string, unknown>, u: SeededUser = admin, extra = {}) =>
    inject({ method: 'POST', url: '/certificates/issue', headers: h(u, extra), json });

  beforeAll(async () => {
    const s = stamp('CRT');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      other = await seedSchool(c, `${s}B`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      office = await seedUser(c, school, `${s}-office`, 'certificate_office');
      teacher = await seedUser(c, school, `${s}-teacher`);
      outsider = await seedUser(c, other, `${s}-outsider`, 'school_admin');
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'VIII', name: 'Class VIII', displayOrder: 8 },
    });
    const sec = await inject({
      method: 'POST',
      url: `/academics/classes/${cls.json().id}/sections`,
      headers: h(),
      json: { name: 'A' },
    });
    section = sec.json().id;
    let roll = 1;
    for (const [key, first, gender] of [
      ['asha', 'Asha', 'female'],
      ['bina', 'Bina', 'female'],
      ['chet', 'Chetan', 'male'],
      ['dev', 'Dev', 'male'],
      ['esha', 'Esha', 'female'],
    ] as const) {
      const r = await inject({
        method: 'POST',
        url: '/people/students',
        headers: h(),
        json: {
          admissionNo: `${s}-${key}`,
          firstName: first,
          lastName: 'Test',
          dob: '2013-03-09',
          gender,
          guardians: [
            {
              guardian: {
                firstName: 'Ravi',
                lastName: 'Test',
                mobile: `98765${String(40000 + roll)}`,
              },
              relation: 'father',
              isPrimary: true,
            },
          ],
          enrolment: { classSectionId: section, rollNo: roll++ },
        },
      });
      if (r.statusCode !== 201) throw new Error(`student ${key}: ${r.statusCode} ${r.body}`);
      pupils[key] = r.json().id as string;
    }
    // Esha left the school earlier
    await withMigrator((c) =>
      c.query(`UPDATE students SET status = 'inactive', left_on = '2026-06-30' WHERE id = $1`, [
        pupils.esha,
      ]),
    );
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('makes the types and their ready templates on first use, with the fields each asks for', async () => {
    const r = await inject({ method: 'GET', url: '/certificates/types', headers: h() });
    expect(r.statusCode).toBe(200);
    const types = r.json().rows as Array<{
      code: string;
      template: string | null;
      usesBook: boolean;
      multiple: string;
      fields: Array<{ key: string }>;
    }>;
    expect(types.map((t) => t.code).slice(0, 4)).toEqual(['TC', 'BONAFIDE', 'CHARACTER', 'DOB']);
    expect(types).toHaveLength(21);
    expect(types.every((t) => t.template)).toBe(true);
    const tcType = types.find((t) => t.code === 'TC')!;
    expect(tcType).toMatchObject({ usesBook: true, multiple: 'ONE' });
    expect(tcType.fields.map((f) => f.key)).toEqual(
      expect.arrayContaining([
        'reason',
        'workingDays',
        'daysPresent',
        'subjects',
        'conduct',
        'struckOffDate',
      ]),
    );
    expect(r.json().can).toMatchObject({ issue: true, cancel: true, override: true, setup: true });
    // the office: issue and cancel, not override; a teacher: nothing; another school sees its own
    const officeTypes = await inject({
      method: 'GET',
      url: '/certificates/types',
      headers: h(office),
    });
    expect(officeTypes.json().can).toMatchObject({ issue: true, cancel: true, override: false });
    const t = await inject({ method: 'GET', url: '/certificates', headers: h(teacher) });
    expect(t.statusCode).toBe(403);
    // the issue screen finds students on the rolls and past ones
    const found = await inject({
      method: 'GET',
      url: '/certificates/students?q=sha',
      headers: h(office),
    });
    expect(found.json().rows.map((x: { name: string; left: boolean }) => [x.name, x.left])).toEqual(
      [
        ['Asha Test', false],
        ['Esha Test', true],
      ],
    );
    // one letter narrows the dropdown too (16 Nov 2026: the issue page lists as you type)
    const short = await inject({
      method: 'GET',
      url: '/certificates/students?q=a',
      headers: h(office),
    });
    expect(short.statusCode).toBe(200);
  });

  it('lists the people to issue to: empty in class order, by class, those the type wants first', async () => {
    const all = await inject({ method: 'GET', url: '/certificates/students', headers: h(office) });
    expect(all.statusCode).toBe(200);
    const rows = all.json().rows as Array<{ id: string; left: boolean; className: string | null }>;
    expect(rows.length).toBeGreaterThan(2);
    // on the rolls first (Esha has left)
    expect(rows[0]!.left).toBe(false);
    const byClass = await inject({
      method: 'GET',
      url: '/certificates/students?q=VIII-A',
      headers: h(office),
    });
    expect(
      (byClass.json().rows as Array<{ className: string }>).every(
        (r) => r.className === 'Class VIII – A',
      ),
    ).toBe(true);
    // a TC wants those who have left first
    const forTc = await inject({
      method: 'GET',
      url: '/certificates/students?type=TC',
      headers: h(office),
    });
    expect((forTc.json().rows as Array<{ id: string }>)[0]!.id).toBe(pupils.esha);
    const staff = await inject({
      method: 'GET',
      url: '/certificates/employees',
      headers: h(office),
    });
    expect(staff.statusCode).toBe(200);
  });

  it('previews a bonafide (checks, fields, the paper) without saving anything', async () => {
    const p = await inject({
      method: 'POST',
      url: '/certificates/preview',
      headers: h(office),
      json: { typeCode: 'BONAFIDE', studentId: pupils.asha, purpose: 'Bank account' },
    });
    expect(p.statusCode).toBe(201);
    expect(p.json()).toMatchObject({
      failed: 0,
      held: false,
      student: { className: 'Class VIII', section: 'A' },
    });
    const html = p.json().html as string;
    expect(html).toContain('Bonafide certificate');
    expect(html).toContain('Asha Test');
    expect(html).toContain('daughter of');
    expect(html).toContain('Ninth March two thousand thirteen');
    expect(html).toContain('BON/2026-27/(next)');
    const list = await inject({ method: 'GET', url: '/certificates', headers: h() });
    expect(list.json().total).toBe(0);
  });

  it('numbers per type and year, one at a time under load, and never twice', async () => {
    const first = await issue(
      { typeCode: 'BONAFIDE', studentId: pupils.asha, purpose: 'Bank account' },
      office,
    );
    expect(first.statusCode).toBe(201);
    bonafide = first.json() as Cert;
    expect(bonafide).toMatchObject({
      number: 'BON/2026-27/00001',
      copyNo: 0,
      status: 'issued',
      bookNo: null,
    });
    expect(bonafide.exportId).toMatch(/^\d+$/);
    // eight at once (two pupils, two types): every number taken once, each series counting on its own
    const many = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        issue(
          { typeCode: i % 2 ? 'DOB' : 'BONAFIDE', studentId: i < 4 ? pupils.bina : pupils.chet },
          office,
        ),
      ),
    );
    expect(many.map((r) => r.statusCode)).toEqual(Array(8).fill(201));
    const bon = many.filter((_, i) => i % 2 === 0).map((r) => (r.json() as Cert).number);
    const dob = many.filter((_, i) => i % 2 === 1).map((r) => (r.json() as Cert).number);
    expect(bon.sort()).toEqual([
      'BON/2026-27/00002',
      'BON/2026-27/00003',
      'BON/2026-27/00004',
      'BON/2026-27/00005',
    ]);
    expect(dob.sort()).toEqual([
      'DOB/2026-27/00001',
      'DOB/2026-27/00002',
      'DOB/2026-27/00003',
      'DOB/2026-27/00004',
    ]);
    // a cancelled number is not given again
    const cancel = await inject({
      method: 'POST',
      url: `/certificates/${(many[0]!.json() as Cert).id}/cancel`,
      headers: h(office),
      json: { reason: 'Issued in error' },
    });
    expect(cancel.json()).toMatchObject({ status: 'cancelled' });
    const next = await issue({ typeCode: 'BONAFIDE', studentId: pupils.bina }, office);
    expect((next.json() as Cert).number).toBe('BON/2026-27/00006');
  });

  it('stops a certificate whose checks fail; the principal issues it with a reason (fresh MFA, recorded)', async () => {
    // a bonafide is for a student on the rolls: Esha has left
    const stopped = await issue({ typeCode: 'BONAFIDE', studentId: pupils.esha }, office);
    expect(stopped.statusCode).toBe(409);
    expect(stopped.json()).toMatchObject({ type: 'certificate.checks_failed' });
    expect(stopped.json().checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'state', ok: false })]),
    );
    // the office has no override
    const officeOverride = await issue(
      {
        typeCode: 'BONAFIDE',
        studentId: pupils.esha,
        overrideReason: 'Needed for the scholarship form',
      },
      office,
    );
    expect(officeOverride.statusCode).toBe(403);
    // the principal, but without a fresh multi-factor sign-in
    const stale = await inject({
      method: 'POST',
      url: '/certificates/issue',
      headers: { ...h(), authorization: `Bearer dev:${admin.sub};mfa=false` },
      json: {
        typeCode: 'BONAFIDE',
        studentId: pupils.esha,
        overrideReason: 'Needed for the scholarship form',
      },
    });
    expect(stale.statusCode).toBe(403);
    expect(stale.json()).toMatchObject({ type: 'mfa-required' });
    const short = await issue({
      typeCode: 'BONAFIDE',
      studentId: pupils.esha,
      overrideReason: 'ok',
    });
    expect(short.statusCode).toBe(400);
    const ok = await issue({
      typeCode: 'BONAFIDE',
      studentId: pupils.esha,
      overrideReason: 'Needed for the scholarship form',
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ overrideReason: 'Needed for the scholarship form' });
    expect((ok.json() as Cert).checks.find((x) => x.key === 'state')).toMatchObject({ ok: false });
    // a character certificate is for any student, past or present
    const ch = await issue(
      { typeCode: 'CHARACTER', studentId: pupils.esha, fields: { conduct: 'Very good' } },
      office,
    );
    expect(ch.statusCode).toBe(201);
    const badList = await issue(
      { typeCode: 'CHARACTER', studentId: pupils.esha, fields: { conduct: 'Wonderful' } },
      office,
    );
    expect(badList.statusCode).toBe(400);
  });

  it('issues the TC from the register: its checks, the book Sl. No., the student off the rolls', async () => {
    // Dev still uses the school bus, and has no withdrawal
    await withMigrator((c) =>
      c.query(
        `INSERT INTO student_transport (school_id, student_id, academic_year_id, service, from_month, to_month, status)
         SELECT $1, $2, id, 'both', '2026-04-01', '2027-03-01', 'active' FROM academic_years WHERE school_id = $1 AND code = '2026-27'`,
        [school.id, pupils.dev],
      ),
    );
    const fields = {
      reason: 'Family moving to another city',
      conduct: 'Good',
      examResult: 'Class VII, passed',
    };
    const stopped = await issue({ typeCode: 'TC', studentId: pupils.dev, fields });
    expect(stopped.statusCode).toBe(409);
    const failed = (stopped.json().checks as Cert['checks']).filter((x) => !x.ok).map((x) => x.key);
    expect(failed.sort()).toEqual(['state', 'transport']);
    const missing = await issue({
      typeCode: 'TC',
      studentId: pupils.dev,
      fields: { conduct: 'Good' },
    });
    expect(missing.statusCode).toBe(400);
    const r = await issue({
      typeCode: 'TC',
      studentId: pupils.dev,
      fields,
      overrideReason: 'Transport ends with the month; parents asked in writing',
    });
    expect(r.statusCode).toBe(201);
    tc = r.json() as Cert;
    expect(tc).toMatchObject({ number: 'TC/2026-27/00001', bookNo: 1, slNo: 1 });
    expect(tc.transferCertificateId).toMatch(/^\d+$/);
    const student = await inject({
      method: 'GET',
      url: `/people/students/${pupils.dev}`,
      headers: h(),
    });
    expect(student.json().status).toBe('inactive');
    // the TC's own list shows it under the same number
    const tcs = await inject({
      method: 'GET',
      url: `/people/students/${pupils.dev}/tc`,
      headers: h(),
    });
    expect(tcs.json().data[0]).toMatchObject({
      tcNo: 'TC/2026-27/00001',
      status: 'issued',
      lastClass: 'VIII-A',
    });
    // what it printed is frozen: the 24 fields' data
    const d = await inject({ method: 'GET', url: `/certificates/${tc.id}`, headers: h() });
    expect(d.json().data.tc).toMatchObject({
      reason: 'Family moving to another city',
      examResult: 'Class VII, passed',
      lastClass: 'Class VIII – A',
      lastClassWords: 'Eighth',
      failed: 'No',
    });
    expect(d.json().data.student).toMatchObject({
      dobWords: 'Ninth March two thousand thirteen',
      fatherName: 'Ravi Test',
    });
    // one live TC a student: a second is refused even by the principal
    const again = await issue({
      typeCode: 'TC',
      studentId: pupils.dev,
      fields,
      overrideReason: 'Trying a second one',
    });
    expect(again.statusCode).toBe(409);
    const ex = await inject({
      method: 'GET',
      url: `/reports/exports/${tc.exportId}`,
      headers: h(),
    });
    expect(ex.json().export.dataset).toBe('certificate_doc');
  });

  it('issues the TC from the profile through the same register, the Sl. No. counting on', async () => {
    const r = await inject({
      method: 'POST',
      url: `/people/students/${pupils.chet}/tc`,
      headers: h(),
      json: {
        reason: 'Admission elsewhere',
        conduct: 'Good',
        fields: { workingDays: 180, daysPresent: 171 },
        overrideReason: 'Withdrawal signed by the parents at the desk',
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ tcNo: 'TC/2026-27/00002' });
    const reg = await inject({ method: 'GET', url: '/certificates?type=TC', headers: h() });
    const row = (reg.json().rows as Cert[]).find((x) => x.number === 'TC/2026-27/00002')!;
    expect(row).toMatchObject({ bookNo: 1, slNo: 2, transferCertificateId: r.json().id });
    expect(row.overrideReason).toContain('Withdrawal signed');
    const d = await inject({ method: 'GET', url: `/certificates/${row.id}`, headers: h() });
    expect(d.json().data.tc).toMatchObject({
      workingDays: 180,
      daysPresent: 171,
      reason: 'Admission elsewhere',
    });
  });

  it('prints a duplicate: the same number and paper, copy 1, 2 …', async () => {
    const d1 = await inject({
      method: 'POST',
      url: `/certificates/${tc.id}/duplicate`,
      headers: h(office),
      json: { reason: 'Original lost by the parents' },
    });
    expect(d1.statusCode).toBe(201);
    expect(d1.json()).toMatchObject({
      number: tc.number,
      copyNo: 1,
      bookNo: 1,
      slNo: 1,
      status: 'issued',
    });
    // a duplicate of the duplicate is a copy of the original
    const d2 = await inject({
      method: 'POST',
      url: `/certificates/${(d1.json() as Cert).id}/duplicate`,
      headers: h(office),
      json: { reason: 'Second copy for the new school' },
    });
    expect(d2.json()).toMatchObject({ number: tc.number, copyNo: 2 });
    const detail = await inject({ method: 'GET', url: `/certificates/${tc.id}`, headers: h() });
    expect(detail.json().copies.map((x: Cert) => x.copyNo)).toEqual([0, 1, 2]);
  });

  it('opens its PDF: the one kept for good, or made again once when it was cleared', async () => {
    const first = await inject({
      method: 'POST',
      url: `/certificates/${bonafide.id}/pdf`,
      headers: h(office),
    });
    expect(first.statusCode).toBe(201);
    const exportId = first.json().exportId as string;
    expect(first.json()).toMatchObject({ ready: false });
    const kept = await withMigrator((c) =>
      c.query<{ far: boolean }>(
        `SELECT expires_at > now() + interval '50 years' AS far FROM exports WHERE id = $1`,
        [exportId],
      ),
    );
    expect(kept.rows[0]!.far).toBe(true);
    // cleared (as before 16 Nov, after seven days): made again, and the register points to it. With the workers
    // running the first PDF may still be being made: let it settle, so they do not mark it ready after this
    for (let i = 0; i < 20; i += 1) {
      const st = await withMigrator((c) =>
        c.query<{ status: string }>(`SELECT status::text FROM exports WHERE id = $1`, [exportId]),
      );
      if (!['queued', 'running'].includes(st.rows[0]!.status) || i === 19) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    await withMigrator((c) =>
      c.query(
        `UPDATE exports SET status = 'expired', expires_at = now() - interval '1 day' WHERE id = $1`,
        [exportId],
      ),
    );
    const again = await inject({
      method: 'POST',
      url: `/certificates/${bonafide.id}/pdf`,
      headers: h(office),
    });
    expect(again.json().exportId).not.toBe(exportId);
    expect(again.json()).toMatchObject({ ready: false });
    const row = await inject({ method: 'GET', url: `/certificates/${bonafide.id}`, headers: h() });
    expect(row.json().exportId).toBe(again.json().exportId);
    // while it is being made, the same one; ready, it opens
    const twice = await inject({
      method: 'POST',
      url: `/certificates/${bonafide.id}/pdf`,
      headers: h(office),
    });
    expect(twice.json().exportId).toBe(again.json().exportId);
    await withMigrator((c) =>
      c.query(`UPDATE exports SET status = 'ready' WHERE id = $1`, [again.json().exportId]),
    );
    const ready = await inject({
      method: 'POST',
      url: `/certificates/${bonafide.id}/pdf`,
      headers: h(office),
    });
    expect(ready.json()).toEqual({ exportId: again.json().exportId, ready: true });
    // one made before the QR: opened, it is made again once, with its QR
    await withMigrator((c) =>
      c.query(`UPDATE certificates SET data = data - 'qr' WHERE id = $1`, [bonafide.id]),
    );
    const withQr = await inject({
      method: 'POST',
      url: `/certificates/${bonafide.id}/pdf`,
      headers: h(office),
    });
    expect(withQr.json().ready).toBe(false);
    expect(withQr.json().exportId).not.toBe(again.json().exportId);
    const stamped = await withMigrator((c) =>
      c.query<{ has: boolean }>(`SELECT data ? 'qr' AS has FROM certificates WHERE id = $1`, [
        bonafide.id,
      ]),
    );
    expect(stamped.rows[0]!.has).toBe(true);
    // not another school's
    expect(
      (
        await inject({
          method: 'POST',
          url: `/certificates/${bonafide.id}/pdf`,
          headers: headersFor(outsider.sub, other.id),
        })
      ).statusCode,
    ).toBe(404);
  });

  it('keeps the paper it was made with when the template or the record changes later', async () => {
    const before = await withMigrator((c) =>
      c.query<{ template_version_id: string; name: string }>(
        `SELECT template_version_id::text, data->'student'->>'name' AS name FROM certificates WHERE id = $1`,
        [bonafide.id],
      ),
    );
    const tpl = await withMigrator((c) =>
      c.query<{ id: string }>(
        `SELECT template_id::text AS id FROM certificate_types WHERE school_id = $1 AND code = 'BONAFIDE'`,
        [school.id],
      ),
    );
    const patch = await inject({
      method: 'PATCH',
      url: `/platform/templates/${tpl.rows[0]!.id}`,
      headers: h(),
      json: {
        bodyHtml: '<div class="cert"><h2>Bonafide (new layout)</h2><p>{{student.name}}</p></div>',
      },
    });
    expect(patch.statusCode).toBe(200);
    await inject({
      method: 'PATCH',
      url: `/people/students/${pupils.asha}`,
      headers: h(),
      json: { firstName: 'Ashaa' },
    });
    const after = await withMigrator((c) =>
      c.query<{ template_version_id: string; name: string }>(
        `SELECT template_version_id::text, data->'student'->>'name' AS name FROM certificates WHERE id = $1`,
        [bonafide.id],
      ),
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect(after.rows[0]!.name).toBe('Asha Test');
    // a new one is made with the new version
    const fresh = await issue({ typeCode: 'BONAFIDE', studentId: pupils.asha }, office);
    const v = await withMigrator((c) =>
      c.query<{ template_version_id: string }>(
        `SELECT template_version_id::text FROM certificates WHERE id = $1`,
        [(fresh.json() as Cert).id],
      ),
    );
    expect(v.rows[0]!.template_version_id).not.toBe(before.rows[0]!.template_version_id);
    // the reprint of the old one is the old paper
    const again = await inject({
      method: 'POST',
      url: `/certificates/${bonafide.id}/render`,
      headers: h(),
    });
    expect(again.statusCode).toBe(201);
    expect(again.json().exportId).not.toBe(bonafide.exportId);
  });

  it('cancels a TC with its duplicates and its TC row; the number stays used', async () => {
    const c = await inject({
      method: 'POST',
      url: `/certificates/${tc.id}/cancel`,
      headers: h(office),
      json: { reason: 'Parents decided to stay' },
    });
    expect(c.json()).toMatchObject({ status: 'cancelled' });
    const detail = await inject({ method: 'GET', url: `/certificates/${tc.id}`, headers: h() });
    expect(detail.json().copies.map((x: Cert) => x.status)).toEqual([
      'cancelled',
      'cancelled',
      'cancelled',
    ]);
    const tcs = await inject({
      method: 'GET',
      url: `/people/students/${pupils.dev}/tc`,
      headers: h(),
    });
    expect(tcs.json().data[0]).toMatchObject({ status: 'cancelled' });
    const twice = await inject({
      method: 'POST',
      url: `/certificates/${tc.id}/cancel`,
      headers: h(office),
      json: { reason: 'again' },
    });
    expect(twice.statusCode).toBe(409);
    const dup = await inject({
      method: 'POST',
      url: `/certificates/${tc.id}/duplicate`,
      headers: h(office),
      json: { reason: 'Copy please' },
    });
    expect(dup.statusCode).toBe(409);
    // a TC cancelled from its own screen takes its register row with it
    const reg = await inject({
      method: 'GET',
      url: '/certificates?type=TC&status=issued',
      headers: h(),
    });
    const other = (reg.json().rows as Cert[])[0]!;
    await inject({
      method: 'POST',
      url: `/people/tc/${other.transferCertificateId}/cancel`,
      headers: h(),
      json: { reason: 'issued in error' },
    });
    const gone = await inject({ method: 'GET', url: `/certificates/${other.id}`, headers: h() });
    expect(gone.json().status).toBe('cancelled');
  });

  it('lists the register with filters, figures and pages, and gives it as Excel and PDF', async () => {
    const all = await inject({ method: 'GET', url: '/certificates?size=5', headers: h() });
    expect(all.statusCode).toBe(200);
    const total = all.json().total as number;
    expect(all.json().rows).toHaveLength(5);
    expect(all.json().figures).toMatchObject({ duplicates: 2 });
    expect(all.json().years).toEqual(['2026-27']);
    const dups = await inject({ method: 'GET', url: '/certificates?copy=duplicate', headers: h() });
    expect(dups.json().total).toBe(2);
    const over = await inject({ method: 'GET', url: '/certificates?override=yes', headers: h() });
    expect(over.json().total).toBe(3);
    const q = await inject({ method: 'GET', url: '/certificates?q=Bina', headers: h() });
    expect(q.json().total).toBe(5);
    const cancelled = await inject({
      method: 'GET',
      url: '/certificates?status=cancelled',
      headers: h(),
    });
    expect(cancelled.json().figures.cancelled).toBe(cancelled.json().total);
    const page2 = await inject({ method: 'GET', url: '/certificates?size=5&page=2', headers: h() });
    expect(page2.json().total).toBe(total);
    const mine = await inject({
      method: 'GET',
      url: `/certificates/student/${pupils.esha}`,
      headers: h(),
    });
    expect(mine.json().rows).toHaveLength(2);
    for (const format of ['xlsx', 'pdf']) {
      const f = await inject({
        method: 'GET',
        url: `/certificates/file?format=${format}&type=BONAFIDE`,
        headers: h(),
      });
      expect(f.statusCode).toBe(200);
      expect(f.json().filename).toMatch(new RegExp(`certificate-register.*\\.${format}$`));
      expect(Buffer.from(f.json().base64 as string, 'base64').length).toBeGreaterThan(500);
    }
    // another school sees none of it
    const outside = await inject({
      method: 'GET',
      url: `/certificates/${bonafide.id}`,
      headers: headersFor(outsider.sub, other.id),
    });
    expect(outside.statusCode).toBe(404);
  });

  it("re-issues with today's settings: a new number printed as things are now; the earlier one cancelled; once", async () => {
    const before = (
      await inject({ method: 'GET', url: `/certificates/${bonafide.id}`, headers: h() })
    ).json();
    expect(before.status).toBe('issued');
    // the school changes who signs after it was issued
    const set = await inject({
      method: 'PUT',
      url: '/certificates/setup/settings',
      headers: h(),
      json: {
        signatoryEmployeeId: null,
        signatoryTitle: 'Head of School',
        printSignature: false,
        printPreparer: true,
        footerNote: 'Not valid without the school seal',
      },
    });
    expect(set.statusCode).toBe(200);
    // not by someone who may not issue
    const refused = await inject({
      method: 'POST',
      url: `/certificates/${bonafide.id}/reissue`,
      headers: h(teacher),
      json: { reason: 'Signed by the new head' },
    });
    expect(refused.statusCode).toBe(403);
    const r = await inject({
      method: 'POST',
      url: `/certificates/${bonafide.id}/reissue`,
      headers: h(office),
      json: { reason: 'Signed by the new head' },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().number).not.toBe(bonafide.number);
    expect(r.json().number).toMatch(/^BON\//);
    expect(r.json()).toMatchObject({
      status: 'issued',
      reissueOf: { id: bonafide.id, number: bonafide.number },
      purpose: before.purpose,
    });
    const now = (
      await inject({ method: 'GET', url: `/certificates/${r.json().id as string}`, headers: h() })
    ).json();
    const titles = (now.data.signs as Array<{ title: string }>).map((x) => x.title);
    expect(titles).toContain('Head of School');
    expect(now.data.footerNote).toBe('Not valid without the school seal');
    // the earlier one: cancelled, pointing to the new one; it kept what it printed
    const old = (
      await inject({ method: 'GET', url: `/certificates/${bonafide.id}`, headers: h() })
    ).json();
    expect(old).toMatchObject({
      status: 'cancelled',
      reissuedAs: { id: r.json().id, number: r.json().number },
    });
    expect(old.cancelReason).toMatch(/^Re-issued with today's settings: Signed by the new head/);
    expect(old.data.signs).toEqual(before.data.signs);
    // once only; a duplicate is not re-issued on its own
    const twice = await inject({
      method: 'POST',
      url: `/certificates/${bonafide.id}/reissue`,
      headers: h(office),
      json: { reason: 'Again' },
    });
    expect(twice.statusCode).toBe(409);
    expect(twice.json()).toMatchObject({ type: 'certificate.already_reissued' });
    const tcCopies = (
      await inject({ method: 'GET', url: `/certificates/${tc.id}`, headers: h() })
    ).json().copies as Array<{ id: string; copyNo: number }>;
    const dup = tcCopies.find((x) => x.copyNo > 0)!;
    const ofDup = await inject({
      method: 'POST',
      url: `/certificates/${dup.id}/reissue`,
      headers: h(office),
      json: { reason: 'A copy' },
    });
    expect(ofDup.statusCode).toBe(400);
    // one issued past a failed check: the check still fails, so the principal's reason carries over — the office
    // (no override) is refused and nothing changes; the principal re-issues it
    const past = (
      await inject({
        method: 'GET',
        url: '/certificates?type=BONAFIDE&override=yes&status=issued',
        headers: h(),
      })
    ).json().rows[0] as { id: string; number: string };
    const noRight = await inject({
      method: 'POST',
      url: `/certificates/${past.id}/reissue`,
      headers: h(office),
      json: { reason: 'New signatory' },
    });
    expect(noRight.statusCode).toBe(403);
    expect(
      (await inject({ method: 'GET', url: `/certificates/${past.id}`, headers: h() })).json()
        .status,
    ).toBe('issued');
    const byPrincipal = await inject({
      method: 'POST',
      url: `/certificates/${past.id}/reissue`,
      headers: h(),
      json: { reason: 'New signatory' },
    });
    expect(byPrincipal.statusCode).toBe(201);
    expect(byPrincipal.json()).toMatchObject({
      overrideReason: 'Needed for the scholarship form',
      reissueOf: { id: past.id },
    });
  });

  it('re-issues with changes: the purpose, a typed detail and the date corrected; one-a-person is no bar', async () => {
    const ch = (
      await inject({
        method: 'GET',
        url: '/certificates?type=CHARACTER&status=issued&copy=original',
        headers: h(),
      })
    ).json().rows[0] as { id: string; number: string; studentId: string };
    // the type allows one a person: the student holds this one, but a re-issue replaces it
    await withMigrator((c) =>
      c.query(
        `UPDATE certificate_types SET multiple = 'ONE' WHERE school_id = $1 AND code = 'CHARACTER'`,
        [school.id],
      ),
    );
    const held = await inject({
      method: 'POST',
      url: '/certificates/preview',
      headers: h(office),
      json: { typeCode: 'CHARACTER', studentId: ch.studentId, fields: { conduct: 'Good' } },
    });
    expect(held.json().held).toBe(true);
    const aside = await inject({
      method: 'POST',
      url: '/certificates/preview',
      headers: h(office),
      json: {
        typeCode: 'CHARACTER',
        studentId: ch.studentId,
        fields: { conduct: 'Good' },
        reissueOf: ch.id,
      },
    });
    expect(aside.json().held).toBe(false);
    // a wrong value is refused and nothing changes
    const bad = await inject({
      method: 'POST',
      url: `/certificates/${ch.id}/reissue`,
      headers: h(office),
      json: { reason: 'Conduct typed wrong', fields: { conduct: 'Wonderful' } },
    });
    expect(bad.statusCode).toBe(400);
    expect(
      (await inject({ method: 'GET', url: `/certificates/${ch.id}`, headers: h() })).json().status,
    ).toBe('issued');
    const r = await inject({
      method: 'POST',
      url: `/certificates/${ch.id}/reissue`,
      headers: h(office),
      json: {
        reason: 'Conduct and purpose typed wrong',
        purpose: 'Scholarship form',
        fields: { conduct: 'Good' },
        issuedOn: '2026-11-01',
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      purpose: 'Scholarship form',
      issuedOn: '2026-11-01',
      reissueOf: { id: ch.id, number: ch.number },
    });
    const now = (
      await inject({ method: 'GET', url: `/certificates/${r.json().id as string}`, headers: h() })
    ).json();
    expect(now.data.fields).toMatchObject({ conduct: 'Good' });
    expect(
      (await inject({ method: 'GET', url: `/certificates/${ch.id}`, headers: h() })).json(),
    ).toMatchObject({ status: 'cancelled', reissuedAs: { id: r.json().id } });
    await withMigrator((c) =>
      c.query(
        `UPDATE certificate_types SET multiple = 'ANY' WHERE school_id = $1 AND code = 'CHARACTER'`,
        [school.id],
      ),
    );
  });
  it('corrects keeping the number when the school says so: revisions, the change log, the paper and the check', async () => {
    const made = await issue(
      { typeCode: 'BONAFIDE', studentId: pupils.asha, purpose: 'Bank account' },
      office,
    );
    expect(made.statusCode).toBe(201);
    const cert = made.json() as { id: string; number: string; issuedOn: string };
    // the school gives a new number on a correction (the default)
    const off = await inject({
      method: 'POST',
      url: `/certificates/${cert.id}/correct`,
      headers: h(office),
      json: { reason: 'Purpose typed wrong', purpose: 'Passport' },
    });
    expect(off.statusCode).toBe(409);
    expect(off.json()).toMatchObject({ type: 'certificate.corrections_new_number' });
    const st = (
      await inject({ method: 'GET', url: '/certificates/setup/settings', headers: h() })
    ).json();
    const put = await inject({
      method: 'PUT',
      url: '/certificates/setup/settings',
      headers: h(),
      json: {
        signatoryEmployeeId: st.signatory?.id ?? null,
        signatoryTitle: st.signatoryTitle,
        printSignature: st.printSignature,
        printPreparer: st.printPreparer,
        footerNote: st.footerNote || undefined,
        correctionsKeepNumber: true,
      },
    });
    expect(put.statusCode).toBe(200);
    // revision 2: the same number, the purpose corrected
    const r2 = await inject({
      method: 'POST',
      url: `/certificates/${cert.id}/correct`,
      headers: h(office),
      json: { reason: 'Purpose typed wrong', purpose: 'Passport' },
    });
    expect(r2.statusCode).toBe(201);
    expect(r2.json()).toMatchObject({
      id: cert.id,
      number: cert.number,
      purpose: 'Passport',
      revision: 2,
      status: 'issued',
    });
    // revision 3: the date corrected
    const r3 = await inject({
      method: 'POST',
      url: `/certificates/${cert.id}/correct`,
      headers: h(office),
      json: { reason: 'Date typed wrong', issuedOn: '2026-11-02' },
    });
    expect(r3.json()).toMatchObject({
      number: cert.number,
      revision: 3,
      issuedOn: '2026-11-02',
      purpose: 'Passport',
    });
    const d = (
      await inject({ method: 'GET', url: `/certificates/${cert.id}`, headers: h() })
    ).json();
    expect((d.revisions as Array<{ revision: number }>).map((x) => x.revision)).toEqual([3, 2, 1]);
    expect(d.revisions[0]).toMatchObject({
      reason: 'Date typed wrong',
      changes: [{ label: 'Date of issue', from: expect.any(String), to: '02-11-2026' }],
    });
    expect(d.revisions[1]).toMatchObject({
      reason: 'Purpose typed wrong',
      changes: expect.arrayContaining([{ label: 'Purpose', from: 'Bank account', to: 'Passport' }]),
    });
    expect(d.revisions[2]).toMatchObject({ revision: 1, reason: null });
    expect(d.data.cert).toMatchObject({ number: cert.number, revision: 3 });
    // the public check: corrected; the number with the date first printed still matches
    const tok = await withMigrator((c) =>
      c.query<{ token: string; code: string }>(
        `SELECT x.verify_token AS token, lower(s.code) AS code FROM certificates x JOIN schools s ON s.id = x.school_id WHERE x.id = $1`,
        [cert.id],
      ),
    );
    const v = await inject({
      method: 'GET',
      url: `/public/certificates/${tok.rows[0]!.code}/verify/${tok.rows[0]!.token}`,
      headers: {},
    });
    expect(v.json()).toMatchObject({ result: 'valid', certificate: { revision: 3 } });
    expect(v.json().certificate.correctedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await app.get(CacheService).delByPrefix('edupro:throttle:PublicCertificatesController');
    const byOldDate = await inject({
      method: 'GET',
      url: `/public/certificates/${tok.rows[0]!.code}/verify?number=${encodeURIComponent(cert.number)}&date=${cert.issuedOn}`,
      headers: {},
    });
    expect(byOldDate.json()).toMatchObject({ result: 'valid' });
    // a duplicate printed now carries the correction; a duplicate itself is not corrected
    const dup = await inject({
      method: 'POST',
      url: `/certificates/${cert.id}/duplicate`,
      headers: h(office),
      json: { reason: 'Lost' },
    });
    expect(dup.json()).toMatchObject({ number: cert.number, purpose: 'Passport', copyNo: 1 });
    expect(
      (
        await inject({
          method: 'POST',
          url: `/certificates/${dup.json().id as string}/correct`,
          headers: h(office),
          json: { reason: 'Copy' },
        })
      ).statusCode,
    ).toBe(400);
    await inject({
      method: 'PUT',
      url: '/certificates/setup/settings',
      headers: h(),
      json: {
        signatoryEmployeeId: st.signatory?.id ?? null,
        signatoryTitle: st.signatoryTitle,
        printSignature: st.printSignature,
        printPreparer: st.printPreparer,
        footerNote: st.footerNote || undefined,
        correctionsKeepNumber: false,
      },
    });
  });
  it("prints the person's details as typed at issue, on that certificate only; the record stays; a re-issue carries them", async () => {
    const preview = (json: Record<string, unknown>) =>
      inject({ method: 'POST', url: '/certificates/preview', headers: h(office), json });
    type Box = { path: string; kind: string; value: string; record: string; changed: boolean };
    // a TC asks for what its layout prints, in the order it prints them, filled from the record
    const tcp = await preview({ typeCode: 'TC', studentId: pupils.asha });
    expect(tcp.statusCode).toBe(201);
    const boxes = tcp.json().personDetails as Box[];
    const paths = boxes.map((d) => d.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'student.name',
        'student.fatherName',
        'student.motherName',
        'student.nationality',
        'student.category',
        'student.admittedOn',
        'student.admissionClassLabel',
        'student.dob',
        'student.dobWords',
        'tc.lastClass',
        'tc.lastClassWords',
      ]),
    );
    expect(paths.indexOf('student.name')).toBeLessThan(paths.indexOf('student.motherName'));
    expect(paths.indexOf('student.dob')).toBeLessThan(paths.indexOf('tc.lastClass'));
    expect(paths).not.toContain('student.admissionNo');
    // the name first, the ID numbers last; the guardian only asked when there is no father
    expect(paths[0]).toBe('student.name');
    expect(paths.indexOf('student.pen')).toBeGreaterThan(paths.indexOf('tc.lastClassWords'));
    expect(paths).not.toContain('student.guardianName');
    expect(boxes.find((d) => d.path === 'student.dob')).toMatchObject({
      kind: 'date',
      value: '2013-03-09',
      record: '09-03-2013',
      changed: false,
    });
    // a date of birth certificate with the father's name and the date of birth typed (a detail it does not print is left out)
    const father = (
      (await preview({ typeCode: 'DOB', studentId: pupils.asha })).json().personDetails as Box[]
    ).find((d) => d.path === 'student.fatherName')!.record;
    expect(father).toMatch(/^Ravi/);
    const person = {
      'student.fatherName': 'Ravi Kumar',
      'student.dob': '2013-03-10',
      'student.house': 'Blue',
    };
    const pv = await preview({ typeCode: 'DOB', studentId: pupils.asha, person });
    expect(
      (pv.json().personDetails as Box[]).find((d) => d.path === 'student.fatherName'),
    ).toMatchObject({
      value: 'Ravi Kumar',
      record: father,
      changed: true,
    });
    expect((pv.json().personDetails as Box[]).map((d) => d.path)).not.toContain('student.house');
    expect(pv.json().html).toContain('Ravi Kumar');
    expect(pv.json().html).toContain('Tenth March two thousand thirteen');
    const made = await issue(
      { typeCode: 'DOB', studentId: pupils.asha, purpose: 'Passport', person },
      office,
    );
    expect(made.statusCode).toBe(201);
    const got = (
      await inject({
        method: 'GET',
        url: `/certificates/${made.json().id as string}`,
        headers: h(),
      })
    ).json();
    expect(got.data.printed).toEqual({
      'student.fatherName': { label: "Father's name", record: father, printed: 'Ravi Kumar' },
      'student.dob': { label: 'Date of birth', record: '09-03-2013', printed: '10-03-2013' },
      'student.dobWords': {
        label: 'Date of birth in words',
        record: 'Ninth March two thousand thirteen',
        printed: 'Tenth March two thousand thirteen',
      },
    });
    expect(got.data.student).toMatchObject({ fatherName: 'Ravi Kumar', dob: '10-03-2013' });
    const logged = await withMigrator((c) =>
      c.query<{ after: { printed?: Record<string, unknown> } }>(
        `SELECT after FROM audit_logs WHERE action = 'certificate.issue' AND entity_id = $1::text`,
        [made.json().id],
      ),
    );
    expect(Object.keys(logged.rows[0]!.after.printed ?? {})).toEqual(
      expect.arrayContaining(['student.fatherName', 'student.dob']),
    );
    // the record is as it was: the next certificate prints the record
    const again = (await preview({ typeCode: 'DOB', studentId: pupils.asha })).json();
    expect(
      (again.personDetails as Box[]).find((d) => d.path === 'student.fatherName'),
    ).toMatchObject({
      value: father,
      changed: false,
    });
    // a re-issue with today's settings carries what was typed
    const re = await inject({
      method: 'POST',
      url: `/certificates/${made.json().id as string}/reissue`,
      headers: h(office),
      json: { reason: 'Signed again' },
    });
    expect(re.statusCode).toBe(201);
    const now = (
      await inject({ method: 'GET', url: `/certificates/${re.json().id as string}`, headers: h() })
    ).json();
    expect(now.data.printed['student.fatherName']).toMatchObject({ printed: 'Ravi Kumar' });
    expect(now.data.student.dob).toBe('10-03-2013');
    // the name cannot be left empty; a date must be a date
    const bad = await preview({
      typeCode: 'DOB',
      studentId: pupils.asha,
      person: { 'student.name': ' ', 'student.dob': 'soon' },
    });
    expect(bad.json().problems).toEqual(
      expect.arrayContaining(['Name of the student: it cannot be empty', 'Date of birth: a date']),
    );
  });
});
