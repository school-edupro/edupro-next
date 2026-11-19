/**
 * Idempotency keys (migration 0402, docs/design/89 §5.6): the mobile app keeps a class's attendance with no network
 * and sends it again until it has an answer. A repeat with the same `Idempotency-Key` gets the first answer (no second
 * marking, alert or audit row); the key with another request is refused; a failed request frees its key; keys are
 * per person; a route without `@Idempotent()` ignores the header. Every name and number here is made up.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  createApp,
  headersFor,
  injector,
  seedSchool,
  seedUser,
  stamp,
  type SeededSchool,
  type SeededUser,
  withMigrator,
} from './helpers';

const lastWeekday = (): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

describe('idempotency keys on writes the phone sends again (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let other: SeededUser;
  let sectionId = '';
  let kid = '';
  const s = stamp('IDM');
  const date = lastWeekday();
  const mark = (who: SeededUser, json: unknown, key?: string) =>
    inject({
      method: 'POST',
      url: '/attendance/sessions',
      headers: { ...headersFor(who.sub, school.id), ...(key ? { 'idempotency-key': key } : {}) },
      json,
    });
  const count = (sql: string) =>
    withMigrator(async (c) => Number((await c.query<{ n: string }>(sql, [school.id])).rows[0]!.n));
  const alerts = () => count(`SELECT count(*)::text AS n FROM comms_messages WHERE school_id = $1`);
  const audits = () =>
    count(
      `SELECT count(*)::text AS n FROM audit_logs WHERE school_id = $1 AND action LIKE '%attendance%'`,
    );

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      other = await seedUser(c, school, `${s}-admin2`, 'school_admin');
      await c.query(
        `INSERT INTO comms_templates (school_id, code, channel, name, body, variables) VALUES ($1, 'absent_alert', 'whatsapp', 'Absent alert', '{{student_name}} ({{section}}) was absent on {{date}}', '["student_name","section","date"]'::jsonb)`,
        [school.id],
      );
    });
    app = await createApp();
    inject = injector(app);
    const h = headersFor(admin.sub, school.id);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h,
      json: { code: 'VI', name: 'Class VI', displayOrder: 6 },
    });
    sectionId = (
      await inject({
        method: 'POST',
        url: `/academics/classes/${cls.json().id}/sections`,
        headers: h,
        json: { name: 'A' },
      })
    ).json().id;
    const st = await inject({
      method: 'POST',
      url: '/people/students',
      headers: h,
      json: {
        admissionNo: `${s}1`,
        firstName: 'Ana',
        lastName: 'Sample',
        guardians: [
          {
            guardian: { firstName: 'Pia', lastName: 'Sample', mobile: '9876522201' },
            relation: 'mother',
            isPrimary: true,
          },
        ],
        enrolment: { classSectionId: sectionId, rollNo: 1 },
      },
    });
    expect(st.statusCode).toBe(201);
    kid = st.json().id;
  });

  afterAll(async () => {
    // nothing from a test school is ever sent
    await withMigrator((c) =>
      c.query(
        `UPDATE comms_messages SET status = 'cancelled' WHERE school_id = $1 AND status IN ('queued', 'sending')`,
        [school.id],
      ),
    );
    if (app) await app.close();
  });

  it('a repeat with the same key gets the first answer: no second marking, alert or audit row', async () => {
    const body = { classSectionId: sectionId, date, marks: [{ studentId: kid, code: 'A' }] };
    const first = await mark(admin, body, 'phone-key-0001');
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ alertsSent: 1 });
    const [a1, l1] = [await alerts(), await audits()];
    expect(a1).toBeGreaterThan(0);
    expect(l1).toBeGreaterThan(0);

    const again = await mark(admin, body, 'phone-key-0001');
    expect(again.statusCode).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.json()).toEqual(first.json());
    expect(await alerts()).toBe(a1);
    expect(await audits()).toBe(l1);

    // without a key the route works as before (marked again; the alert is never sent twice anyway)
    const plain = await mark(admin, body);
    expect(plain.statusCode).toBe(201);
    expect(plain.headers['idempotent-replayed']).toBeUndefined();
    expect(plain.json()).toMatchObject({ alertsSent: 0 });
  });

  it('the key with another request is refused; a bad key is refused; keys are per person', async () => {
    const present = { classSectionId: sectionId, date, marks: [{ studentId: kid, code: 'P' }] };
    const reused = await mark(admin, present, 'phone-key-0001');
    expect(reused.statusCode).toBe(422);
    expect(reused.json()).toMatchObject({ type: 'idempotency.key_reused' });
    const bad = await mark(admin, present, 'x');
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ type: 'idempotency.bad_key' });
    // another person's same key is their own
    const theirs = await mark(other, present, 'phone-key-0001');
    expect(theirs.statusCode).toBe(201);
    expect(theirs.headers['idempotent-replayed']).toBeUndefined();
  });

  it('a request that fails frees its key for the same write sent again', async () => {
    const future = await mark(
      admin,
      { classSectionId: sectionId, date: '2099-01-05', marks: [{ studentId: kid, code: 'P' }] },
      'phone-key-0002',
    );
    expect(future.statusCode).toBe(409);
    const later = await mark(
      admin,
      { classSectionId: sectionId, date: '2099-01-05', marks: [{ studentId: kid, code: 'P' }] },
      'phone-key-0002',
    );
    // the same refusal again, worked out afresh (not a replayed answer)
    expect(later.statusCode).toBe(409);
    expect(later.headers['idempotent-replayed']).toBeUndefined();
    expect(
      await count(
        `SELECT count(*)::text AS n FROM api_idempotency WHERE school_id = $1 AND key = 'phone-key-0002'`,
      ),
    ).toBe(0);
  });
});
