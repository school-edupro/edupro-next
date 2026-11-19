/** One thing waiting for this person's decision, the same shape for every kind (docs/design/89 §5.4). */
export interface ApprovalItem {
  kind: string;
  id: string;
  /** what it is ("Casual leave, 3 days", "Purchase indent PI-12") */
  title: string;
  /** one more line: dates, the class, the reason in short */
  detail: string | null;
  /** who asked */
  by: string | null;
  /** when it was asked (ISO) */
  at: string | null;
  /** an amount, when it has one (money as a string, as the API sends money) */
  amount: string | null;
  /** the web page with everything about it */
  href: string;
  /** the web app that page is in */
  app: 'admin' | 'teacher';
  /** a reason must be given to reject (or send back) */
  reasonOnReject: boolean;
  /** a reason must be given to approve too (registrations: the remarks) */
  reasonOnApprove: boolean;
  /** the yes/no can be given in the inbox; otherwise it is decided on its own page (line-by-line, a form …) */
  decideHere: boolean;
  /** what "yes" is called for this kind */
  approveAs: 'approve' | 'acknowledge' | 'sign';
  /** what "no" is called (null: there is none here — acknowledge or sign only) */
  rejectAs: 'reject' | 'send_back' | null;
  /** the page as a full address (an admin page, opened in the browser); a staff page opens inside the app */
  url: string | null;
}

export type Decision = 'approve' | 'reject';

/** A call to one of the API's own routes. */
export interface RouteCall {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  url: string;
  body?: unknown;
}

/**
 * One kind of approval: the route that lists what waits for the person, how its answer reads as items, and the route
 * that takes a decision. Both routes are the ones the web apps already use, called in-process as the person, so their
 * permissions, scope, segregation of duties, second-factor rules and audit stay where they are.
 */
export interface ApprovalSource {
  kind: string;
  label: string;
  /** the person needs one of these for the list (empty: the route itself decides who sees what) */
  permissions: string[];
  list: RouteCall;
  items(answer: unknown): ListedItem[];
  /** the web app of the item pages */
  app: 'admin' | 'teacher';
  reasonOnReject?: boolean;
  reasonOnApprove?: boolean;
  approveAs?: 'approve' | 'acknowledge' | 'sign';
  rejectAs?: 'reject' | 'send_back' | null;
  /** the route that takes the decision; none: decided on its own page only */
  decide?: (id: string, decision: Decision, reason: string | null) => RouteCall;
}

/** What a source reads from its list: the item without the kind's fixed facts. */
export type ListedItem = Pick<
  ApprovalItem,
  'id' | 'title' | 'detail' | 'by' | 'at' | 'amount' | 'href'
>;

/** Small readers for the list answers. */
export const rows = (answer: unknown, key = 'data'): Array<Record<string, unknown>> => {
  if (Array.isArray(answer)) return answer as Array<Record<string, unknown>>;
  const v = (answer as Record<string, unknown> | null)?.[key];
  return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
};
export const str = (v: unknown): string | null =>
  v === null || v === undefined || v === '' ? null : String(v);
