import { apiFetch } from './api';

/**
 * What waits for the signed-in user's decision, for the header count and My approvals. Both read the server's
 * approvals inbox (GET /approvals/inbox, docs/design/89 §5.4), which gathers every kind from its own list route as
 * the person — the same answer the mobile app shows. Queries and tickets are not approvals: they live only under
 * the header Queries icon.
 */
export interface ApprovalGroup {
  kind: string;
  title: string;
  help: string | null;
  /** the page listing all of them (null: there is none for everyone; each item opens its own page) */
  href: string | null;
  /** how many wait in all */
  count: number;
  items: Array<{
    id: string;
    title: string;
    detail: string | null;
    /** the item's page: in this app, or a full address in the staff app */
    href: string | null;
    /** the page is in the staff app */
    external: boolean;
    since: string | null;
  }>;
}

export interface MyApprovals {
  total: number;
  groups: ApprovalGroup[];
  /** kinds whose list could not be read just now */
  unavailable: string[];
}

interface InboxItem {
  kind: string;
  id: string;
  title: string;
  detail: string | null;
  at: string | null;
  adminHref: string | null;
  staffUrl: string | null;
}
interface Inbox {
  total: number;
  kinds: Array<{ kind: string; label: string; count: number }>;
  items: InboxItem[];
  unavailable: Array<{ kind: string; label: string }>;
}

/** How each kind shows here: its title, a line of help and the admin page that lists them all. */
const KINDS: Record<
  string,
  { title?: string; help: string; href?: string | ((has: Set<string>) => string | null) }
> = {
  workflow: {
    help: 'Fee requests, admissions, messages and other requests at your step',
    href: '/workflow/inbox',
  },
  profile: {
    help: 'Changes parents and students asked for, waiting for your decision',
    href: '/people/profile-approvals',
  },
  staff_profile: {
    help: 'Changes staff asked for in their own records',
    href: '/people/staff-profile-approvals',
  },
  purchase: {
    title: 'Purchase Indents',
    help: 'Indents of your department waiting for your approval',
    href: '/purchase/indents?view=waiting',
  },
  order: {
    title: 'Purchase Orders',
    help: 'Orders waiting for your approval, and emergency purchases to ratify',
    href: '/purchase/orders?tab=waiting',
  },
  receipt: {
    help: 'Goods and services received against orders, waiting for your inspection or signature',
    href: '/purchase/receipts?tab=waiting',
  },
  issue_ack: {
    help: 'What the store issued to your department: confirm you received it',
    href: '/purchase/issues?tab=mine',
  },
  count: {
    title: 'Physical counts to approve',
    help: 'Store counts waiting at your level: their differences post at the last one',
    href: '/purchase/counts',
  },
  revaluation: {
    title: 'Rate corrections to approve',
    help: 'Stock at a wrong rate: what is left goes to the right rate when approved',
    href: '/purchase/stores',
  },
  condemnation: {
    help: 'Proposals to write off assets and stock: your signature (the committee) or approval',
    href: '/purchase/condemnations?tab=mine',
  },
  vendor: {
    help: 'New vendors and changes of a vendor’s bank account, GSTIN or PAN',
    href: '/purchase/vendor-approvals',
  },
  // each asset opens on its own page, where it is acknowledged
  asset_ack: { help: 'Confirm you have them: they are then in your care' },
  requisition: {
    title: 'Purchase Requisitions',
    help: 'Requisitions waiting for your approval',
    href: '/purchase/requisitions?view=waiting',
  },
  cs_sign: {
    help: 'As the purchase committee: the quotes and the vendors chosen',
    href: '/purchase/requisitions?view=sign',
  },
  fee_adjustment: {
    help: 'Receipt cancellations, cheque bounces and waivers decided on their own page',
    href: '/fees/adjustments',
  },
  fee_request: {
    help: 'Date corrections and other fee requests decided on their own page',
    href: '/fees/requests?tab=list',
  },
  withdrawal: {
    help: 'Leaving students waiting for your department to clear them',
    href: '/people/withdrawals?status=mine',
  },
  transfer: {
    help: 'Transfers from schools of the group, waiting to be admitted here',
    href: '/people/school-transfers',
  },
  gate_pass: {
    help: 'Pupil and staff gate passes waiting for your approval',
    href: '/engagement/gate-passes/approvals',
  },
  // the list of vacancies is for those who see recruitment; an approver at a level opens each one
  vacancy: {
    help: 'Posts raised for recruitment, waiting at your approval level',
    href: (has) =>
      has.has('people.recruitment.view') ? '/people/recruitment?status=pending' : null,
  },
  acr: {
    help: 'Annual confidential reports at your level, waiting for your rating or review',
    href: '/me/acr',
  },
  transport: {
    help: 'New transport, changes and withdrawals waiting for your approval',
    href: '/transport/requests/approvals',
  },
  file: { help: 'Files raised for approval that are with you now', href: '/workflow/files' },
  lesson: {
    help: 'Lessons uploaded by teachers that wait for you',
    href: '/academics/lesson-plans?tab=report&mine=approve',
  },
  leave: {
    help: 'Leave the families applied for, waiting for your approval',
    href: '/attendance/leaves',
  },
  query: {
    help: 'Queries from families and staff that are with you, until you close them',
    href: '/engagement/helpdesk',
  },
  staff_leave: { help: 'Leave of staff waiting at your level', href: '/leave/approvals' },
  staff_leave_cancel: {
    help: 'Cancellations of approved leave waiting at your level',
    href: '/leave/approvals',
  },
  staff_regularisation: {
    help: 'Days staff say are wrong (a forgotten punch, a device that missed them), at your level',
    href: '/leave/attendance/approvals',
  },
  admission: {
    help: 'Admission registrations waiting at your level',
    href: '/admissions/approvals',
  },
  exit: { help: 'Resignations and exits of staff waiting at your level (in the staff app)' },
  no_dues: { help: 'Exits waiting for your department’s no-dues clearance (in the staff app)' },
  consent: { help: 'Consent form answers waiting at your level (in the staff app)' },
  hostel_visit: { help: 'Visits to hostel pupils waiting for your decision (in the staff app)' },
};

