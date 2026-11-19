import type { Env } from '../../config/env';
import type { InternalCalls } from '../../common/http/internal-calls';
import type { ContextualRequest, RequestContext } from '../../common/http/request-context';
import type { AccessService } from '../access/access.service';
import { ApprovalsService } from './approvals.service';

/** The inbox's counts: each kind's route counts what waits in all, though its list stops at a page. */
describe('ApprovalsService.inbox counts', () => {
  const ctx = {
    user: { id: '7', sub: 'zz-a', displayName: 'A', memberships: [], mfa: true, dev: true },
    tenant: { schoolId: '1', userId: '7' },
  } as unknown as RequestContext;
  const req = {} as ContextualRequest;
  const env = {
    ADMIN_APP_URL: 'http://admin.test',
    TEACHER_APP_URL: 'http://staff.test',
  } as Env;
  const access = {
    effectivePermissions: () => Promise.resolve(new Set<string>()),
  } as unknown as AccessService;
  const pass = (n: number, extra: Record<string, unknown> = {}) => ({
    id: String(n),
    number: `GP-${String(n)}`,
    createdAt: `2026-11-0${String(n)}T08:00:00Z`,
    ...extra,
  });
  // the gate pass inbox answers one page of passes and how many wait in all; every other list is empty
  const calls = {
    call: (_r: unknown, _m: string, url: string) =>
      Promise.resolve(
        url === '/gate-passes/inbox'
          ? { status: 200, body: { data: [pass(1), pass(2)], waiting: 250, decided: [] } }
          : url === '/transport/requests/inbox'
            ? // a route whose count is fewer than its rows (a race): never fewer than the items
              {
                status: 200,
                body: { data: [pass(3, { requestedAt: '2026-11-09T08:00:00Z' })], waiting: 0 },
              }
            : { status: 200, body: { data: [], rows: [] } },
      ),
  } as unknown as InternalCalls;
  const svc = new ApprovalsService(access, calls, env);

  it("counts a kind by its route's total, not by the items read", async () => {
    const box = await svc.inbox(ctx, req);
    expect(box.kinds).toEqual([
      { kind: 'gate_pass', label: 'Gate passes', count: 250 },
      { kind: 'transport', label: 'Transport requests', count: 1 },
    ]);
    expect(box.total).toBe(251);
    expect(box.items.filter((i) => i.kind === 'gate_pass')).toHaveLength(2);
    // the oldest first, with the page in each app
    expect(box.items[0]).toMatchObject({
      kind: 'gate_pass',
      id: '1',
      app: 'teacher',
      href: '/gate-passes',
      adminHref: '/engagement/gate-passes/1',
      staffUrl: 'http://staff.test/gate-passes',
      url: null,
    });
  });

  it('gives the counts alone when asked', async () => {
    const box = await svc.inbox(ctx, req, undefined, 'counts');
    expect(box.items).toEqual([]);
    expect(box.total).toBe(251);
  });
});
