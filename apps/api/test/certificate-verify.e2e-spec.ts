/**
 * Certificate management, phase D (docs/design/87): every certificate carries the QR of its own check link; the public
 * check by the QR's token or by the number and date answers valid, cancelled or not found, with the school and a masked
 * name, without a sign-in; a duplicate has its own link; every check is logged (a hash, never the address); the search
 * is rate-limited; a certificate issued before the QR gets one on its next PDF.
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

describe('certificate check (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let other: SeededSchool;
  let admin: SeededUser;
  let code: string;
  let student: string;
  let cert: { id: string; number: string; issuedOn: string };
  let token: string;

  const h = () => headersFor(admin.sub, school.id);
  const pub = (url: string) => inject({ method: 'GET', url, headers: {} });

  beforeAll(async () => {
    const s = stamp('CRV');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      other = await seedSchool(c, `${s}B`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      code = (
        await c.query<{ code: string }>(`SELECT lower(code) AS code FROM schools WHERE id = $1`, [
          school.id,
        ])
      ).rows[0]!.code;
    });
    app = await createApp();
    inject = injector(app);
    // the public limit counts per address for a minute: start this suite with a clean count (a rerun within the minute)
    await app.get(CacheService).delByPrefix('edupro:throttle:PublicCertificatesController');
    const k = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'V', name: 'Class V', displayOrder: 5 },
    });
    const sec = await inject({
      method: 'POST',
      url: `/academics/classes/${k.json().id}/sections`,
      headers: h(),
      json: { name: 'A' },
    });
    const r = await inject({
      method: 'POST',
      url: '/people/students',
      headers: h(),
      json: {
        admissionNo: `${s}-1`,
        firstName: 'Aarav',
        lastName: 'Sharma',
        dob: '2015-05-05',
        gender: 'male',
        guardians: [],
        enrolment: { classSectionId: sec.json().id, rollNo: 1 },
      },
    });
    student = r.json().id as string;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('prints the QR of its own check link, frozen at issue', async () => {
    const r = await inject({
      method: 'POST',
      url: '/certificates/issue',
      headers: h(),
      json: { typeCode: 'BONAFIDE', studentId: student, purpose: 'Bank' },
    });
    expect(r.statusCode).toBe(201);
    cert = r.json();
    const d = await withMigrator((c) =>
      c.query<{ token: string; qr: { url: string; image: string } }>(
        `SELECT verify_token AS token, data->'qr' AS qr FROM certificates WHERE id = $1`,
        [cert.id],
      ),
    );
    token = d.rows[0]!.token;
    expect(d.rows[0]!.qr.url).toMatch(new RegExp(`/${code}/verify/${token}$`));
    expect(d.rows[0]!.qr.image.startsWith('<svg')).toBe(true);
    // the preview shows a QR of the school's check page
    const p = await inject({
      method: 'POST',
      url: '/certificates/preview',
      headers: h(),
      json: { typeCode: 'BONAFIDE', studentId: student },
    });
    expect(p.json().html).toContain('eb-qr');
    expect(p.json().html).toContain(`/${code}/verify`);
  });

  it('answers the QR without a sign-in: valid, the school, the name masked', async () => {
    const r = await pub(`/public/certificates/${code}/verify/${token}`);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      result: 'valid',
      school: { code },
      certificate: {
        type: 'Bonafide certificate',
        number: cert.number,
        copy: 0,
        holder: 'A***v S****a',
        holderKind: 'student',
        cancelledOn: null,
      },
    });
    const bogus = await pub(`/public/certificates/${code}/verify/${'0'.repeat(36)}`);
    expect(bogus.json()).toMatchObject({ result: 'not_found', certificate: null });
    // a token is good only at its own school
    const otherCode = await withMigrator((c) =>
      c.query<{ code: string }>(`SELECT lower(code) AS code FROM schools WHERE id = $1`, [
        other.id,
      ]),
    );
    const wrongSchool = await pub(
      `/public/certificates/${otherCode.rows[0]!.code}/verify/${token}`,
    );
    expect(wrongSchool.json().result).toBe('not_found');
    expect((await pub(`/public/certificates/nosuchschool/verify/${token}`)).statusCode).toBe(404);
  });

  it('answers a search by the number and the date of issue; both must match', async () => {
    const page = await pub(`/public/certificates/${code}/verify`);
    expect(page.statusCode).toBe(200);
    expect(page.json()).toHaveProperty('school');
    const ok = await pub(
      `/public/certificates/${code}/verify?number=${encodeURIComponent(cert.number.toLowerCase())}&date=${cert.issuedOn}`,
    );
    expect(ok.json()).toMatchObject({ result: 'valid', certificate: { number: cert.number } });
    const wrongDate = await pub(
      `/public/certificates/${code}/verify?number=${encodeURIComponent(cert.number)}&date=2001-01-01`,
    );
    expect(wrongDate.json().result).toBe('not_found');
    const bad = await pub(
      `/public/certificates/${code}/verify?number=${encodeURIComponent(cert.number)}&date=14-11-2026`,
    );
    expect(bad.statusCode).toBe(400);
  });

  it('gives a duplicate its own link, and says cancelled once it is cancelled', async () => {
    const dup = await inject({
      method: 'POST',
      url: `/certificates/${cert.id}/duplicate`,
      headers: h(),
      json: { reason: 'Original lost' },
    });
    const dupToken = await withMigrator((c) =>
      c.query<{ token: string; url: string }>(
        `SELECT verify_token AS token, data->'qr'->>'url' AS url FROM certificates WHERE id = $1`,
        [dup.json().id],
      ),
    );
    expect(dupToken.rows[0]!.token).not.toBe(token);
    expect(dupToken.rows[0]!.url).toContain(dupToken.rows[0]!.token);
    const d = await pub(`/public/certificates/${code}/verify/${dupToken.rows[0]!.token}`);
    expect(d.json()).toMatchObject({
      result: 'valid',
      certificate: { copy: 1, number: cert.number },
    });
    await inject({
      method: 'POST',
      url: `/certificates/${cert.id}/cancel`,
      headers: h(),
      json: { reason: 'Issued in error' },
    });
    const c = await pub(`/public/certificates/${code}/verify/${token}`);
    expect(c.json()).toMatchObject({ result: 'cancelled', certificate: { duplicates: 1 } });
    expect(c.json().certificate.cancelledOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(
      (await pub(`/public/certificates/${code}/verify/${dupToken.rows[0]!.token}`)).json().result,
    ).toBe('cancelled');
  });

  it('logs every check with a hash of the address, never the address', async () => {
    const log = await inject({
      method: 'GET',
      url: `/certificates/${cert.id}/verifications`,
      headers: h(),
    });
    expect(log.statusCode).toBe(200);
    expect(log.json().total).toBe(3);
    expect(log.json().rows.map((x: { method: string }) => x.method)).toEqual(
      expect.arrayContaining(['qr', 'search']),
    );
    const raw = await withMigrator((c) =>
      c.query<{ ip_hash: string; n: number }>(
        `SELECT ip_hash, count(*)::int AS n FROM certificate_verifications WHERE school_id = $1 GROUP BY ip_hash`,
        [school.id],
      ),
    );
    expect(raw.rows[0]!.ip_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(raw.rows[0]!.ip_hash).not.toContain('127.0.0.1');
  });

  it('puts the QR on a certificate issued before it, on its next PDF', async () => {
    const r = await inject({
      method: 'POST',
      url: '/certificates/issue',
      headers: h(),
      json: { typeCode: 'CHARACTER', studentId: student },
    });
    await withMigrator((c) =>
      c.query(`UPDATE certificates SET data = data - 'qr' WHERE id = $1`, [r.json().id]),
    );
    await inject({
      method: 'POST',
      url: `/certificates/${r.json().id as string}/render`,
      headers: h(),
    });
    const d = await withMigrator((c) =>
      c.query<{ has: boolean }>(`SELECT data ? 'qr' AS has FROM certificates WHERE id = $1`, [
        r.json().id,
      ]),
    );
    expect(d.rows[0]!.has).toBe(true);
  });

  it('limits the searches from one address', async () => {
    let limited = false;
    for (let i = 0; i < 15 && !limited; i++) {
      const r = await pub(
        `/public/certificates/${code}/verify?number=XYZ${String(i)}&date=2026-11-14`,
      );
      if (r.statusCode === 429) limited = true;
    }
    expect(limited).toBe(true);
  });
});