/** The header count: everything waiting, every kind (best effort: 0 when the inbox cannot be read). */
export async function approvalsWaiting(): Promise<number> {
  return apiFetch<Pick<Inbox, 'total'>>('/approvals/inbox?view=counts')
    .then((r) => r.total)
    .catch(() => 0);
}

/**
 * Everything waiting, grouped by kind with a few of each (`perGroup`); a kind without a list page shows all of
 * its items, as each opens on its own page. With `items: false` only the groups and their counts are read (the
 * dashboard), and a kind without a list page here has no link.
 */
export async function myApprovals(
  permissions: string[],
  { items: withItems = true, perGroup = 10 }: { items?: boolean; perGroup?: number } = {},
): Promise<MyApprovals> {
  const has = new Set(permissions);
  const box = await apiFetch<Inbox>(`/approvals/inbox${withItems ? '' : '?view=counts'}`);
  const groups = box.kinds.map((k): ApprovalGroup => {
    const how = KINDS[k.kind];
    const items = box.items
      .filter((i) => i.kind === k.kind)
      .map((i) => ({
        id: i.id,
        title: i.title,
        detail: i.detail,
        href: i.adminHref ?? i.staffUrl,
        external: i.adminHref === null && i.staffUrl !== null,
        since: i.at,
      }));
    const own = typeof how?.href === 'function' ? how.href(has) : (how?.href ?? null);
    // a kind without a page of its own here: its items' page, when they all open the same one (a staff app list)
    const links = [...new Set(items.map((i) => i.href))];
    const href = own ?? (links.length === 1 ? links[0]! : null);
    return {
      kind: k.kind,
      title: how?.title ?? k.label,
      help: how?.help ?? null,
      href,
      count: k.count,
      items: href ? items.slice(0, perGroup) : items,
    };
  });
  return { total: box.total, groups, unavailable: box.unavailable.map((u) => u.label) };
}
