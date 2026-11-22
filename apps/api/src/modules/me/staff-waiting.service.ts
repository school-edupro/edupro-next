import { Injectable } from '@nestjs/common';
import type { StaffWaiting } from '@edupro/menus';
import type { ContextualRequest } from '../../common/http/request-context';
import { InternalCalls } from '../../common/http/internal-calls';

type Body = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);

/**
 * What waits on a staff member (docs/design/94 phase A): the counts the staff menu needs to show a screen with work
 * waiting (leave to approve, the team, admissions, purchase …), read in one place for the staff website and the app.
 * Each count is the route the screen itself reads, called in-process as the person (their rights, their school), and
 * best effort: a route the person may not call counts nothing.
 */
@Injectable()
export class StaffWaitingService {
  constructor(private readonly calls: InternalCalls) {}

  async count(req: ContextualRequest): Promise<{ unread: number; waiting: StaffWaiting }> {
    const get = async (url: string): Promise<Body | null> => {
      try {
        const r = await this.calls.call(req, 'GET', url);
        return r.status >= 200 && r.status < 300 && r.body && typeof r.body === 'object'
          ? (r.body as Body)
          : null;
      } catch {
        return null;
      }
    };
    const [
      unread,
      consents,
      profiles,
      exits,
      noDues,
      admissions,
      indents,
      requisitions,
      orders,
      receipts,
      issues,
      assets,
      leave,
    ] = await Promise.all([
      get('/comms/inbox/unread'),
      get('/engagement/mine/consent-approvals'),
      get('/people/staff-profile-approvals'),
      get('/people/exits/to-approve'),
      get('/people/exits/clearance/mine'),
      get('/admissions/approvals?size=1'),
      get('/purchase/indents?view=waiting&status=submitted&size=1'),
      get('/purchase/requisitions?view=waiting&status=submitted&size=1'),
      get('/purchase/orders?view=waiting&status=submitted&size=1'),
      get('/purchase/receipts-waiting'),
      get('/purchase/issues?mine=1&page=1'),
      get('/purchase/assets-mine'),
      get('/leave/menu'),
    ]);
    return {
      unread: num(unread?.unread),
      waiting: {
        approvals: len(consents?.data),
        profileChanges: num(profiles?.awaitingMe),
        exits: len(exits?.data),
        noDues: len(noDues?.data),
        admissions: num(admissions?.waiting) + num(admissions?.decided),
        purchase: num(indents?.total),
        requisitions: num(requisitions?.waitingForMe) + num(requisitions?.toSign),
        orders: num(orders?.waitingForMe),
        receipts: num(receipts?.waiting),
        issues: num(issues?.toAcknowledge),
        assets: len(assets?.rows) + len(assets?.pending),
        staffLeave: num(leave?.leave),
        staffRegularisations: num(leave?.corrections),
        team: num(leave?.team),
        leaveReports: num(leave?.reports),
      },
    };
  }
}
