/**
 * Portal photos: parents send a new student, father or mother photo; it follows the portal levels
 * (edit with approval by default, edit direct when the school chooses) and, once approved, replaces the
 * photo on the student or guardian record. Students see their own photo only.
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

// a 1×1 PNG: the API checks the declared type and size, the picture itself is not decoded
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

describe('portal photos: upload, approval and records (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let parent: SeededUser;
  let pupil: SeededUser;
  let studentId: string;
  let s: string;
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);

  const upload = async (u: SeededUser, type = 'image/png', bytes = PNG) => {
    const reg = await inject({
      method: 'POST',
      url: '/platform/files',
      headers: h(u),
      json: {
        fileName: type === 'image/png' ? 'photo.png' : 'doc.pdf',
        contentType: type,
        sizeBytes: bytes.length,
        classification: 'personal',
      },
    });
    expect(reg.statusCode).toBe(201);
    await inject({
      method: 'PUT',
      url: reg.json().upload.url,
      headers: {},
      raw: { body: bytes, contentType: type },
    });
    return reg.json().file.id as string;
  };
  const send = (u: SeededUser, changes: Record<string, string>) =>
    inject({
      method: 'POST',
      url: `/engagement/mine/profile/${studentId}/changes`,
      headers: h(u),
      json: { changes, proofs: [] },
    });
  const profile = async () =>
    (
      await inject({ method: 'GET', url: `/people/students/${studentId}/profile`, headers: h() })
    ).json();

  beforeAll(async () => {
    s = stamp('PH');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      pupil = await seedUser(c, school, `${s}-pupil`, 'student', 'student');
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'VII', name: 'Class VII' },
    });
    const sectionId = (
      await inject({
        method: 'POST',
        url: `/academics/classes/${cls.json().id}/sections`,
        headers: h(),
        json: { name: 'A' },
      })
    ).json().id;
    const q = await inject({
      method: 'POST',
      url: '/people/profile/quick-add',
      headers: h(),
      json: {
        classSectionId: sectionId,
        values: {
          admission_no: `${s}-1`,
          first_name: 'tara',
          last_name: 'photo',
          dob: '12-03-2013',
          gender: 'Female',
          sms_mobile: '9812345670',
          category: 'General',
          ews: 'No',
          boarding: 'Day Scholar',
          father_name: 'vikram photo',
          mother_name: 'meera photo',
        },
      },
    });
    expect(q.statusCode).toBe(201);
    studentId = q.json().id;
    const father = (await profile()).guardianIds.father as string;
    await withMigrator(async (c) => {
      await c.query('UPDATE guardians SET user_id = $1 WHERE id = $2', [parent.id, father]);
      await c.query('UPDATE students SET user_id = $1 WHERE id = $2', [pupil.id, studentId]);
    });
  });
  afterAll(async () => {
    await app.close();
  });

  it('opens the four photos to parents with approval; a student sees only their own', async () => {
    const mine = await inject({
      method: 'GET',
      url: `/engagement/mine/profile/${studentId}`,
      headers: h(parent),
    });
    expect(mine.statusCode).toBe(200);
    expect(
      mine.json().photoFields.map((x: { key: string; level: string }) => [x.key, x.level]),
    ).toEqual([
      ['photo_student', 'edit_approval'],
      ['photo_father', 'edit_approval'],
      ['photo_mother', 'edit_approval'],
      ['photo_guardian', 'edit_approval'],
    ]);
    const own = await inject({
      method: 'GET',
      url: `/engagement/mine/profile/${studentId}`,
      headers: h(pupil),
    });
    expect(
      own.json().photoFields.map((x: { key: string; level: string }) => [x.key, x.level]),
    ).toEqual([['photo_student', 'view']]);
    const refused = await send(pupil, { photo_student: await upload(pupil) });
    expect(refused.statusCode).toBe(422);
  });

  it('refuses a file that is not an image or not the sender’s own upload', async () => {
    const pdf = await send(parent, {
      photo_student: await upload(parent, 'application/pdf', Buffer.from('%PDF-1.4\n')),
    });
    expect(pdf.statusCode).toBe(400);
    expect(pdf.json().errors.photo_student).toMatch(/JPG, PNG or WebP/);
    const other = await send(parent, { photo_student: await upload(admin) });
    expect(other.statusCode).toBe(400);
    expect(other.json().errors.photo_student).toMatch(/Upload the photo again/);
  });

  it('a new student photo waits for approval, shows as pictures to the approver, then replaces the old', async () => {
    const fileId = await upload(parent);
    const r = await send(parent, { photo_student: fileId });
    expect(r.statusCode).toBe(201);
    expect(r.json().pending).toEqual(['photo_student']);
    expect((await profile()).photos?.student).toBeUndefined();
    const again = await send(parent, { photo_student: await upload(parent) });
    expect(again.statusCode).toBe(409);

    const inbox = await inject({
      method: 'GET',
      url: '/engagement/profile-approvals?box=mine',
      headers: h(),
    });
    const req = inbox.json().data.find((x: { studentId: string }) => x.studentId === studentId);
    expect(req.items).toEqual([
      expect.objectContaining({ key: 'photo_student', photo: true, from: null, to: fileId }),
    ]);
    const view = await inject({
      method: 'GET',
      url: `/engagement/profile-approvals/${req.id}/proofs/${fileId}`,
      headers: h(),
    });
    expect(view.statusCode).toBe(200);
    const ok = await inject({
      method: 'POST',
      url: `/engagement/profile-approvals/${req.id}/decide`,
      headers: h(),
      json: { approve: true },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().status).toBe('approved');
    expect((await profile()).photos.student).toBe(fileId);
  });

  it('the father’s photo lands on the guardian record; edit direct saves the mother’s at once', async () => {
    const fatherFile = await upload(parent);
    await send(parent, { photo_father: fatherFile });
    const inbox = await inject({
      method: 'GET',
      url: '/engagement/profile-approvals?box=mine',
      headers: h(),
    });
    const req = inbox
      .json()
      .data.find(
        (x: { studentId: string; items: Array<{ key: string }> }) =>
          x.studentId === studentId && x.items.some((i) => i.key === 'photo_father'),
      );
    await inject({
      method: 'POST',
      url: `/engagement/profile-approvals/${req.id}/decide`,
      headers: h(),
      json: { approve: true },
    });
    expect((await profile()).photos.father).toBe(fatherFile);

    const policy = (
      await inject({ method: 'GET', url: '/people/portal-profile/policy', headers: h() })
    ).json().policy;
    policy.fields.parent.photo_mother = 'edit_direct';
    const saved = await inject({
      method: 'PUT',
      url: '/people/portal-profile/policy',
      headers: h(),
      json: policy,
    });
    expect(saved.statusCode).toBe(200);
    const motherFile = await upload(parent);
    const direct = await send(parent, { photo_mother: motherFile });
    expect(direct.statusCode).toBe(201);
    expect(direct.json().applied).toEqual(['photo_mother']);
    expect((await profile()).photos.mother).toBe(motherFile);
  });

  it('a guardian added from the office can get a photo from the portal; versions follow the file', async () => {
    const named = await inject({
      method: 'PATCH',
      url: `/people/students/${studentId}/profile`,
      headers: h(),
      json: { values: { guardian_name: 'ravi uncle' } },
    });
    expect(named.statusCode).toBe(200);
    const file = await upload(parent);
    const sent = await send(parent, { photo_guardian: file });
    expect(sent.statusCode).toBe(201);
    const inbox = await inject({
      method: 'GET',
      url: '/engagement/profile-approvals?box=mine',
      headers: h(),
    });
    const req = inbox
      .json()
      .data.find(
        (x: { studentId: string; items: Array<{ key: string }> }) =>
          x.studentId === studentId && x.items.some((i) => i.key === 'photo_guardian'),
      );
    await inject({
      method: 'POST',
      url: `/engagement/profile-approvals/${req.id}/decide`,
      headers: h(),
      json: { approve: true },
    });
    expect((await profile()).photos.guardian).toBe(file);
    const mine = await inject({
      method: 'GET',
      url: `/engagement/mine/profile/${studentId}`,
      headers: h(parent),
    });
    expect(mine.json().photos.guardian).toBe(true);
    expect(mine.json().photoVersions.guardian).toBe(file);
    const link = await inject({
      method: 'GET',
      url: `/engagement/mine/profile/${studentId}/photo/guardian`,
      headers: h(parent),
    });
    expect(link.statusCode).toBe(200);
  });
});
