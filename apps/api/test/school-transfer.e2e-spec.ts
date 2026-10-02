/**
 * Transfer between schools of a group (2026-10-02): the source school sends a cleared withdrawal, the
 * target accepts it into a section with its own admission number. Profile values, the Aadhaar number,
 * photos and documents are copied; the parent's login now opens both schools. Other schools cannot
 * see the transfer, a school outside the group is refused, and reject / cancel close it.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
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

describe('transfer between schools of the group (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let alpha: SeededSchool;
  let beta: SeededSchool;
  let outsider: SeededSchool;
  let adminA: SeededUser;
  let adminB: SeededUser;
  let adminX: SeededUser;
  let parent: SeededUser;
  let s: string;
  const ids: Record<string, string> = {};
  const hA = () => headersFor(adminA.sub, alpha.id);
  const hB = () => headersFor(adminB.sub, beta.id);
  const hX = () => headersFor(adminX.sub, outsider.id);

  const section = async (h: Record<string, string>, code: string) => {
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h,
      json: { code, name: `Class ${code}`, displayOrder: 6 },
    });
    return (
      await inject({
        method: 'POST',
        url: `/academics/classes/${cls.json().id}/sections`,
        headers: h,
        json: { name: 'A' },
      })
    ).json().id as string;
  };
  const withdraw = async (key: string, first: string) => {
    const r = await inject({
      method: 'POST',
      url: '/people/students',
      headers: hA(),
      json: {
        admissionNo: `${s}-${key}`,
        firstName: first,
        lastName: 'Mover',
        enrolment: { classSectionId: ids.secA },
      },
    });
    expect(r.statusCode).toBe(201);
    ids[key] = r.json().id;
    const w = await withMigrator((c) =>
      c.query<{ id: string }>(
        `INSERT INTO student_withdrawals (school_id, student_id, academic_year_id, leaving_on, reason, status)
         VALUES ($1, $2, $3, CURRENT_DATE, 'Transfer to Beta', 'cleared') RETURNING id::text`,
        [alpha.id, ids[key], alpha.yearId],
      ),
    );
    ids[`w${key}`] = w.rows[0]!.id;
  };

  beforeAll(async () => {
    s = stamp('TR');
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
      parent = await seedUser(c, alpha, `${s}-parent`, 'parent', 'guardian');
    });
    app = await createApp();
    inject = injector(app);
    ids.secA = await section(hA(), 'VI');
    ids.secB = await section(hB(), 'VI');
    await withdraw('a', 'Aarav');
    // profile: father with the parent's login, an Aadhaar number, a photo and a birth certificate
    const p = await inject({
      method: 'PATCH',
      url: `/people/students/${ids.a}/profile`,
      headers: hA(),
      json: {
        values: { father_name: 'Rakesh Mover', aadhaar_no: '234567890124', dob: '2014-06-01' },
      },
    });
    expect(p.statusCode).toBe(200);
    const storage = app.get<StorageDriver>(STORAGE_DRIVER);
    await withMigrator(async (c) => {
      await c.query(
        `UPDATE guardians SET user_id = $2 WHERE id = (SELECT guardian_id FROM student_guardians WHERE student_id = $1 AND relation = 'father')`,
        [ids.a, parent.id],
      );
      for (const [key, kind] of [
        [`school-${alpha.id}/test/${s}-photo.png`, 'photo'],
        [`school-${alpha.id}/test/${s}-birth.pdf`, 'birth_certificate'],
      ] as const) {
        await storage.write(
          key,
          Buffer.from(`bytes of ${kind}`),
          kind === 'photo' ? 'image/png' : 'application/pdf',
        );
        const f = await c.query<{ id: string }>(
          `INSERT INTO files (school_id, bucket, object_key, content_type, size_bytes, original_name, classification, storage_driver, status)
           VALUES ($1, $2, $3, $4, 20, $5, 'personal', $6, 'ready') RETURNING id::text`,
          [
            alpha.id,
            storage.bucket,
            key,
            kind === 'photo' ? 'image/png' : 'application/pdf',
            `${kind}.bin`,
            storage.name,
          ],
        );
        if (kind === 'photo')
          await c.query('UPDATE students SET photo_file_id = $2 WHERE id = $1', [
            ids.a,
            f.rows[0]!.id,
          ]);
        else
          await c.query(
            `INSERT INTO person_documents (school_id, person_type, person_id, kind, file_id, title) VALUES ($1, 'student', $2, 'birth_certificate', $3, 'Birth certificate')`,
            [alpha.id, ids.a, f.rows[0]!.id],
          );
      }
    });
  });
  afterAll(async () => {
    await app.close();
  });

  it('lists only the schools of the group and refuses a school outside it', async () => {
    const t = await inject({
      method: 'GET',
      url: '/people/school-transfers/targets',
      headers: hA(),
    });
    expect(t.statusCode).toBe(200);
    expect(t.json().data.map((x: { id: string }) => x.id)).toEqual([beta.id]);
    const bad = await inject({
      method: 'POST',
      url: `/people/withdrawals/${ids.wa}/transfer`,
      headers: hA(),
      json: { toSchoolId: outsider.id },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('sends, shows to Beta only, and Beta accepts with its own admission number', async () => {
    const r = await inject({
      method: 'POST',
      url: `/people/withdrawals/${ids.wa}/transfer`,
      headers: hA(),
      json: { toSchoolId: beta.id, note: 'Family moved' },
    });
    expect(r.statusCode).toBe(201);
    ids.ta = r.json().id;
    expect(r.json()).toMatchObject({ direction: 'outgoing', status: 'requested', details: null });
    expect(r.json().carries).toMatchObject({ photos: ['student'], documents: 1, parentLogins: 1 });
    const again = await inject({
      method: 'POST',
      url: `/people/withdrawals/${ids.wa}/transfer`,
      headers: hA(),
      json: { toSchoolId: beta.id },
    });
    expect(again.statusCode).toBe(409);

    const inbox = await inject({
      method: 'GET',
      url: '/people/school-transfers?box=incoming',
      headers: hB(),
    });
    const mine = inbox.json().data.find((x: { id: string }) => x.id === ids.ta);
    expect(mine).toMatchObject({ direction: 'incoming', student: { name: 'Aarav Mover' } });
    expect(mine.details).toMatchObject({ fatherName: 'RAKESH MOVER', dob: '2014-06-01' });
    expect(JSON.stringify(mine)).not.toContain('234567890124');
    const other = await inject({
      method: 'GET',
      url: `/people/school-transfers/${ids.ta}`,
      headers: hX(),
    });
    expect(other.statusCode).toBe(404);

    const ok = await inject({
      method: 'POST',
      url: `/people/school-transfers/${ids.ta}/accept`,
      headers: hB(),
      json: { classSectionId: ids.secB, admissionNo: `${s}-B1` },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().status).toBe('accepted');
    const newId = ok.json().toStudentId as string;
    const prof = await inject({
      method: 'GET',
      url: `/people/students/${newId}/profile`,
      headers: hB(),
    });
    expect(prof.json()).toMatchObject({ admissionNo: `${s}-B1` });
    expect(prof.json().values).toMatchObject({
      father_name: 'RAKESH MOVER',
      previous_school_name: `${s}A`,
      admitted_on: new Date().toISOString().slice(0, 10),
    });
    expect(prof.json().enrolment).toMatchObject({ classSectionId: ids.secB, rollNo: 1 });

    const copied = await withMigrator((c) =>
      c.query<{ school_id: string; object_key: string; kind: string }>(
        `SELECT f.school_id::text, f.object_key, 'photo' AS kind FROM students s JOIN files f ON f.id = s.photo_file_id WHERE s.id = $1
         UNION ALL
         SELECT f.school_id::text, f.object_key, d.kind::text FROM person_documents d JOIN files f ON f.id = d.file_id WHERE d.person_id = $1 AND d.school_id = $2`,
        [newId, beta.id],
      ),
    );
    expect(copied.rows.map((x) => x.kind).sort()).toEqual(['birth_certificate', 'photo']);
    expect(
      copied.rows.every(
        (x) => x.school_id === beta.id && x.object_key.startsWith(`school-${beta.id}/`),
      ),
    ).toBe(true);
    const bytes = await app.get<StorageDriver>(STORAGE_DRIVER).read(copied.rows[0]!.object_key);
    expect(bytes.toString()).toMatch(/^bytes of /);
    const secure = await withMigrator((c) =>
      c.query<{ has: boolean }>(`SELECT secure ? 'aadhaar_no' AS has FROM students WHERE id = $1`, [
        newId,
      ]),
    );
    expect(secure.rows[0]!.has).toBe(true);

    // the parent's login now opens Beta, linked to the copied father
    const login = await withMigrator((c) =>
      c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM user_school_memberships m
           JOIN guardians g ON g.user_id = m.user_id AND g.school_id = m.school_id
          WHERE m.school_id = $1 AND m.user_id = $2 AND m.status = 'active'`,
        [beta.id, parent.id],
      ),
    );
    expect(login.rows[0]!.n).toBe(1);
    const twice = await inject({
      method: 'POST',
      url: `/people/school-transfers/${ids.ta}/accept`,
      headers: hB(),
      json: { classSectionId: ids.secB, admissionNo: `${s}-B2` },
    });
    expect(twice.statusCode).toBe(409);
  });

  it('Beta can reject with a reason; Alpha can cancel one it sent', async () => {
    await withdraw('b', 'Bela');
    await withdraw('c', 'Charu');
    const send = async (key: string) =>
      (
        await inject({
          method: 'POST',
          url: `/people/withdrawals/${ids[`w${key}`]}/transfer`,
          headers: hA(),
          json: { toSchoolId: beta.id },
        })
      ).json().id as string;
    const tb = await send('b');
    const tc = await send('c');
    const notMine = await inject({
      method: 'POST',
      url: `/people/school-transfers/${tb}/reject`,
      headers: hA(),
      json: { reason: 'x' },
    });
    expect(notMine.statusCode).toBe(404);
    const rej = await inject({
      method: 'POST',
      url: `/people/school-transfers/${tb}/reject`,
      headers: hB(),
      json: { reason: 'No seat in Class VI' },
    });
    expect(rej.json()).toMatchObject({ status: 'rejected', decisionNote: 'No seat in Class VI' });
    const can = await inject({
      method: 'POST',
      url: `/people/school-transfers/${tc}/cancel`,
      headers: hA(),
      json: { reason: 'Parents changed their mind' },
    });
    expect(can.json()).toMatchObject({ status: 'cancelled' });
    const out = await inject({
      method: 'GET',
      url: '/people/school-transfers?box=outgoing',
      headers: hA(),
    });
    expect(
      out
        .json()
        .data.map((x: { status: string }) => x.status)
        .sort(),
    ).toEqual(['accepted', 'cancelled', 'rejected']);
  });
});
