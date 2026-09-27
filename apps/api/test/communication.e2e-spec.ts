/**
 * Sprint 10 communication: consent (DPDP), message requests to an audience with a recipient preview, approval
 * through the workflow inbox, dispatch into the delivery log with consent applied, delivery receipts, groups,
 * rejection and cancellation.
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

describe('communication (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let coordinator: SeededUser;
  let parentA: SeededUser;
  let parentB: SeededUser;
  let sectionId: string;
  let templateId: string;
  let requestId: string;
  const h = () => headersFor(admin.sub, school.id);

  beforeAll(async () => {
    const s = stamp('C10');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      coordinator = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
      parentA = await seedUser(c, school, `${s}-pa`, 'parent', 'guardian');
      parentB = await seedUser(c, school, `${s}-pb`, 'parent', 'guardian');
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'VII', name: 'Class VII', displayOrder: 7 },
    });
    const sec = await inject({
      method: 'POST',
      url: `/academics/classes/${cls.json().id}/sections`,
      headers: h(),
      json: { name: 'A' },
    });
    sectionId = sec.json().id;
    const mk = (adm: string, first: string, mobile: string | null, roll: number) =>
      inject({
        method: 'POST',
        url: '/people/students',
        headers: h(),
        json: {
          admissionNo: adm,
          firstName: first,
          lastName: 'Ten',
          guardians: [
            {
              guardian: {
                firstName: `${first} Parent`,
                lastName: 'Ten',
                mobile: mobile ?? undefined,
              },
              relation: 'father',
              isPrimary: true,
            },
          ],
          enrolment: { classSectionId: sectionId, rollNo: roll },
        },
      });
    await mk('C10-1', 'Asha', '9876510001', 1);
    await mk('C10-2', 'Bhavya', '9876510002', 2);
    await mk('C10-3', 'Chirag', null, 3); // no mobile: skipped
    await withMigrator(async (c) => {
      await c.query(
        `UPDATE guardians SET user_id = $1 WHERE school_id = $2 AND mobile = '9876510001'`,
        [parentA.id, school.id],
      );
      await c.query(
        `UPDATE guardians SET user_id = $1 WHERE school_id = $2 AND mobile = '9876510002'`,
        [parentB.id, school.id],
      );
    });
    const t = await inject({
      method: 'POST',
      url: '/comms/templates',
      headers: h(),
      json: {
        code: 'circular_whatsapp',
        channel: 'whatsapp',
        name: 'Circular (WhatsApp)',
        body: 'Dear {{guardian_name}}, {{title}}: {{body}} — {{school}}',
        variables: ['guardian_name', 'title', 'body', 'school'],
      },
    });
    expect(t.statusCode).toBe(201);
    templateId = t.json().id;
    await inject({ method: 'POST', url: '/workflow/definitions/defaults', headers: h() });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('records consent for the signed-in guardian and refuses unknown purposes', async () => {
    const mine = await inject({
      method: 'GET',
      url: '/comms/consents/mine',
      headers: headersFor(parentB.sub, school.id),
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().purposes.map((p: { code: string }) => p.code)).toEqual([
      'comms.sms',
      'comms.whatsapp',
      'comms.email',
      'media.gallery',
      'transport.tracking',
      'ai.assistant',
    ]);
    expect(mine.json().purposes[1].status).toBeNull();
    const w = await inject({
      method: 'POST',
      url: '/comms/consents/mine',
      headers: headersFor(parentB.sub, school.id),
      json: { purposeCode: 'comms.whatsapp', status: 'withdrawn' },
    });
    expect(w.statusCode).toBe(201);
    expect(
      w.json().purposes.find((p: { code: string }) => p.code === 'comms.whatsapp'),
    ).toMatchObject({ status: 'withdrawn', source: 'parent_app' });
    const bad = await inject({
      method: 'POST',
      url: '/comms/consents/mine',
      headers: headersFor(parentB.sub, school.id),
      json: { purposeCode: 'nope', status: 'granted' },
    });
    expect(bad.statusCode).toBe(404);
    const office = await inject({
      method: 'GET',
      url: `/comms/consents?userId=${parentB.id}`,
      headers: h(),
    });
    expect(office.json().history).toHaveLength(1);
    const staffSelf = await inject({ method: 'GET', url: '/comms/consents/mine', headers: h() });
    expect(staffSelf.statusCode).toBe(403); // consent.self is a family permission
  });

  it('previews the audience with skips (no address, consent withdrawn), then routes the request to approval', async () => {
    const draft = {
      title: 'PTM on Saturday',
      templateId,
      body: 'Parent-teacher meeting at 10:00 in the school hall.',
      audience: 'class_section',
      targets: [{ type: 'class_section', id: sectionId }],
    };
    const preview = await inject({
      method: 'POST',
      url: '/comms/requests/preview',
      headers: headersFor(coordinator.sub, school.id),
      json: draft,
    });
    expect(preview.statusCode).toBe(201);
    expect(preview.json()).toMatchObject({
      total: 1,
      skipped: 2,
      skippedReasons: { no_address: 1, consent_withdrawn: 1 },
    });
    const service = await inject({
      method: 'POST',
      url: '/comms/requests/preview',
      headers: headersFor(coordinator.sub, school.id),
      json: { ...draft, category: 'service' },
    });
    expect(service.json()).toMatchObject({
      total: 2,
      skipped: 1,
      skippedReasons: { no_address: 1 },
    }); // service messages ignore marketing consent
    const created = await inject({
      method: 'POST',
      url: '/comms/requests',
      headers: headersFor(coordinator.sub, school.id),
      json: draft,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      status: 'pending_approval',
      recipientsTotal: 1,
      recipientsSkipped: 2,
      targetLabels: ['VII-A'],
    });
    expect(created.json().workflowInstanceId).not.toBeNull();
    requestId = created.json().id;
    const inbox = await inject({ method: 'GET', url: '/workflow/inbox', headers: h() });
    expect(
      inbox
        .json()
        .data.some((s: { instance: { entityId: string } }) => s.instance.entityId === requestId),
    ).toBe(true);
    const parentView = await inject({
      method: 'GET',
      url: '/comms/requests',
      headers: headersFor(parentA.sub, school.id),
    });
    expect(parentView.statusCode).toBe(403);
  });

  it('approval dispatches one message per recipient and the request shows delivery counts', async () => {
    const inbox = await inject({ method: 'GET', url: '/workflow/inbox', headers: h() });
    const step = inbox
      .json()
      .data.find((s: { instance: { entityId: string } }) => s.instance.entityId === requestId);
    const approved = await inject({
      method: 'POST',
      url: `/workflow/steps/${step.id}/approve`,
      headers: h(),
      json: { note: 'Go ahead' },
    });
    expect(approved.json().status).toBe('approved');
    const req = await inject({ method: 'GET', url: `/comms/requests/${requestId}`, headers: h() });
    expect(req.json()).toMatchObject({
      status: 'sent',
      recipientsTotal: 1,
      recipientsSkipped: 2,
      decisionNote: 'Go ahead',
      delivery: { queued: 1 },
    });
    const recipients = req.json().recipients as Array<{
      address: string | null;
      skippedReason: string | null;
      status: string | null;
      student: string | null;
    }>;
    expect(recipients).toHaveLength(3);
    const sent = recipients.find((r) => !r.skippedReason)!;
    expect(sent).toMatchObject({ address: '******0001', status: 'queued', student: 'Asha Ten' });
    expect(recipients.map((r) => r.skippedReason ?? 'sent').sort()).toEqual([
      'consent_withdrawn',
      'no_address',
      'sent',
    ]);
    const messages = await inject({
      method: 'GET',
      url: `/comms/messages?recipientUserId=${parentA.id}`,
      headers: h(),
    });
    expect(messages.json().data[0].body).toBe(
      'Dear Asha Parent Ten, PTM on Saturday: Parent-teacher meeting at 10:00 in the school hall. — ' +
        messages.json().data[0].body.split('— ')[1],
    );
    expect(messages.json().data[0].body).toContain('PTM on Saturday');
  });

  it('applies provider delivery receipts once, with the shared token', async () => {
    const messages = await inject({
      method: 'GET',
      url: `/comms/messages?recipientUserId=${parentA.id}`,
      headers: h(),
    });
    const messageId = messages.json().data[0].id as string;
    const ref = `WA-${Date.now()}`;
    await withMigrator((c) =>
      c.query(
        `UPDATE comms_messages SET status = 'sent', provider = 'whatsapp-http', provider_message_id = $2, sent_at = now() WHERE id = $1`,
        [messageId, ref],
      ),
    );
    const noToken = await inject({
      method: 'POST',
      url: '/comms/delivery/webhook',
      headers: {},
      json: { provider: 'whatsapp-http', messageId: ref, status: 'delivered' },
    });
    expect(noToken.statusCode).toBe(401);
    const ok = await inject({
      method: 'POST',
      url: '/comms/delivery/webhook',
      headers: { 'x-webhook-token': process.env.COMMS_WEBHOOK_TOKEN ?? 'dev-comms-webhook-token' },
      json: { provider: 'whatsapp-http', messageId: ref, status: 'delivered' },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ outcome: 'applied', messageId });
    const again = await inject({
      method: 'POST',
      url: '/comms/delivery/webhook',
      headers: { 'x-webhook-token': process.env.COMMS_WEBHOOK_TOKEN ?? 'dev-comms-webhook-token' },
      json: { provider: 'whatsapp-http', messageId: ref, status: 'delivered' },
    });
    expect(again.json()).toMatchObject({ outcome: 'duplicate' });
    const unknown = await inject({
      method: 'POST',
      url: '/comms/delivery/webhook',
      headers: { 'x-webhook-token': process.env.COMMS_WEBHOOK_TOKEN ?? 'dev-comms-webhook-token' },
      json: { provider: 'whatsapp-http', messageId: 'nope', status: 'failed' },
    });
    expect(unknown.json()).toMatchObject({ outcome: 'unknown_message' });
    const req = await inject({ method: 'GET', url: `/comms/requests/${requestId}`, headers: h() });
    expect(req.json().delivery).toEqual({ delivered: 1 });
  });

  it('groups, rejection and cancellation', async () => {
    const group = await inject({
      method: 'POST',
      url: '/comms/groups',
      headers: h(),
      json: { code: 'pta', name: 'PTA members', userIds: [parentA.id, parentB.id] },
    });
    expect(group.statusCode).toBe(201);
    expect(group.json().members).toBe(2);
    const members = await inject({
      method: 'GET',
      url: `/comms/groups/${group.json().id}/members`,
      headers: h(),
    });
    expect(members.json().data).toHaveLength(2);
    const toGroup = {
      title: 'PTA meeting',
      templateId,
      body: 'Meeting on Friday.',
      audience: 'group',
      targets: [{ type: 'group', id: group.json().id }],
    };
    const preview = await inject({
      method: 'POST',
      url: '/comms/requests/preview',
      headers: h(),
      json: toGroup,
    });
    expect(preview.json()).toMatchObject({
      total: 1,
      skipped: 1,
      skippedReasons: { consent_withdrawn: 1 },
    });
    const r2 = await inject({
      method: 'POST',
      url: '/comms/requests',
      headers: h(),
      json: toGroup,
    });
    const inbox = await inject({ method: 'GET', url: '/workflow/inbox', headers: h() });
    const step = inbox
      .json()
      .data.find((s: { instance: { entityId: string } }) => s.instance.entityId === r2.json().id);
    await inject({
      method: 'POST',
      url: `/workflow/steps/${step.id}/reject`,
      headers: h(),
      json: { note: 'Not this week' },
    });
    const rejected = await inject({
      method: 'GET',
      url: `/comms/requests/${r2.json().id}`,
      headers: h(),
    });
    expect(rejected.json()).toMatchObject({
      status: 'rejected',
      decisionNote: 'Not this week',
      recipients: [],
    });
    const r3 = await inject({
      method: 'POST',
      url: '/comms/requests',
      headers: h(),
      json: { ...toGroup, title: 'Cancelled one' },
    });
    const cancelled = await inject({
      method: 'POST',
      url: `/comms/requests/${r3.json().id}/cancel`,
      headers: h(),
    });
    expect(cancelled.json().status).toBe('cancelled');
    const nobody = await inject({
      method: 'POST',
      url: '/comms/requests',
      headers: h(),
      json: { ...toGroup, targets: [{ type: 'user', id: parentB.id }], audience: 'individuals' },
    });
    expect(nobody.statusCode).toBe(409);
    expect(nobody.json()).toMatchObject({ type: 'comms.request.no_recipients' });
    const list = await inject({ method: 'GET', url: '/comms/requests?status=sent', headers: h() });
    expect(list.json().page.total).toBe(1);
  });
});
