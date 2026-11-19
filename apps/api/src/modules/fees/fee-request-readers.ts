import { DomainError } from '../../common/errors/domain-error';
import type { RequestContext } from '../../common/http/request-context';
import { FEES } from './fees.dto';

/**
 * Reading the fee requests (waivers, receipt cancellations, cheque bounces, date corrections and the rest): those who
 * raise them and those who decide them, so an approver who raises none (a principal) sees what waits for them. The
 * routes are signed-in only with this check (any of the two rights).
 */
export function mustReadFeeRequests(ctx: RequestContext): void {
  const has = ctx.permissions;
  if (has?.has(FEES.adjustmentRequest) || has?.has(FEES.adjustmentApprove)) return;
  throw new DomainError('permission-denied', `Missing permission ${FEES.adjustmentRequest}`, {
    status: 403,
    extra: { permission: FEES.adjustmentRequest },
  });
}
