import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encryptField } from '@edupro/db';
import { deliverConsentWebhooks } from '../src/processors/consent-webhooks';
import { newDb, seedSchool, stamp, withMigrator, type SeededSchool } from './helpers';

describe('consent form webhooks (0170)', () => {
  const db = newDb();
  let school: SeededSchool;
  let server: Server;
  let base = '';
  const got: Array<{ headers: Record<string, string | string[] | undefined>; body: string }> = [];
  let answer = 200;
  let formId = '';

  beforeAll(async () => {
    school = await seedSchool(stamp('WCW'));
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (ch) => (body += String(ch)));
      req.on('end', () => {
        got.push({ headers: req.headers, body });
        res.statusCode = answer;
        res.end('ok');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    formId = await withMigrator(async (c) => {
      const f = await c.query<{ id: string }>(
        `INSERT INTO consent_forms (school_id, academic_year_id, code, title, fields, status) VALUES ($1, $2, 'hook_test', 'Hook test', '[]', 'published') RETURNING id::text`,
        [school.id, school.yearId],
      );
      return f.rows[0]!.id;
    });
  });
  afterAll(async () => {
    await db.close();
    await new Promise((r) => server.close(r));
  });

  const queue = async (secret: string, path: string) =>
    withMigrator(async (c) => {
      const w = await c.query<{ id: string }>(
        `INSERT INTO consent_webhooks (school_id, form_id, url, secret) VALUES ($1, $2, $3, $4) RETURNING id::text`,
        [school.id, formId, `${base}${path}`, encryptField(secret)],
      );
      const d = await c.query<{ id: string }>(
        `INSERT INTO consent_webhook_deliveries (school_id, webhook_id, event, payload) VALUES ($1, $2, 'test', '{"event":"test","n":1}') RETURNING id::text`,
        [school.id, w.rows[0]!.id],
      );
      return d.rows[0]!.id;
    });
  const run = () =>
    db.withTenant({ schoolId: school.id, userId: null, allowedSchoolIds: [school.id] }, (c) =>
      deliverConsentWebhooks(c, { production: false }),
    );
  const row = (id: string) =>
    withMigrator(
      async (c) =>
        (
          await c.query<{
            status: string;
            attempts: number;
            last_status: number | null;
            mins: number;
          }>(
            `SELECT status, attempts, last_status, round(extract(epoch FROM next_at - now()) / 60)::int AS mins FROM consent_webhook_deliveries WHERE id = $1`,
            [id],
          )
        ).rows[0]!,
    );

  it('posts the JSON signed with HMAC-SHA256 of "timestamp.body"; a 2xx delivers it', async () => {
    const id = await queue('whsec_test_one', '/ok');
    const out = await run();
    expect(out.delivered).toBe(1);
    const hit = got.at(-1)!;
    expect(hit.headers['x-edupro-event']).toBe('test');
    expect(hit.headers['x-edupro-delivery']).toBe(id);
    const ts = String(hit.headers['x-edupro-timestamp']);
    const want = createHmac('sha256', 'whsec_test_one').update(`${ts}.${hit.body}`).digest('hex');
    expect(hit.headers['x-edupro-signature']).toBe(`sha256=${want}`);
    expect(JSON.parse(hit.body)).toEqual({ event: 'test', n: 1 });
    expect(await row(id)).toMatchObject({ status: 'delivered', attempts: 1, last_status: 200 });
  });

  it('a refusal is tried again after 1, 5, 30 and 120 minutes, then marked failed', async () => {
    answer = 500;
    const id = await queue('whsec_test_two', '/down');
    await run();
    expect(await row(id)).toMatchObject({
      status: 'pending',
      attempts: 1,
      last_status: 500,
      mins: 1,
    });
    for (const mins of [5, 30, 120]) {
      await withMigrator((c) =>
        c.query(`UPDATE consent_webhook_deliveries SET next_at = now() WHERE id = $1`, [id]),
      );
      await run();
      expect((await row(id)).mins).toBe(mins);
    }
    await withMigrator((c) =>
      c.query(`UPDATE consent_webhook_deliveries SET next_at = now() WHERE id = $1`, [id]),
    );
    const out = await run();
    expect(out.failed).toBe(1);
    expect(await row(id)).toMatchObject({ status: 'failed', attempts: 5 });
    answer = 200;
  });

  it('in production only https addresses on the internet are called', async () => {
    const id = await queue('whsec_test_three', '/prod');
    const before = got.length;
    await db.withTenant({ schoolId: school.id, userId: null, allowedSchoolIds: [school.id] }, (c) =>
      deliverConsentWebhooks(c, { production: true }),
    );
    expect(got.length).toBe(before);
    expect(await row(id)).toMatchObject({ status: 'pending', attempts: 1, last_status: null });
  });
});
