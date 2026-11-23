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
  /** the page in the admin app (null: the admin app has none for it; the staff app's page is `staffUrl`) */
  adminHref: string | null;
  /** a staff app page as a full address (the admin app links there when it has no page of its own) */
  staffUrl: string | null;
}

export type Decision = 'approve' | 'reject';

/**
 * docs/design/100: an item's own record as the app's Details screen shows it (no web page): its facts, longer
 * notes, its lists as tables (an indent's items, a leave's days, the approval levels), its files.
 */
export interface ApprovalDetail {
  title: string;
  subtitle: string | null;
  status: string | null;
  facts: Array<{ label: string; value: string }>;
  notes: Array<{ label: string; text: string }>;
  tables: Array<{ title: string; columns: string[]; rows: string[][] }>;
  /** files the record names; the app asks `GET /approvals/:kind/:id/files/:fileId` for one (checked again) */
  files: Array<{ label: string; fileId: string }>;
}

/** How a kind's record is read for the Details screen. */
export interface DetailConfig {
  /** the record's own route (called as the person); none: the item's row of the list */
  get?: (id: string) => RouteCall;
  /** fields left out (beyond ids, rights and empty ones) */
  hide?: string[];
  /** a field's words where its name does not say it */
  labels?: Record<string, string>;
}

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
  /** the person needs one of these to decide (empty: the routes themselves decide who sees what) */
  permissions: string[];
  /** and every one of these: the list route's own right, when it is another one (no list read only to be refused) */
  needsAll?: string[];
  list: RouteCall;
  items(answer: unknown): ListedItem[];
  /**
   * How many wait for the person in all, from the list answer, when the route counts them (its list may stop at a
   * page); without it, or when it gives null, the count is the items read.
   */
  total?: (answer: unknown) => number | null;
  /** the web app of the item pages */
  app: 'admin' | 'teacher';
  reasonOnReject?: boolean;
  reasonOnApprove?: boolean;
  approveAs?: 'approve' | 'acknowledge' | 'sign';
  rejectAs?: 'reject' | 'send_back' | null;
  /** the route that takes the decision; none: decided on its own page only */
  decide?: (id: string, decision: Decision, reason: string | null) => RouteCall;
  /** docs/design/100: the item's record for the app's Details screen */
  detail?: DetailConfig;
}

/**
 * What a source reads from its list: the item without the kind's fixed facts. `adminHref` is needed only for a staff
 * app kind whose item has a page in the admin app too (an admin kind's page is `href`).
 */
export type ListedItem = Pick<
  ApprovalItem,
  'id' | 'title' | 'detail' | 'by' | 'at' | 'amount' | 'href'
> & { adminHref?: string | null };

/** Small readers for the list answers. */
export const rows = (answer: unknown, key = 'data'): Array<Record<string, unknown>> => {
  if (Array.isArray(answer)) return answer as Array<Record<string, unknown>>;
  const v = (answer as Record<string, unknown> | null)?.[key];
  return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
};
export const str = (v: unknown): string | null =>
  v === null || v === undefined || v === '' ? null : String(v);
/** A count in the list answer (`total`, `page.total`, `waitingForMe` …): a number, or null when it is not there. */
export const count = (answer: unknown, ...path: string[]): number | null => {
  let v: unknown = answer;
  for (const k of path) v = (v as Record<string, unknown> | null | undefined)?.[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};
