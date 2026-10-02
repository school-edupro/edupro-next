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
  let parent: SeededUser;
  let s: string;
  const ids: Record<string, string> = {};
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);

  beforeAll(async () => {
    s = stamp('CV');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      coordinator = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
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
      await c.query(
        `UPDATE guardians SET user_id = $2 WHERE id = (SELECT guardian_id FROM student_guardians WHERE student_id = $1 AND relation = 'father')`,
        [ids.a, parent.id],
      );
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
    const sent = await inject({
      method: 'GET',
      url: `/comms/requests/${ids.pending}`,
      headers: h(),
    });
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
      statement.json().rows.find((r: { channel: string }) => r.channel === 'SMS'),
    ).toMatchObject({ messages: 2, credited: 1000 });
  });

  it('reports: six months at a glance, a paged delivery log with the student, search, and an Excel of any count', async () => {
    const dash = await inject({ method: 'GET', url: '/comms/dashboard', headers: h() });
    const trend = dash.json().trend as Array<{ month: string; channel: string; messages: number }>;
    expect(new Set(trend.map((t) => t.month)).size).toBe(6);
    expect(trend).toHaveLength(18);
    const thisMonth = dash.json().month as string;
    expect(trend.find((t) => t.month === thisMonth && t.channel === 'sms')).toMatchObject({
      messages: 2,
      delivered: 2,
    });
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const page = await inject({
      method: 'GET',
      url: `/comms/reports/comms_delivery_log?from=${today}&to=${today}&channel=sms&bucket=delivered&page=1&size=10`,
      headers: h(),
    });
    expect(page.statusCode).toBe(200);
    expect(page.json()).toMatchObject({ total: 2, page: 1, size: 10 });
    const withStudent = (
      page.json().rows as Array<{
        student_name: string | null;
        admission_no: string | null;
        class_section: string | null;
      }>
    ).find((r) => r.admission_no);
    expect(withStudent?.student_name).toBeTruthy();
    expect(withStudent?.class_section).toBeTruthy();
    const found = await inject({
      method: 'GET',
      url: `/comms/reports/comms_delivery_log?from=${today}&to=${today}&q=${encodeURIComponent(withStudent!.admission_no!)}&page=1`,
      headers: h(),
    });
    expect(found.json().total).toBeGreaterThan(0);
    expect(
      (found.json().rows as Array<{ admission_no: string }>).every(
        (r) => r.admission_no === withStudent!.admission_no,
      ),
    ).toBe(true);
    const none = await inject({
      method: 'GET',
      url: `/comms/reports/comms_delivery_log?from=2001-01-01&to=2001-01-02&page=1`,
      headers: h(),
    });
    expect(none.json().total).toBe(0);
    const xlsx = await inject({
      method: 'GET',
      url: `/comms/reports/comms_delivery_log/xlsx?month=${thisMonth}&channel=sms&bucket=delivered`,
      headers: h(),
    });
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.headers['content-disposition']).toContain(`delivery_log-${thisMonth}.xlsx`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.rawPayload as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(String(ws.getRow(3).getCell(1).value)).toContain('Only: delivered');
    expect(ws.getRow(4).getCell(4).value).toBe('Student');
    expect(ws.rowCount).toBe(6); // 4 heading rows + 2 messages
    const statement = await inject({
      method: 'GET',
      url: `/comms/reports/comms_monthly_usage?channel=email`,
      headers: h(),
    });
    expect(
      (statement.json().rows as Array<{ channel: string }>).every((r) => r.channel === 'Email'),
    ).toBe(true);
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

  it('school variables, values asked at send time and computed values fill the message', async () => {
    const v = await inject({
      method: 'PUT',
      url: '/comms/variables',
      headers: h(),
      json: { key: 'principal_name', label: 'Principal', value: 'Dr. Mehta' },
    });
    expect(v.statusCode).toBe(200);
    const clash = await inject({
      method: 'PUT',
      url: '/comms/variables',
      headers: h(),
      json: { key: 'student_name', label: 'Student', value: 'y' },
    });
    expect(clash.statusCode).toBe(409);
    const t = await inject({
      method: 'POST',
      url: '/comms/templates',
      headers: h(),
      json: {
        code: 'ptm_sms',
        channel: 'sms',
        name: 'PTM SMS',
        body: 'PTM on {{ptm_date}} for {{student_name}}. Attendance {{attendance_percent}}. {{principal_name}}',
        dltTemplateId: '1207160000000000002',
      },
    });
    ids.ptm = t.json().id;
    const base = {
      title: 'PTM',
      body: '-',
      channels: [{ channel: 'sms', templateId: ids.ptm }],
      audience: 'individuals',
      targets: [{ type: 'student', id: ids.a }],
    };
    const pv = await inject({
      method: 'POST',
      url: '/comms/requests/preview',
      headers: h(),
      json: base,
    });
    expect(pv.json().askValues).toEqual(['ptm_date']);
    const sent = await inject({
      method: 'POST',
      url: '/comms/requests',
      headers: h(),
      json: { ...base, variables: { ptm_date: '10 Oct' } },
    });
    expect(sent.statusCode).toBe(201);
    const body = await withMigrator((c) =>
      c.query<{ body: string }>(`SELECT body FROM comms_messages WHERE message_request_id = $1`, [
        sent.json().id,
      ]),
    );
    expect(body.rows[0]!.body).toBe('PTM on 10 Oct for Anu Eight. Attendance . Dr. Mehta');
  });

  it('a switched-off channel cannot be used; smsbhejo / EMS providers keep their keys secret', async () => {
    const save = await inject({
      method: 'PUT',
      url: '/comms/providers/sms',
      headers: h(),
      json: {
        provider: 'smsbhejo',
        config: { user: 'school', entityId: '1101' },
        secrets: { key: 'live-key-xyz' },
        active: false,
      },
    });
    expect(save.statusCode).toBe(200);
    const got = await inject({ method: 'GET', url: '/comms/settings', headers: h() });
    expect(JSON.stringify(got.json())).not.toContain('live-key-xyz');
    expect(got.json().switchedOff).toEqual(['sms']);
    const blocked = await inject({
      method: 'POST',
      url: '/comms/requests',
      headers: h(),
      json: {
        title: 'Switched off',
        body: 'y',
        channels: [{ channel: 'sms', templateId: ids.sms }],
        audience: 'individuals',
        targets: [{ type: 'student', id: ids.a }],
      },
    });
    expect(blocked.statusCode).toBe(409);
    await inject({
      method: 'PUT',
      url: '/comms/providers/sms',
      headers: h(),
      json: { provider: 'smsbhejo', config: { user: 'school', entityId: '1101' }, active: true },
    });
  });

  it('the parent sees their messages in the app inbox, per child, and can mark them read', async () => {
    const ph = headersFor(parent.sub, school.id);
    const inbox = await inject({ method: 'GET', url: '/comms/inbox', headers: ph });
    expect(inbox.statusCode).toBe(200);
    const items = inbox.json().data as Array<{
      title: string;
      channels: string[];
      unread: boolean;
      messageIds: string[];
      student: { name: string } | null;
    }>;
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((x) => x.title === 'Red house meeting')).toBe(true);
    expect(inbox.json().children.map((x: { name: string }) => x.name)).toEqual(['Anu Eight']);
    expect(items.every((x) => !x.title.includes('Visitor'))).toBe(true);
    const before = (await inject({ method: 'GET', url: '/comms/inbox/unread', headers: ph })).json()
      .unread;
    expect(before).toBeGreaterThan(0);
    await inject({
      method: 'POST',
      url: '/comms/inbox/read',
      headers: ph,
      json: { ids: items[0]!.messageIds },
    });
    const after = (await inject({ method: 'GET', url: '/comms/inbox/unread', headers: ph })).json()
      .unread;
    expect(after).toBe(before - 1);
    const other = await inject({
      method: 'GET',
      url: `/comms/inbox?studentId=${ids.b}`,
      headers: ph,
    });
    expect(other.statusCode).toBe(404);
  });

  it('an own email (no template) fills {{values}} written in the text; "send me a test" goes to the sender', async () => {
    await withMigrator((c) =>
      c.query(
        `UPDATE students SET profile = profile || '{"primary_email": "anu.family@example.com"}'::jsonb WHERE id = $1`,
        [ids.a],
      ),
    );
    const base = {
      title: 'Annual day',
      subject: 'Annual day on {{event_date}}',
      body: '<p>Dear {{recipient_name}}, annual day is on <b>{{event_date}}</b> for {{student_name}}.</p><script>x</script>',
      bodyFormat: 'html',
      channels: [{ channel: 'email', custom: true }],
      audience: 'individuals',
      targets: [{ type: 'student', id: ids.a }],
    };
    const noSubject = await inject({
      method: 'POST',
      url: '/comms/requests/preview',
      headers: h(),
      json: { ...base, subject: '' },
    });
    expect(noSubject.statusCode).toBe(400);
    const pv = await inject({
      method: 'POST',
      url: '/comms/requests/preview',
      headers: h(),
      json: base,
    });
    expect(pv.statusCode).toBe(201);
    expect(pv.json().askValues).toEqual(['event_date']);
    const noMail = await inject({
      method: 'POST',
      url: '/comms/requests/test-email',
      headers: h(),
      json: { ...base, variables: { event_date: '20 Dec' } },
    });
    expect(noMail.statusCode).toBe(409);
    await withMigrator((c) =>
      c.query(`UPDATE users SET email = $2 WHERE id = $1`, [
        admin.id,
        `${s.toLowerCase()}@example.com`,
      ]),
    );
    const test = await inject({
      method: 'POST',
      url: '/comms/requests/test-email',
      headers: h(),
      json: { ...base, variables: { event_date: '20 Dec' } },
    });
    expect(test.statusCode).toBe(200);
    const testMsg = await withMigrator((c) =>
      c.query<{ subject: string; body: string; recipient_address: string }>(
        `SELECT subject, body, recipient_address FROM comms_messages WHERE id = $1`,
        [test.json().messageId],
      ),
    );
    expect(testMsg.rows[0]).toMatchObject({
      subject: '[Test] Annual day on 20 Dec',
      recipient_address: `${s.toLowerCase()}@example.com`,
    });
    expect(testMsg.rows[0]!.body).toContain('annual day is on <b>20 Dec</b> for Anu Eight');
    const sent = await inject({
      method: 'POST',
      url: '/comms/requests',
      headers: h(),
      json: { ...base, variables: { event_date: '20 Dec' } },
    });
    expect(sent.statusCode).toBe(201);
    expect(sent.json().channels).toEqual([
      expect.objectContaining({
        channel: 'email',
        custom: true,
        templateName: 'Own email (no template)',
      }),
    ]);
    const msg = await withMigrator((c) =>
      c.query<{ subject: string; body: string; template_id: string | null }>(
        `SELECT subject, body, template_id::text FROM comms_messages WHERE message_request_id = $1`,
        [sent.json().id],
      ),
    );
    expect(msg.rows[0]).toMatchObject({ subject: 'Annual day on 20 Dec', template_id: null });
    expect(msg.rows[0]!.body).not.toContain('<script>');
  });

  it('a template without {{body}} needs no message; one with {{body}} says the message is missing', async () => {
    const fixed = await inject({
      method: 'POST',
      url: '/comms/templates',
      headers: h(),
      json: {
        code: 'fixed_sms',
        channel: 'sms',
        name: 'Fixed SMS',
        body: 'School closed tomorrow. {{school}}',
        dltTemplateId: '1207160000000055555',
      },
    });
    const ok = await inject({
      method: 'POST',
      url: '/comms/requests/preview',
      headers: h(),
      json: {
        title: 'Closed',
        channels: [{ channel: 'sms', templateId: fixed.json().id }],
        audience: 'individuals',
        targets: [{ type: 'student', id: ids.a }],
      },
    });
    expect(ok.statusCode).toBe(201);
    const missing = await inject({
      method: 'POST',
      url: '/comms/requests/preview',
      headers: h(),
      json: {
        title: 'Closed',
        channels: [{ channel: 'sms', templateId: ids.sms }],
        audience: 'individuals',
        targets: [{ type: 'student', id: ids.a }],
      },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().detail).toMatch(/Write the message: Circular SMS has a place for it/);
  });

  it('approvers set to a named employee: the step goes to them and they read the message first', async () => {
    const t01User = await withMigrator(async (c) => {
      const u = await c.query<{ id: string }>(
        `INSERT INTO users (oneauth_sub, display_name) VALUES ($1, 'Tanvi Rao') RETURNING id::text`,
        [`${s}-tanvi`],
      );
      await c.query(
        `INSERT INTO user_school_memberships (school_id, user_id, person_type) VALUES ($1, $2, 'employee')`,
        [school.id, u.rows[0]!.id],
      );
      await c.query(
        `INSERT INTO user_roles (school_id, user_id, role_id, reason) SELECT $1, $2, id, 'e2e' FROM roles WHERE school_id IS NULL AND code = 'class_teacher'`,
        [school.id, u.rows[0]!.id],
      );
      await c.query(`UPDATE employees SET user_id = $2 WHERE id = $1`, [ids.t01, u.rows[0]!.id]);
      return u.rows[0]!.id;
    });
    const saved = await inject({
      method: 'PUT',
      url: '/comms/approvers',
      headers: h(),
      json: { roleCodes: [], employeeIds: [ids.t01] },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().people).toEqual([
      expect.objectContaining({ userId: t01User, name: 'Tanvi Rao' }),
    ]);
    const req = await inject({
      method: 'POST',
      url: '/comms/requests',
      headers: h(coordinator),
      json: {
        title: 'Sports day',
        body: 'Sports day on Friday.',
        channels: [{ channel: 'sms', templateId: ids.sms }],
        audience: 'individuals',
        targets: [{ type: 'student', id: ids.a }],
      },
    });
    expect(req.json()).toMatchObject({ status: 'pending_approval' });
    const tanvi = headersFor(`${s}-tanvi`, school.id);
    const inbox = await inject({ method: 'GET', url: '/workflow/inbox', headers: tanvi });
    const step = inbox
      .json()
      .data.find((x: { instance: { entityId: string } }) => x.instance.entityId === req.json().id);
    expect(step).toBeTruthy();
    expect(step.instance.payload.preview[0]).toMatchObject({ channel: 'sms' });
    expect(step.instance.payload.preview[0].text).toContain('Sports day on Friday.');
    const pv = await inject({
      method: 'GET',
      url: `/comms/requests/${req.json().id}/preview`,
      headers: tanvi,
    });
    expect(pv.statusCode).toBe(200);
    expect(pv.json().preview[0].text).toContain('Sports day on Friday.');
  });

  it('push: a parent registers a device; a send queues one push per device, only for events the admin switched on', async () => {
    await inject({
      method: 'PUT',
      url: '/comms/providers/push',
      headers: h(),
      json: {
        provider: 'fcm',
        config: {
          projectId: 'school-app',
          apiKey: 'AIza-test',
          messagingSenderId: '123',
          appId: '1:123:web:abc',
          vapidKey: 'BPublicVapidKeyForTesting',
        },
        secrets: {
          serviceAccount: JSON.stringify({
            project_id: 'school-app',
            client_email: 'x@y',
            private_key: 'k',
          }),
        },
      },
    });
    const ph = headersFor(parent.sub, school.id);
    const cfg = await inject({ method: 'GET', url: '/comms/push/config', headers: ph });
    expect(cfg.json()).toMatchObject({ enabled: true, vapidKey: 'BPublicVapidKeyForTesting' });
    expect(JSON.stringify(cfg.json())).not.toContain('private_key');
    const reg = await inject({
      method: 'POST',
      url: '/comms/push/devices',
      headers: ph,
      json: { token: `token-${s}-0123456789`, app: 'parent' },
    });
    expect(reg.json()).toEqual({ devices: 1 });
    const send = () =>
      inject({
        method: 'POST',
        url: '/comms/requests',
        headers: h(),
        json: {
          title: `Push check ${String(Math.random())}`,
          body: 'x',
          channels: [{ channel: 'sms', templateId: ids.sms }],
          audience: 'individuals',
          targets: [{ type: 'student', id: ids.a }],
          sendTo: 'parents',
        },
      });
    const countPush = async () =>
      (
        await withMigrator((c) =>
          c.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM comms_messages WHERE school_id = $1 AND channel = 'push' AND recipient_address = $2`,
            [school.id, `token-${s}-0123456789`],
          ),
        )
      ).rows[0]!.n;
    await withMigrator((c) =>
      c.query(
        `UPDATE comms_settings SET approval_threshold = 100, approval_exempt_roles = '{school_admin}' WHERE school_id = $1`,
        [school.id],
      ),
    );
    const before = await countPush();
    expect((await send()).json()).toMatchObject({ status: 'sent' });
    expect(await countPush()).toBe(before + 1);
    await withMigrator((c) =>
      c.query(`UPDATE comms_settings SET push_events = '{attendance}' WHERE school_id = $1`, [
        school.id,
      ]),
    );
    await send();
    expect(await countPush()).toBe(before + 1);
  });
});
