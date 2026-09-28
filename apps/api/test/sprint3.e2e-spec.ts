/**
 * Sprint 3 API surface: notification templates and delivery log (S3-02), export requests (S3-03),
 * audit query and export (S3-04), dead-letter visibility (S3-01).
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

describe('comms, reports, audit and jobs (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  let member: SeededUser;
  let auditor: SeededUser;
  let outsider: SeededUser;
  let other: SeededSchool;

  beforeAll(async () => {
    const s = stamp('S3');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      other = await seedSchool(c, `${s}B`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
      member = await seedUser(c, school, `${s}-member`);
      auditor = await seedUser(c, school, `${s}-auditor`, 'auditor');
      outsider = await seedUser(c, other, `${s}-outsider`, 'school_admin');
    });
    app = await createApp();
    inject = injector(app);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  const A = (sub: string) => headersFor(sub, school.id);
  let templateId: string;
  let messageId: string;

  describe('templates', () => {
    it('requires DLT ids for SMS and a subject for email; derives variables from the body', async () => {
      const noDlt = await inject({
        method: 'POST',
        url: '/comms/templates',
        headers: A(admin.sub),
        json: {
          code: 'fee_due',
          channel: 'sms',
          name: 'Fee due',
          body: 'Dear {{name}}, {{amount}} is due',
        },
      });
      expect(noDlt.statusCode).toBe(400);
      const res = await inject({
        method: 'POST',
        url: '/comms/templates',
        headers: A(admin.sub),
        json: {
          code: 'fee_due',
          channel: 'sms',
          name: 'Fee due',
          body: 'Dear {{name}}, {{amount}} is due',
          dltTemplateId: '1107160000000000001',
          dltEntityId: '1101000000000000001',
          senderId: 'EDUPRO',
        },
      });
      expect(res.statusCode).toBe(201);
      templateId = res.json().id;
      expect(res.json().variables).toEqual(['name', 'amount']);
      const email = await inject({
        method: 'POST',
        url: '/comms/templates',
        headers: A(admin.sub),
        json: { code: 'welcome', channel: 'email', name: 'Welcome', body: 'Hello {{name}}' },
      });
      expect(email.statusCode).toBe(400);
      const dup = await inject({
        method: 'POST',
        url: '/comms/templates',
        headers: A(admin.sub),
        json: { code: 'fee_due', channel: 'sms', name: 'Again', body: 'x', dltTemplateId: '1' },
      });
      expect(dup.statusCode).toBe(409);
    });

    it('lists, updates and is visible to a teacher but not editable by one', async () => {
      const list = await inject({
        method: 'GET',
        url: '/comms/templates?channel=sms',
        headers: A(teacher.sub),
      });
      expect(list.statusCode).toBe(200);
      expect(list.json().data.some((t: { id: string }) => t.id === templateId)).toBe(true);
      const edit = await inject({
        method: 'PATCH',
        url: `/comms/templates/${templateId}`,
        headers: A(teacher.sub),
        json: { name: 'Nope' },
      });
      expect(edit.statusCode).toBe(403);
      const ok = await inject({
        method: 'PATCH',
        url: `/comms/templates/${templateId}`,
        headers: A(admin.sub),
        json: { body: 'Dear {{name}}, {{amount}} is due on {{due}}' },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().variables).toEqual(['name', 'amount', 'due']);
      const outside = await inject({
        method: 'GET',
        url: `/comms/templates/${templateId}`,
        headers: headersFor(outsider.sub, other.id),
      });
      expect(outside.statusCode).toBe(404);
    });
  });

  describe('messages', () => {
    it('renders for a member recipient and queues an outbox job in the same transaction', async () => {
      const missing = await inject({
        method: 'POST',
        url: '/comms/messages',
        headers: A(teacher.sub),
        json: { templateId, recipientUserId: member.id, variables: { name: 'Asha' } },
      });
      expect(missing.statusCode).toBe(400);
      expect(missing.json().missing).toEqual(['amount', 'due']);
      const res = await inject({
        method: 'POST',
        url: '/comms/messages',
        headers: A(teacher.sub),
        json: {
          templateId,
          recipientUserId: member.id,
          variables: { name: 'Asha', amount: '₹1,200', due: '10 Oct' },
        },
      });
      expect(res.statusCode).toBe(201);
      messageId = res.json().id;
      expect(res.json()).toMatchObject({
        status: 'queued',
        channel: 'sms',
        body: 'Dear Asha, ₹1,200 is due on 10 Oct',
        recipientUserId: member.id,
      });
      const outbox = await inject({
        method: 'GET',
        url: '/platform/jobs/outbox?queue=notifications',
        headers: A(admin.sub),
      });
      expect(outbox.statusCode).toBe(200);
      expect(
        outbox
          .json()
          .data.some(
            (j: { kind: string; status: string }) =>
              j.kind === 'comms.message' && j.status === 'pending',
          ),
      ).toBe(true);
      const nonMember = await inject({
        method: 'POST',
        url: '/comms/messages',
        headers: A(teacher.sub),
        json: {
          templateId,
          recipientUserId: outsider.id,
          variables: { name: 'x', amount: 'y', due: 'z' },
        },
      });
      expect(nonMember.statusCode).toBe(409);
    });

    it('shows the delivery log and cancels a queued message once', async () => {
      const list = await inject({
        method: 'GET',
        url: `/comms/messages?recipientUserId=${member.id}`,
        headers: A(admin.sub),
      });
      expect(list.statusCode).toBe(200);
      expect(list.json().data[0]).toMatchObject({ id: messageId, status: 'queued' });
      const teacherLog = await inject({
        method: 'GET',
        url: '/comms/messages',
        headers: A(teacher.sub),
      });
      expect(teacherLog.statusCode).toBe(403);
      const cancel = await inject({
        method: 'POST',
        url: `/comms/messages/${messageId}/cancel`,
        headers: A(admin.sub),
      });
      expect(cancel.statusCode).toBe(200);
      expect(cancel.json().status).toBe('cancelled');
      const again = await inject({
        method: 'POST',
        url: `/comms/messages/${messageId}/cancel`,
        headers: A(admin.sub),
      });
      expect(again.statusCode).toBe(409);
    });
  });

  describe('exports', () => {
    let exportId: string;

    it('lists only datasets the caller may export and refuses the others', async () => {
      const adminSets = await inject({
        method: 'GET',
        url: '/reports/datasets',
        headers: A(admin.sub),
      });
      expect(
        adminSets
          .json()
          .data.map((d: { id: string }) => d.id)
          .sort(),
      ).toEqual([
        // Sprint 13 added the department report-centre datasets; the admin holds every permission
        'admissions_funnel',
        'assignments',
        'attendance_daily',
        'audit_logs',
        'class_sections',
        'classes',
        'comms_delivery',
        'employees',
        'fee_dues',
        'fee_receipts',
        'fee_refunds',
        'lesson_plans',
        'members',
        'parent_queries',
        'settlement_lines',
        'substitutions',
        'transport_requests',
        'transport_riders',
        'transport_vehicle_logs',
      ]);
      const teacherSets = await inject({
        method: 'GET',
        url: '/reports/datasets',
        headers: A(teacher.sub),
      });
      expect(
        teacherSets
          .json()
          .data.map((d: { id: string }) => d.id)
          .sort(),
      ).toEqual([
        'attendance_daily',
        'class_sections',
        'classes',
        'lesson_plans',
        'parent_queries',
        'substitutions',
      ]);
      const refused = await inject({
        method: 'POST',
        url: '/reports/exports',
        headers: A(teacher.sub),
        json: { dataset: 'members' },
      });
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toMatchObject({
        type: 'permission-denied',
        permission: 'access.assignment.view',
      });
    });

    it('queues an export with an outbox job and reports status until the worker finishes', async () => {
      const res = await inject({
        method: 'POST',
        url: '/reports/exports',
        headers: A(teacher.sub),
        json: { dataset: 'classes', format: 'csv' },
      });
      expect(res.statusCode).toBe(201);
      exportId = res.json().id;
      expect(res.json()).toMatchObject({
        status: 'queued',
        dataset: 'classes',
        format: 'csv',
        title: 'Classes',
        requestedBy: teacher.id,
      });
      const status = await inject({
        method: 'GET',
        url: `/reports/exports/${exportId}`,
        headers: A(teacher.sub),
      });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toMatchObject({
        export: { id: exportId, status: 'queued' },
        download: null,
      });
      const mine = await inject({
        method: 'GET',
        url: '/reports/exports',
        headers: A(teacher.sub),
      });
      expect(mine.json().data.map((e: { id: string }) => e.id)).toContain(exportId);
      const outbox = await inject({
        method: 'GET',
        url: '/platform/jobs/outbox?queue=exports',
        headers: A(admin.sub),
      });
      expect(outbox.json().data.some((j: { kind: string }) => j.kind === 'export.generate')).toBe(
        true,
      );
    });

    it('adds the class section scope of the requester to the parameters', async () => {
      const cls = await inject({
        method: 'POST',
        url: '/academics/classes',
        headers: A(admin.sub),
        json: { code: 'IX', name: 'Class IX' },
      });
      const secA = await inject({
        method: 'POST',
        url: `/academics/classes/${cls.json().id}/sections`,
        headers: A(admin.sub),
        json: { name: 'A' },
      });
      await inject({
        method: 'POST',
        url: `/academics/classes/${cls.json().id}/sections`,
        headers: A(admin.sub),
        json: { name: 'B' },
      });
      const roles = await inject({ method: 'GET', url: '/access/roles', headers: A(admin.sub) });
      const classTeacher = roles
        .json()
        .data.find((r: { code: string }) => r.code === 'class_teacher');
      const assignment = (
        await inject({
          method: 'GET',
          url: `/access/assignments?userId=${teacher.id}`,
          headers: A(admin.sub),
        })
      )
        .json()
        .data.find((a: { roleId: string }) => a.roleId === classTeacher.id);
      const scoped = await inject({
        method: 'PUT',
        url: `/access/assignments/${assignment.id}/scopes`,
        headers: A(admin.sub),
        json: { scopes: [{ type: 'class_section', id: secA.json().id }] },
      });
      expect(scoped.statusCode).toBe(200);
      const res = await inject({
        method: 'POST',
        url: '/reports/exports',
        headers: A(teacher.sub),
        json: { dataset: 'class_sections' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().params).toMatchObject({
        sectionIds: [secA.json().id],
        academicYearId: school.yearId,
      });
    });
  });

  describe('audit', () => {
    it('shows rows written inside the service transaction, with before and after on the detail', async () => {
      const list = await inject({
        method: 'GET',
        url: `/platform/audit?action=comms.message&entityId=${messageId}`,
        headers: A(admin.sub),
      });
      expect(list.statusCode).toBe(200);
      const actions = list.json().data.map((r: { action: string }) => r.action);
      expect(actions).toEqual(
        expect.arrayContaining(['comms.message.send', 'comms.message.cancel']),
      );
      const cancel = list
        .json()
        .data.find((r: { action: string }) => r.action === 'comms.message.cancel');
      expect(cancel).toMatchObject({
        actorUserId: admin.id,
        entityType: 'comms_messages',
        permissionCode: 'comms.message.send',
        diff: { status: { from: 'queued', to: 'cancelled' } },
      });
      const detail = await inject({
        method: 'GET',
        url: `/platform/audit/${cancel.id}`,
        headers: A(admin.sub),
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toMatchObject({
        before: { status: 'queued' },
        after: { status: 'cancelled' },
      });
      const teacherView = await inject({
        method: 'GET',
        url: '/platform/audit',
        headers: A(teacher.sub),
      });
      expect(teacherView.statusCode).toBe(403);
    });

    it('exports the audit log as a job and audits the export itself (auditor, not the admin: SoD)', async () => {
      const sod = await inject({
        method: 'POST',
        url: '/platform/audit/export',
        headers: A(admin.sub),
        json: { format: 'xlsx' },
      });
      expect(sod.statusCode).toBe(403);
      expect(sod.json()).toMatchObject({
        type: 'permission-denied',
        permission: 'platform.audit.export',
      });
      const res = await inject({
        method: 'POST',
        url: '/platform/audit/export',
        headers: A(auditor.sub),
        json: { format: 'xlsx', params: { action: 'comms' } },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        dataset: 'audit_logs',
        status: 'queued',
        params: { action: 'comms' },
      });
      const audited = await inject({
        method: 'GET',
        url: `/platform/audit?action=platform.audit.export&entityId=${res.json().id}`,
        headers: A(admin.sub),
      });
      expect(audited.json().data).toHaveLength(1);
      expect(audited.json().data[0]).toMatchObject({
        permissionCode: 'platform.audit.export',
        entityType: 'exports',
      });
    });
  });

  describe('jobs', () => {
    it('retries only failed jobs and never exposes payloads', async () => {
      const list = await inject({
        method: 'GET',
        url: '/platform/jobs/outbox?status=pending',
        headers: A(admin.sub),
      });
      expect(list.statusCode).toBe(200);
      const pending = list.json().data[0];
      expect(pending.payload).toBeUndefined();
      const notFailed = await inject({
        method: 'POST',
        url: `/platform/jobs/outbox/${pending.id}/retry`,
        headers: A(admin.sub),
      });
      expect(notFailed.statusCode).toBe(409);
      await withMigrator((c) =>
        c.query(
          "UPDATE jobs_outbox SET status = 'failed', attempts = 5, last_error = 'boom' WHERE id = $1",
          [pending.id],
        ),
      );
      const dead = await inject({
        method: 'GET',
        url: '/platform/jobs/outbox?status=failed',
        headers: A(admin.sub),
      });
      expect(dead.json().data.map((j: { id: string }) => j.id)).toContain(pending.id);
      const retry = await inject({
        method: 'POST',
        url: `/platform/jobs/outbox/${pending.id}/retry`,
        headers: A(admin.sub),
      });
      expect(retry.statusCode).toBe(201);
      expect(retry.json()).toMatchObject({ status: 'pending', attempts: 0 });
      const teacher403 = await inject({
        method: 'GET',
        url: '/platform/jobs/outbox',
        headers: A(teacher.sub),
      });
      expect(teacher403.statusCode).toBe(403);
    });
  });
});
