import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { DATED, withdrawDated } from './payroll-dated';
import { bad, has } from './payroll-month';
import { PayrollRunService } from './payroll-run.service';
import { PAYROLL } from './payroll.dto';

const WHAT: Record<string, string> = {
  rates: 'A rate',
  pf: 'A PF row',
  esi: 'An ESI row',
  pt: 'A profession-tax slab',
  lwf: 'An LWF row',
  ot: 'An overtime rate',
  versions: 'A pay-head version',
  structures: 'A salary amount',
};
const words = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/**
 * Withdrawing a dated set-up row approved by mistake (docs/design/86, "Withdraw and correct"): a checker or the
 * payroll admin, with a reason, while no approved, locked or paid run has read it. It stays in the history as
 * WITHDRAWN, the rows it ended open again, and a run only processed that read it goes back to draft. Once an approved
 * run has read it, it is corrected by a new row from the first month after (the screens offer that).
 */
@Injectable()
export class PayrollCorrectionsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly runs: PayrollRunService,
  ) {}

  async withdraw(ctx: RequestContext, kind: string, id: string, reason: string) {
    if (!has(ctx, PAYROLL.approve) && !has(ctx, PAYROLL.admin))
      bad('A payroll checker or the payroll admin withdraws an approved row', 403);
    const t = DATED[kind];
    if (!t) bad('Not a kind of dated set-up', 400);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await withdrawDated(c, t!, id, reason);
      const why = `${WHAT[kind] ?? 'A set-up row'} it read was withdrawn: ${reason.trim()}`;
      const reset: string[] = [];
      for (const run of r.open)
        if (await this.runs.resetForSetup(c, run.id, why)) reset.push(run.month);
      await this.audit.stage(ctx, c, {
        action: `payroll.${kind}.withdraw`,
        entityType: t!.table,
        entityId: id,
        after: { reason: reason.trim(), reopened: r.reopened, runsBackToDraft: reset },
      });
      return {
        withdrawn: true,
        reopened: r.reopened,
        runsBackToDraft: reset,
        message: `Withdrawn: no run reads it.${r.reopened ? ' The row before it is in force again.' : ''}${
          reset.length
            ? ` The run(s) of ${reset.map(words).join(', ')} went back to draft: process them again.`
            : ''
        }`,
      };
    });
  }
}
