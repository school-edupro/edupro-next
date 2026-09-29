/**
 * Sprints 22 and 23: cut-over runs with timed steps and reconciliation sign-off, hypercare issues
 * against the severity SLAs, pilot feature flags, the month-end close and the period lock that refuses
 * back-dated receipts.
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

describe('pilot cut-over, hypercare and month-end close (e2e, Sprints 22-23)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  let accountant: SeededUser;
  let s: string;
  let studentId: string;
  const h = (u: SeededUser = admin, extra = '') => headersFor(`${u.sub}${extra}`, school.id);

  beforeAll(async () => {
    s = stamp('S22');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
      accountant = await seedUser(c, school, `${s}-acc`, 'accountant');
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'VIII', name: 'Class VIII', displayOrder: 8 },
    });
    const sec = await inject({
      method: 'POST',
      url: `/academics/classes/${cls.json().id}/sections`,
      headers: h(),
      json: { name: 'A' },
    });
    const st = await inject({
      method: 'POST',
      url: '/people/students',
      headers: h(),
      json: {
        admissionNo: `${s}-1`,
        firstName: 'Riya',
        lastName: 'TwentyTwo',
        guardians: [
          {
            guardian: { firstName: 'Anil', lastName: 'TwentyTwo', mobile: '9876522001' },
            relation: 'father',
            isPrimary: true,
          },
        ],
        enrolment: { classSectionId: sec.json().id, rollNo: 1 },
      },
    });
    expect(st.statusCode).toBe(201);
    studentId = st.json().id;
  });
  afterAll(async () => {
    await app.close();
  });

  describe('cut-over runs', () => {
    it('installs the runbook steps, times them, reconciles the counts and signs off', async () => {
      const run = await inject({
        method: 'POST',
        url: '/ops/cutover/runs',
        headers: h(),
        json: { kind: 'rehearsal', name: 'Rehearsal 2' },
      });
      expect(run.statusCode).toBe(201);
      const runId = run.json().id as string;
      const steps = run.json().steps as Array<{
        id: string;
        code: string;
        phase: string;
        status: string;
      }>;
      expect(steps.length).toBeGreaterThan(20);
      expect(steps[0]).toMatchObject({ code: 'uat_signed', phase: 'readiness', status: 'pending' });
      // sign-off refused: steps pending
      const early = await inject({
        method: 'POST',
        url: `/ops/cutover/runs/${runId}/sign-off`,
        headers: h(),
      });
      expect(early.statusCode).toBe(409);
      for (const st of steps) {
        const r = await inject({
          method: 'PUT',
          url: `/ops/cutover/runs/${runId}/steps/${st.id}`,
          headers: h(),
          json: { status: st.code === 'restore_drill' ? 'skipped' : 'done', durationS: 60 },
        });
        expect(r.statusCode).toBe(200);
      }
      const timed = await inject({
        method: 'GET',
        url: `/ops/cutover/runs/${runId}`,
        headers: h(),
      });
      expect(timed.json()).toMatchObject({
        status: 'running',
        doneSteps: steps.length - 1,
        durationS: steps.length * 60,
      });
      // reconciliation: live snapshot, then legacy counts that differ, then matching ones
      const live = await inject({
        method: 'POST',
        url: `/ops/cutover/runs/${runId}/snapshots/live`,
        headers: h(),
      });
      expect(live.statusCode).toBe(201);
      const liveCounts = (
        live.json().snapshots as Array<{ source: string; counts: Record<string, number> }>
      ).find((x) => x.source === 'live')!.counts;
      expect(Number(liveCounts.students)).toBe(1);
      expect(Number(liveCounts.enrolments)).toBe(1);
      const wrong = await inject({
        method: 'POST',
        url: `/ops/cutover/runs/${runId}/snapshots/legacy`,
        headers: h(),
        json: { counts: { ...liveCounts, students: 2 } },
      });
      expect(wrong.json().reconciliation).toMatchObject({ ready: true, mismatches: 1 });
      const refused = await inject({
        method: 'POST',
        url: `/ops/cutover/runs/${runId}/sign-off`,
        headers: h(),
      });
      expect(refused.statusCode).toBe(409);
      expect(refused.json().type).toBe('cutover.reconciliation_failed');
      await inject({
        method: 'POST',
        url: `/ops/cutover/runs/${runId}/snapshots/legacy`,
        headers: h(),
        json: { counts: liveCounts },
      });
      const signed = await inject({
        method: 'POST',
        url: `/ops/cutover/runs/${runId}/sign-off`,
        headers: h(),
      });
      expect(signed.statusCode).toBe(201);
      expect(signed.json()).toMatchObject({ status: 'done' });
      expect(signed.json().signedOffBy).toBeTruthy();
      const denied = await inject({ method: 'GET', url: '/ops/cutover/runs', headers: h(teacher) });
      expect(denied.statusCode).toBe(403);
    });
  });

  describe('hypercare', () => {
    it('a teacher reports, the admin triages against the SLA, the reporter follows it', async () => {
      const r = await inject({
        method: 'POST',
        url: '/ops/hypercare/issues',
        headers: h(teacher),
        json: {
          title: 'Attendance page slow',
          module: 'attendance',
          severity: 's2',
          channel: 'teacher_app',
          detail: 'Takes 20 s to open VIII-A',
        },
      });
      expect(r.statusCode).toBe(201);
      expect(r.json()).toMatchObject({ number: 'HC/001', status: 'open', severity: 's2' });
      const due = new Date(r.json().dueAt).getTime() - new Date(r.json().createdAt).getTime();
      expect(Math.round(due / 36e5)).toBe(24);
      // the teacher cannot open the board, but sees their own
      const board = await inject({
        method: 'GET',
        url: '/ops/hypercare/issues',
        headers: h(teacher),
      });
      expect(board.statusCode).toBe(403);
      const mine = await inject({
        method: 'GET',
        url: '/ops/hypercare/issues/mine',
        headers: h(teacher),
      });
      expect((mine.json().data as Array<{ number: string }>).map((x) => x.number)).toEqual([
        'HC/001',
      ]);
      const triaged = await inject({
        method: 'PUT',
        url: `/ops/hypercare/issues/${r.json().id}`,
        headers: h(),
        json: {
          status: 'in_progress',
          severity: 's1',
          assignedRole: 'platform',
          body: 'Index missing on attendance_marks',
        },
      });
      expect(triaged.statusCode).toBe(200);
      expect(triaged.json()).toMatchObject({ status: 'in_progress', severity: 's1' });
      const due1 =
        new Date(triaged.json().dueAt).getTime() - new Date(triaged.json().createdAt).getTime();
      expect(Math.round(due1 / 36e5)).toBe(4);
      expect(triaged.json().updates.length).toBe(2);
      const closed = await inject({
        method: 'PUT',
        url: `/ops/hypercare/issues/${r.json().id}`,
        headers: h(),
        json: { status: 'closed', resolution: 'Index added in the hotfix lane' },
      });
      expect(closed.json()).toMatchObject({ status: 'closed', overdue: false });
      expect(closed.json().closedAt).toBeTruthy();
      const list = await inject({
        method: 'GET',
        url: '/ops/hypercare/issues?severity=s1',
        headers: h(),
      });
      expect(
        list.json().summary.find((x: { severity: string }) => x.severity === 's1'),
      ).toMatchObject({ open: 0 });
    });
  });

  describe('feature flags', () => {
    it('lists every module enabled by default and honours the pilot setting', async () => {
      const f = await inject({ method: 'GET', url: '/ops/features', headers: h(teacher) });
      expect(f.statusCode).toBe(200);
      expect(f.json().modules.every((m: { enabled: boolean }) => m.enabled)).toBe(true);
      await inject({
        method: 'PUT',
        url: '/platform/settings/platform.modules_enabled',
        headers: h(),
        json: {
          value: 'people,fees,attendance,academics,communication,engagement,exams,reports,system',
        },
      });
      const g = await inject({ method: 'GET', url: '/ops/features', headers: h(teacher) });
      const off = (g.json().modules as Array<{ module: string; enabled: boolean }>)
        .filter((m) => !m.enabled)
        .map((m) => m.module);
      expect(off).toEqual(expect.arrayContaining(['library', 'transport', 'insights']));
    });
  });

  describe('month-end close', () => {
    it('runs the checks, closes with a second factor, refuses back-dated receipts, reopens with a reason', async () => {
      const month = '2026-08';
      const state = await inject({
        method: 'GET',
        url: `/fees/month-end/${month}`,
        headers: h(accountant),
      });
      expect(state.statusCode).toBe(200);
      expect(state.json()).toMatchObject({
        month,
        start: '2026-08-01',
        end: '2026-08-31',
        close: { status: 'open' },
      });
      expect(state.json().checks.length).toBeGreaterThanOrEqual(8);
      const stale = await inject({
        method: 'POST',
        url: `/fees/month-end/${month}/close`,
        headers: h(accountant, ';mfa=false'),
        json: { pack: false },
      });
      expect(stale.statusCode).toBe(403);
      const closed = await inject({
        method: 'POST',
        url: `/fees/month-end/${month}/close`,
        headers: h(accountant, ';mfa=true'),
        json: { pack: false, note: 'First live close' },
      });
      expect(closed.statusCode).toBe(201);
      expect(closed.json()).toMatchObject({
        lockedThrough: '2026-08-31',
        close: { status: 'closed', note: 'First live close' },
      });
      // a receipt dated inside the closed month is refused; a later one is not
      const backdated = await inject({
        method: 'POST',
        url: '/payments/receipts',
        headers: h(accountant),
        json: {
          studentId,
          amount: 100,
          mode: 'cash',
          receivedOn: '2026-08-15',
          ledger: 'school',
          collectLateFee: true,
        },
      });
      expect(backdated.statusCode).toBe(409);
      expect(backdated.json().type).toBe('fees.period_locked');
      const misc = await inject({
        method: 'POST',
        url: '/fees/misc/receipts',
        headers: h(accountant),
        json: {
          payerKind: 'other',
          payerName: 'Vendor',
          amount: 50,
          mode: 'cash',
          receivedOn: '2026-08-20',
          headCode: 'MISC',
        },
      });
      expect([409, 400, 404]).toContain(misc.statusCode);
      if (misc.statusCode === 409) expect(misc.json().type).toBe('fees.period_locked');
      const again = await inject({
        method: 'POST',
        url: `/fees/month-end/${month}/close`,
        headers: h(accountant, ';mfa=true'),
        json: { pack: false },
      });
      expect(again.statusCode).toBe(409);
      const reopened = await inject({
        method: 'POST',
        url: `/fees/month-end/${month}/reopen`,
        headers: h(accountant, ';mfa=true'),
        json: { reason: 'Late cheque from the bank' },
      });
      expect(reopened.statusCode).toBe(201);
      expect(reopened.json()).toMatchObject({ lockedThrough: null, close: { status: 'open' } });
      const locks = await inject({
        method: 'GET',
        url: '/fees/period-locks',
        headers: h(accountant),
      });
      expect(
        (
          locks.json().data as Array<{ releasedAt: string | null; releaseReason: string | null }>
        )[0],
      ).toMatchObject({ releaseReason: 'Late cheque from the bank' });
      const denied = await inject({
        method: 'GET',
        url: `/fees/month-end/${month}`,
        headers: h(teacher),
      });
      expect(denied.statusCode).toBe(403);
    });
  });
});
