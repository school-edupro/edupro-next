/**
 * Communication v2 (2026-10-02): student / employee / external groups (by hand, rule, Excel), the
 * template master (HTML email sanitised, SMS units for Hindi, WhatsApp approved-template fields),
 * multi-channel requests with "send to" parents / student / both, master-wise rules, an uploaded list,
 * the approval rule, provider keys that never come back, credits, the dashboard and usage statement,
 * and Meta / MSG91 webhooks.
 */
import { createHmac } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import ExcelJS from 'exceljs';
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

const xlsx = async (rows: Array<Array<string | number>>) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
};

describe('communication v2 (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let coordinator: SeededUser;
  let s: string;
  const ids: Record<string, string> = {};
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);

  beforeAll(async () => {
    s = stamp('CV');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      coordinator = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, mobile, email, department, designation)
         VALUES ($1, 'T01', 'Tanvi', 'Rao', '9811100001', 'tanvi@example.com', 'Academics', 'TGT'),
                ($1, 'T02', 'Ravi', 'Das', '9811100002', NULL, 'Accounts', 'Clerk')`,
        [school.id],
      );
    });
    app = await createApp();
    inject = injector(app);
    await inject({ method: 'POST', url: '/workflow/definitions/defaults', headers: h() });
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'VIII', name: 'Class VIII', displayOrder: 8 },
    });
    ids.class = cls.json().id;
    ids.sec = (
      await inject({
        method: 'POST',
        url: `/academics/classes/${ids.class}/sections`,
        headers: h(),
        json: { name: 'A' },
      })
    ).json().id;
    const mk = async (key: string, first: string, father: string, mother: string | null) => {
      const r = await inject({
        method: 'POST',
        url: '/people/students',
        headers: h(),
        json: {
          admissionNo: `${s}-${key}`,
          firstName: first,
          lastName: 'Eight',
          guardians: [
            {
              guardian: { firstName: `${first} Father`, lastName: 'Eight', mobile: father },
              relation: 'father',
              isPrimary: true,
            },
            ...(mother
              ? [
                  {
                    guardian: { firstName: `${first} Mother`, lastName: 'Eight', mobile: mother },
                    relation: 'mother',
                  },
                ]
              : []),
          ],
          enrolment: { classSectionId: ids.sec },
        },
      });
      expect(r.statusCode).toBe(201);
      ids[key] = r.json().id;
    };
    await mk('a', 'Anu', '9822200001', '9822200011');
    await mk('b', 'Bala', '9822200002', null);
    await withMigrator(async (c) => {
      await c.query(
        `UPDATE students SET house = 'Red', profile = profile || '{"student_own_mobile": "9833300001", "sms_mobile": "9822200001"}'::jsonb WHERE id = $1`,
        [ids.a],
      );
      await c.query(`UPDATE students SET house = 'Blue' WHERE id = $1`, [ids.b]);
      ids.t01 = (
        await c.query<{ id: string }>(
          `SELECT id::text FROM employees WHERE school_id = $1 AND employee_code = 'T01'`,
          [school.id],
        )
      ).rows[0]!.id;
    });
  });
  afterAll(async () => {
    await app.close();
  });

  it('templates: HTML email is sanitised, SMS units count Hindi, WhatsApp keeps its approved fields', async () => {
    const email = await inject({
      method: 'POST',
      url: '/comms/templates',
      headers: h(),
      json: {
        code: 'circular_email',
        channel: 'email',
        name: 'Circular email',
        subject: '{{title}}',
        format: 'html',
        body: '<p>Dear {{recipient_name}},</p><div>{{body}}</div><script>alert(1)</script><a href="javascript:x()" onclick="y()">link</a>',
      },
    });
    expect(email.statusCode).toBe(201);
    expect(email.json().body).not.toMatch(/script|onclick|javascript:/);
    ids.email = email.json().id;
    const sms = await inject({
      method: 'POST',
      url: '/comms/templates',
      headers: h(),
      json: {
        code: 'circular_sms',
        channel: 'sms',
        name: 'Circular SMS',
        body: 'Dear Parent, {{body}} - {{school}}',
        dltTemplateId: '1207160000000000001',
        senderId: 'ALPHAS',
      },
    });
    ids.sms = sms.json().id;
    const wa = await inject({
      method: 'POST',
      url: '/comms/templates',
      headers: h(),
      json: {
        code: 'circular_wa',
        channel: 'whatsapp',
        name: 'Circular WhatsApp',
        body: 'Dear {{recipient_name}}, {{body}}',
        waTemplateName: 'school_circular',
        waLanguage: 'en',
        waParams: ['recipient_name', 'body'],
        waHeader: 'document',
      },
    });
    expect(wa.json()).toMatchObject({
      waTemplateName: 'school_circular',
      waParams: ['recipient_name', 'body'],
    });
    ids.wa = wa.json().id;
    const preview = await inject({
      method: 'POST',
      url: '/comms/templates/preview',
      headers: h(),
      json: { channel: 'sms', body: 'प्रिय अभिभावक, कल विद्यालय बंद रहेगा। {{school}}' },
    });
    expect(preview.json().sms).toMatchObject({ unicode: true, units: 1 });
    const vars = await inject({ method: 'GET', url: '/comms/templates/variables', headers: h() });
    expect(vars.json().data.map((v: { key: string }) => v.key)).toEqual(
      expect.arrayContaining(['fee_due', 'employee_code']),
    );
  });

  it('groups: a rule group follows its filters; Excel adds students by admission no and external contacts', async () => {
    const rule = await inject({
      method: 'POST',
      url: '/comms/groups',
      headers: h(),
      json: {
        code: 'red-house',
        name: 'Red house',
        kind: 'student',
        mode: 'rule',
        rule: { houses: ['Red'] },
      },
    });
    expect(rule.statusCode).toBe(201);
    expect(rule.json()).toMatchObject({ kind: 'student', mode: 'rule', members: 1 });
    ids.red = rule.json().id;

    const st = await inject({
      method: 'POST',
      url: '/comms/groups',
      headers: h(),
      json: { code: 'pta', name: 'PTA', kind: 'student_teacher' },
    });
    ids.pta = st.json().id;
    const file = await xlsx([
      ['Admission No', 'Employee Code'],
      [`${s}-b`, 'T01'],
      ['NOPE-1', ''],
    ]);
    const dry = await inject({
      method: 'POST',
      url: `/comms/groups/${ids.pta}/upload`,
      headers: h(),
      json: { contentBase64: file, dryRun: true },
    });
    expect(dry.json()).toMatchObject({ matched: 2, dryRun: true });
    expect(dry.json().problems).toEqual([expect.objectContaining({ value: 'NOPE-1' })]);
    const saved = await inject({
      method: 'POST',
      url: `/comms/groups/${ids.pta}/upload`,
      headers: h(),
      json: { contentBase64: file, dryRun: false },
    });
    expect(saved.json().group.members).toBe(2);

    const ext = await inject({
      method: 'POST',
      url: '/comms/groups',
      headers: h(),
      json: { code: 'vendors', name: 'Vendors', kind: 'external' },
    });
    ids.vendors = ext.json().id;
    const up = await inject({
      method: 'POST',
      url: `/comms/groups/${ids.vendors}/upload`,
      headers: h(),
      json: {
        contentBase64: await xlsx([
          ['Name', 'Mobile', 'Email', 'Organisation'],
          ['Book House', '+91 98444 00001', 'books@example.com', 'Books'],
          ['Bad Row', '123', '', ''],
        ]),
        dryRun: false,
      },
    });
    expect(up.json()).toMatchObject({ matched: 1 });
    const members = await inject({
      method: 'GET',
      url: `/comms/groups/${ids.vendors}/members`,
      headers: h(),
    });
    expect(members.json().data[0]).toMatchObject({
      type: 'contact',
      mobile: '9844400001',
      detail: 'Books',
    });
    const wrong = await inject({
      method: 'PUT',
      url: `/comms/groups/${ids.vendors}/members`,
      headers: h(),
      json: { add: [{ type: 'student', id: ids.a }] },
    });
    expect(wrong.statusCode).toBe(400);
  });

  it('send to parents / student / both on SMS + WhatsApp + email, with skips explained', async () => {
    const base = {
      title: 'Holiday tomorrow',
      body: 'School stays closed tomorrow for Dussehra.',
      channels: [
        { channel: 'sms', templateId: ids.sms },
        { channel: 'whatsapp', templateId: ids.wa },
      ],
      audience: 'class_section',
      targets: [{ type: 'class_section', id: ids.sec }],
    };
    const parents = await inject({
      method: 'POST',
      url: '/comms/requests/preview',
      headers: h(),
      json: { ...base, sendTo: 'parents' },
    });
    // Anu's father and mother, Bala's father: 3 numbers on each channel
    expect(parents.json().byChannel).toMatchObject({ sms: { send: 3 }, whatsapp: { send: 3 } });
    const student = await inject({
      method: 'POST',
      url: '/comms/requests/preview',
      headers: h(),
      json: { ...base, sendTo: 'student' },
    });
    expect(student.json().byChannel.sms).toMatchObject({ send: 1, skipped: 1 });
    expect(student.json().skippedReasons).toMatchObject({ no_address: 2 });
    const both = await inject({
      method: 'POST',
      url: '/comms/requests/preview',
      headers: h(),
      json: {
        ...base,
        sendTo: 'student_parents',
        channels: [{ channel: 'email', templateId: ids.email }],
      },
    });
    expect(both.json().byChannel.email.send).toBe(0); // nobody has an email
  });

  it('master-wise rule and uploaded list; admins send straight away, others need approval above the threshold', async () => {
    const byHouse = await inject({
      method: 'POST',
      url: '/comms/requests',
      headers: h(),
      json: {
        title: 'Red house meeting',
        body: 'Red house captains meet at 9.',
        channels: [{ channel: 'sms', templateId: ids.sms }],
        audience: 'filter',
        rule: { houses: ['Red'] },
        sendTo: 'primary',
      },
    });
    expect(byHouse.statusCode).toBe(201);
    expect(byHouse.json()).toMatchObject({
      status: 'sent',
      needsApproval: false,
      recipientsTotal: 1,
    });
    const msgs = await withMigrator((c) =>
      c.query<{ body: string; units: number; cost: string; recipient_address: string }>(
        `SELECT body, units, cost::text, recipient_address FROM comms_messages WHERE message_request_id = $1`,
        [byHouse.json().id],
      ),
    );
    expect(msgs.rows[0]).toMatchObject({ recipient_address: '9822200001', units: 1 });
    expect(msgs.rows[0]!.body).toContain('Red house captains meet at 9.');
    expect(Number(msgs.rows[0]!.cost)).toBeCloseTo(0.2);

    const sheet = await inject({
      method: 'POST',
      url: '/comms/requests/recipients-sheet',
      headers: h(),
      json: {
        contentBase64: await xlsx([
          ['Name', 'Mobile', 'Amount'],
          ['Visitor One', '9855500001', '500'],
        ]),
      },
    });
    expect(sheet.json()).toMatchObject({
      variables: ['amount'],
      upload: [expect.objectContaining({ mobile: '9855500001' })],
    });
    await withMigrator((c) =>
      c.query(
        `INSERT INTO comms_settings (school_id, approval_threshold, approval_exempt_roles) VALUES ($1, 0, '{school_admin}')`,
        [school.id],
      ),
    );
    const byCoordinator = await inject({
      method: 'POST',
      url: '/comms/requests',
      headers: h(coordinator),
      json: {
        title: 'Visitor pass',
        body: 'Your pass is ready.',
        channels: [{ channel: 'sms', templateId: ids.sms }],
        audience: 'upload',
        upload: sheet.json().upload,
      },
    });
    expect(byCoordinator.statusCode).toBe(201);
    expect(byCoordinator.json()).toMatchObject({ status: 'pending_approval', needsApproval: true });
    ids.pending = byCoordinator.json().id;
    const inbox = await inject({ method: 'GET', url: '/workflow/inbox', headers: h() });
    const step = inbox
      .json()
      .data.find((x: { instance: { entityId: string } }) => x.instance.entityId === ids.pending);
    await inject({
      method: 'POST',
      url: `/workflow/steps/${step.id}/approve`,
      headers: h(),
      json: { note: 'ok' },
    });
    const sent = await inject({ method: 'GET', url: `/comms/requests/${ids.pending}`, headers: h() });
    expect(sent.json()).toMatchObject({ status: 'sent', recipientsTotal: 1 });
    expect(sent.json().recipients[0]).toMatchObject({ channel: 'sms', name: 'Visitor One' });
  });

  it('provider keys are stored encrypted and never returned; credits and the dashboard add up', async () => {
    const save = await inject({
      method: 'PUT',
      url: '/comms/providers/sms',
      headers: h(),
      json: {
        provider: 'msg91',
        config: { senderId: 'ALPHAS', route: '4' },
        secrets: { authKey: 'secret-key-123' },
      },
    });
    expect(save.statusCode).toBe(200);
    const got = await inject({ method: 'GET', url: '/comms/settings', headers: h() });
    expect(JSON.stringify(got.json())).not.toContain('secret-key-123');
    expect(got.json().providers[0]).toMatchObject({
      provider: 'msg91',
      secrets: { authKey: true },
    });
    const stored = await withMigrator((c) =>
      c.query<{ secret: string }>(`SELECT secret FROM comms_providers WHERE school_id = $1`, [
        school.id,
      ]),
    );
    expect(stored.rows[0]!.secret).not.toContain('secret-key-123');
    const noTeacher = await inject({
      method: 'GET',
      url: '/comms/settings',
      headers: h(coordinator),
    });
    expect(noTeacher.statusCode).toBe(403);

    await withMigrator((c) =>
      c.query(
        `UPDATE comms_messages SET status = 'delivered', sent_at = now() WHERE school_id = $1 AND channel = 'sms'`,
        [school.id],
      ),
    );
    const credit = await inject({
      method: 'POST',
      url: '/comms/credits',
      headers: h(),
      json: { channel: 'sms', units: 1000, amount: 200, note: 'Top-up' },
    });
    expect(
      credit.json().balances.find((b: { channel: string }) => b.channel === 'sms'),
    ).toMatchObject({ credited: 1000, used: 2, balance: 998 });
    const dash = await inject({ method: 'GET', url: '/comms/dashboard', headers: h() });
    expect(
      dash.json().channels.find((x: { channel: string }) => x.channel === 'sms'),
    ).toMatchObject({ messages: 2, delivered: 2 });
    const statement = await inject({
      method: 'GET',
      url: '/comms/reports/comms_monthly_usage',
      headers: h(),
    });
    expect(
      statement.json().rows.find((r: { channel: string }) => r.channel === 'sms'),
    ).toMatchObject({ messages: 2, credited: 1000 });
  });

  it('Meta statuses are accepted only with the school’s signature; a read sets read_at', async () => {
    await inject({
      method: 'PUT',
      url: '/comms/providers/whatsapp',
      headers: h(),
      json: {
        provider: 'meta_whatsapp',
        config: { phoneNumberId: `${s}PN`, apiVersion: 'v21.0' },
        secrets: { accessToken: 'tok', appSecret: 'app-secret' },
      },
    });
    const m = await withMigrator(async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO comms_messages (school_id, channel, recipient_address, body, status, provider, provider_message_id, sent_at)
         VALUES ($1, 'whatsapp', '9822200001', 'hi', 'sent', 'meta_whatsapp', $2, now()) RETURNING id::text`,
        [school.id, `wamid.${s}`],
      );
      return r.rows[0]!.id;
    });
    const body = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: `${s}PN` },
                statuses: [{ id: `wamid.${s}`, status: 'read' }],
              },
            },
          ],
        },
      ],
    };
    const raw = JSON.stringify(body);
    const bad = await inject({
      method: 'POST',
      url: '/comms/webhooks/meta',
      headers: { 'x-hub-signature-256': 'sha256=00' },
      raw: { body: Buffer.from(raw), contentType: 'application/json' },
    });
    expect(bad.statusCode).toBe(401);
    const sig = `sha256=${createHmac('sha256', 'app-secret').update(raw).digest('hex')}`;
    const ok = await inject({
      method: 'POST',
      url: '/comms/webhooks/meta',
      headers: { 'x-hub-signature-256': sig },
      raw: { body: Buffer.from(raw), contentType: 'application/json' },
    });
    expect(ok.json()).toEqual({ applied: 1 });
    const row = await withMigrator((c) =>
      c.query<{ status: string; read: boolean }>(
        `SELECT status::text, read_at IS NOT NULL AS read FROM comms_messages WHERE id = $1`,
        [m],
      ),
    );
    expect(row.rows[0]).toEqual({ status: 'delivered', read: true });
    const settings = await inject({ method: 'GET', url: '/comms/settings', headers: h() });
    const token = settings
      .json()
      .providers.find((p: { channel: string }) => p.channel === 'whatsapp').config
      .verifyToken as string;
    const verify = await inject({
      method: 'GET',
      url: `/comms/webhooks/meta?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=12345`,
      headers: {},
    });
    expect(verify.body).toBe('12345');
  });
});
