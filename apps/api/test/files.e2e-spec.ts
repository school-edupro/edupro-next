/** File service with the local driver (S2-08): signed upload, byte round trip, download, isolation. */
import { createHash } from 'node:crypto';
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

describe('files (e2e, local driver)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let other: SeededSchool;
  let admin: SeededUser;
  let outsider: SeededUser;

  beforeAll(async () => {
    process.env.STORAGE_DRIVER = 'local';
    process.env.STORAGE_LOCAL_DIR = '.data/uploads-test';
    const s = stamp('FIL');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      other = await seedSchool(c, `${s}B`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      outsider = await seedUser(c, other, `${s}-outsider`, 'school_admin');
    });
    app = await createApp();
    inject = injector(app);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  const A = headersFor;
  const bytes = Buffer.from('%PDF-1.4\n% EduPro Next test file\n'.repeat(40));

  let fileId: string;

  it('registers a file and returns a signed upload target', async () => {
    const res = await inject({
      method: 'POST',
      url: '/platform/files',
      headers: A(admin.sub, school.id),
      json: {
        fileName: 'receipt.pdf',
        contentType: 'application/pdf',
        sizeBytes: bytes.length,
        classification: 'personal',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.file).toMatchObject({
      status: 'pending',
      contentType: 'application/pdf',
      classification: 'personal',
    });
    expect(body.upload.method).toBe('PUT');
    expect(body.upload.url).toContain('/api/v1/platform/files/local?token=');
    fileId = body.file.id;

    const put = await inject({
      method: 'PUT',
      url: body.upload.url,
      headers: {},
      raw: { body: bytes, contentType: 'application/pdf' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({
      status: 'ready',
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  });

  it('rejects a tampered token and an oversized body', async () => {
    const res = await inject({
      method: 'PUT',
      url: '/platform/files/local?token=not.a.token',
      headers: {},
      raw: { body: bytes, contentType: 'application/pdf' },
    });
    expect(res.statusCode).toBe(403);
    const reg = await inject({
      method: 'POST',
      url: '/platform/files',
      headers: A(admin.sub, school.id),
      json: {
        fileName: 'small.pdf',
        contentType: 'application/pdf',
        sizeBytes: 10,
        classification: 'internal',
      },
    });
    const big = await inject({
      method: 'PUT',
      url: reg.json().upload.url,
      headers: {},
      raw: { body: bytes, contentType: 'application/pdf' },
    });
    expect(big.statusCode).toBe(413);
  });

  it('serves the bytes back through a signed download URL', async () => {
    const res = await inject({
      method: 'GET',
      url: `/platform/files/${fileId}/download-url`,
      headers: A(admin.sub, school.id),
    });
    expect(res.statusCode).toBe(200);
    const get = await inject({ method: 'GET', url: res.json().download.url, headers: {} });
    expect(get.statusCode).toBe(200);
    expect(get.headers['content-type']).toBe('application/pdf');
    expect(Buffer.compare(get.rawPayload, bytes)).toBe(0);
  });

  it('validates content type and size class limits', async () => {
    const bad = await inject({
      method: 'POST',
      url: '/platform/files',
      headers: A(admin.sub, school.id),
      json: { fileName: 'evil.exe', contentType: 'application/x-msdownload', sizeBytes: 10 },
    });
    expect(bad.statusCode).toBe(400);
    const huge = await inject({
      method: 'POST',
      url: '/platform/files',
      headers: A(admin.sub, school.id),
      json: {
        fileName: 'huge.pdf',
        contentType: 'application/pdf',
        sizeBytes: 11 * 1024 * 1024,
        classification: 'sensitive',
      },
    });
    expect(huge.statusCode).toBe(413);
  });

  it('another school cannot see the file', async () => {
    const res = await inject({
      method: 'GET',
      url: `/platform/files/${fileId}`,
      headers: A(outsider.sub, other.id),
    });
    expect(res.statusCode).toBe(404);
  });
});
