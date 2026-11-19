import type { ApprovalSource, Decision, ListedItem } from './approval-source';
import { KIND_LABEL as GATE_PASS_KIND } from '../engagement/gatepass.service';
import { count, rows, str } from './approval-source';

/**
 * Every kind of approval the inbox gathers: the admin app's Approvals page (apps/admin/lib/approvals.ts, 26 kinds)
 * and the approvals the staff web app shows on their own screens (staff profile changes, exits, consent answers,
 * hostel visits). The list and decision routes are those the web apps call. A kind without `decide` (line-by-line
 * inspection, clearances, a form) is listed and opened on its own page.
 */

const outcome = (d: Decision) => (d === 'approve' ? 'approved' : 'rejected');
const action = (d: Decision) => (d === 'approve' ? 'approve' : 'reject');
const note = (reason: string | null) => (reason ? { note: reason } : {});
const name = (v: unknown): string | null =>
  v && typeof v === 'object' ? str((v as Record<string, unknown>).name) : str(v);
const join = (...parts: unknown[]) =>
  parts
    .map((p) => str(p))
    .filter(Boolean)
    .join(' · ') || null;
const dates = (from: unknown, to: unknown) =>
  from ? (to && to !== from ? `${String(from)} – ${String(to)}` : String(from)) : null;
const item = (x: ListedItem) => x;

// workflow steps whose kind has a source (or a page) of its own
const OWN = ['vacancy', 'staff_regularisation', 'employee_exit', 'consent_response'];
const PREFIX_OWN = ['purchase', 'staff_leave'];

export const APPROVAL_SOURCES: ApprovalSource[] = [
  {
    kind: 'workflow',
    label: 'Approval steps',
    permissions: ['workflow.inbox.act'],
    app: 'admin',
    list: { method: 'GET', url: '/workflow/inbox' },
    reasonOnReject: false,
    items: (a) =>
      rows(a)
        .filter((x) => {
          const t = String((x.instance as Record<string, unknown> | undefined)?.entityType ?? '');
          return !OWN.includes(t) && !PREFIX_OWN.some((p) => t.startsWith(p));
        })
        .map((x) => {
          const i = (x.instance ?? {}) as Record<string, unknown>;
          return item({
            id: String(x.id),
            title: str(i.subject) ?? str(i.definitionName) ?? 'Approval',
            detail: join(i.definitionName, x.name),
            by: name(i.requestedBy),
            at: str(i.requestedAt),
            amount: null,
            href: `/workflow/instances/${String(i.id)}`,
          });
        }),
    decide: (id, d, r) => ({
      method: 'POST',
      url: `/workflow/steps/${id}/${action(d)}`,
      body: note(r),
    }),
  },
  {
    kind: 'profile',
    label: 'Profile changes',
    permissions: ['engagement.change_request.approve'],
    app: 'admin',
    list: { method: 'GET', url: '/engagement/profile-approvals?box=mine&size=100' },
    total: (a) => count(a, 'page', 'total'),
    items: (a) =>
      rows(a).map((x) =>
        item({
          id: String(x.id),
          title: join(x.studentName, x.classSection) ?? 'Profile change',
          detail: Array.isArray(x.items)
            ? (x.items as Array<Record<string, unknown>>).map((f) => String(f.label)).join(', ')
            : null,
          by: name(x.requestedBy),
          at: str(x.requestedAt ?? x.createdAt),
          amount: null,
          href: '/people/profile-approvals',
        }),
      ),
    decide: (id, d, r) => ({
      method: 'POST',
      url: `/engagement/profile-approvals/${id}/decide`,
      body: { approve: d === 'approve', ...note(r) },
    }),
  },
  {
    kind: 'staff_profile',
    label: 'Staff profile changes',
    permissions: [],
    app: 'teacher',
    list: { method: 'GET', url: '/people/staff-profile-approvals?box=mine&size=100' },
    total: (a) => count(a, 'total'),
    items: (a) =>
      rows(a)
        .filter((x) => x.canAct !== false && x.status === 'pending')
        .map((x) => {
          const e = (x.employee ?? {}) as Record<string, unknown>;
          return item({
            id: String(x.id),
            title: join(e.name, e.code) ?? 'Staff profile change',
            detail: Array.isArray(x.fields)
              ? (x.fields as Array<Record<string, unknown>>).map((f) => String(f.label)).join(', ')
              : str(x.reason),
            by: str(e.name),
            at: str(x.createdAt),
            amount: null,
            href: '/profile/approvals',
            adminHref: '/people/staff-profile-approvals',
          });
        }),
    decide: (id, d, r) => ({
      method: 'POST',
      url: `/people/staff-profile-approvals/${id}/decide`,
      body: { approve: d === 'approve', ...note(r) },
    }),
  },
  {
    kind: 'purchase',
    label: 'Purchase indents',
    permissions: [],
    app: 'teacher',
    list: { method: 'GET', url: '/purchase/indents?view=waiting&status=submitted&size=100' },
    total: (a) => count(a, 'total'),
    items: (a) =>
      rows(a).map((x) =>
        item({
          id: String(x.id),
          title: join(x.number, x.department) ?? 'Purchase indent',
          detail: str(x.purpose),
          by: name(x.raisedBy),
          at: str(x.submittedAt ?? x.createdAt),
          amount: str(x.estimate),
          href: `/purchase/indents/${String(x.id)}`,
          adminHref: `/purchase/indents/${String(x.id)}`,
        }),
      ),
    decide: (id, d, r) => ({
      method: 'POST',
      url: `/purchase/indents/${id}/decide`,
      body: { action: action(d), ...note(r) },
    }),
  },
  {
    kind: 'order',
    label: 'Purchase orders',
    permissions: [],
    app: 'teacher',
    list: { method: 'GET', url: '/purchase/orders?view=waiting&status=submitted&size=100' },
    total: (a) => count(a, 'waitingForMe'),
    items: (a) =>
      rows(a).map((x) =>
        item({
          id: String(x.id),
          title: join(x.label ?? x.number, x.vendor) ?? 'Purchase order',
          detail: join(x.department, x.emergency ? 'Emergency purchase' : null),
          by: name(x.createdBy),
          at: str(x.submittedAt ?? x.createdAt),
          amount: str(x.total),
          href: `/purchase/orders/${String(x.id)}`,
          adminHref: `/purchase/orders/${String(x.id)}`,
        }),
      ),
    decide: (id, d, r) => ({
      method: 'POST',
      url: `/purchase/orders/${id}/decide`,
      body: { action: action(d), ...note(r) },
    }),
  },
  {
    kind: 'receipt',
    label: 'Goods received to inspect',
    permissions: [],
    app: 'teacher',
    list: { method: 'GET', url: '/purchase/receipts?mine=1' },
    total: (a) => count(a, 'total'),
    // quantities line by line: on its own page
    items: (a) =>
      rows(a, 'rows').map((x) =>
        item({
          id: String(x.id),
          title: join(x.number, x.vendor) ?? 'Goods received',
          detail: join(x.store, x.department),
          by: null,
          at: str(x.receivedOn),
          amount: null,
          href: `/purchase/receipts/${String(x.id)}`,
          adminHref: `/purchase/receipts/${String(x.id)}`,
        }),
      ),
  },
  {
    kind: 'issue_ack',
    label: 'Issues to acknowledge',
    permissions: [],
    app: 'teacher',
    list: { method: 'GET', url: '/purchase/issues?mine=1' },
    total: (a) => count(a, 'toAcknowledge'),
    approveAs: 'acknowledge',
    rejectAs: null,
    reasonOnReject: false,
    items: (a) =>
      rows(a, 'rows')
        .filter((x) => x.acknowledgedAt == null)
        .map((x) =>
          item({
            id: String(x.id),
            title: join(x.number, x.store) ?? 'Issue',
            detail: str(x.department),
            by: null,
            at: str(x.issuedOn),
            amount: str(x.value),
            href: `/purchase/issues/${String(x.id)}`,
            adminHref: `/purchase/issues/${String(x.id)}`,
          }),
        ),
    decide: (id, _d, r) => ({
      method: 'POST',
      url: `/purchase/issues/${id}/acknowledge`,
      body: { onPaper: false, ...note(r) },
    }),
  },
  {
    kind: 'count',
    label: 'Physical counts',
    permissions: [],
    app: 'admin',
    list: { method: 'GET', url: '/purchase/counts?mine=1' },
    total: (a) => count(a, 'waitingForMe'),
    rejectAs: 'send_back',
    items: (a) =>
      rows(a, 'rows').map((x) =>
        item({
          id: String(x.id),
          title: join(x.number, x.store) ?? 'Physical count',
          detail: x.differences == null ? null : `${String(x.differences)} differences`,
          by: null,
          at: str(x.submittedAt),
          amount: null,
          href: `/purchase/counts/${String(x.id)}`,
        }),
      ),
    decide: (id, d, r) => ({
      method: 'POST',
      url: `/purchase/counts/${id}/decide`,
      body: { action: d === 'approve' ? 'approve' : 'send_back', ...note(r) },
    }),
  },
  {
    kind: 'revaluation',
    label: 'Rate corrections',
    permissions: [],
    app: 'admin',
    list: { method: 'GET', url: '/purchase/revaluations?status=submitted' },
    total: (a) => count(a, 'waitingForMe'),
    reasonOnReject: false,
    items: (a) =>
      rows(a, 'rows')
        .filter((x) => (x.can as Record<string, unknown> | undefined)?.decide === true)
        .map((x) =>
          item({
            id: String(x.id),
            title: join(x.number, x.item) ?? 'Rate correction',
            detail: join(x.store, `${String(x.oldRate)} → ${String(x.newRate)}`, x.reason),
            by: name(x.by),
            at: str(x.at),
            amount: str(x.change),
            href: `/purchase/stores/${String(x.storeId)}?tab=rates`,
          }),
        ),
    decide: (id, d, r) => ({
      method: 'POST',
      url: `/purchase/revaluations/${id}/decide`,
      body: { action: action(d), ...note(r) },
    }),
  },
  {
    kind: 'condemnation',
    label: 'Condemnations',
    permissions: [],
    app: 'admin',
    list: { method: 'GET', url: '/purchase/condemnations?mine=1' },
    // a committee signs, then an approver decides: on its own page
    items: (a) =>
      rows(a, 'rows').map((x) =>
        item({
          id: String(x.id),
          title: join(x.number, x.title) ?? 'Condemnation',
          detail: str(x.status),
          by: name(x.by),
          at: str(x.createdAt),
          amount: str(x.value),
          href: `/purchase/condemnations/${String(x.id)}`,
        }),
      ),
  },
  {
    kind: 'vendor',
    label: 'Vendors to approve',
    permissions: [],
    app: 'admin',
    list: { method: 'GET', url: '/purchase/vendor-approvals?mine=1' },
    items: (a) =>
      (((a as Record<string, unknown> | null)?.canApprove ?? true) ? rows(a, 'rows') : []).map(
        (x) =>
          item({
            id: `${String(x.kind)}-${String(x.id)}`,
            title: str(x.title) ?? 'Vendor',
            detail: str(x.detail),
            by: null,
            at: str(x.since),
            amount: null,
            href: `/purchase/vendors/${String(x.vendorId)}`,
          }),
      ),
    decide: (id, d, r) => {
      const [kind, num] = id.split('-');
      return {
        method: 'POST',
        url:
          kind === 'change'
            ? `/purchase/vendor-changes/${num}/decide`
            : `/purchase/vendors/${num}/decide`,
        body: { approve: d === 'approve', ...note(r) },
      };
    },
  },
  {
    kind: 'asset_ack',
    label: 'Assets handed to you',
    permissions: [],
    app: 'teacher',
    list: { method: 'GET', url: '/purchase/assets-mine' },
    approveAs: 'acknowledge',
    rejectAs: null,
    reasonOnReject: false,
    items: (a) =>
      rows(a, 'pending').map((x) =>
        item({
          id: String(x.movementId),
          title: join(x.tag, x.item) ?? 'Asset',
          detail: join(x.from, x.note),
          by: null,
          at: str(x.movedOn),
          amount: null,
          href: `/purchase/my-assets`,
          adminHref: x.assetId == null ? null : `/purchase/assets/${String(x.assetId)}`,
        }),
      ),
    decide: (id, _d, r) => ({
      method: 'POST',
      url: `/purchase/asset-movements/${id}/acknowledge`,
      body: { onPaper: false, ...note(r) },
    }),
  },
  {
    kind: 'requisition',
    label: 'Purchase requisitions',
    permissions: [],
    app: 'teacher',
    list: { method: 'GET', url: '/purchase/requisitions?view=waiting&status=submitted&size=100' },
    total: (a) => count(a, 'waitingForMe'),
    items: (a) =>
      rows(a).map((x) =>
        item({
          id: String(x.id),
          title: join(x.number, x.department) ?? 'Purchase requisition',
          detail: str(x.purpose),
          by: name(x.createdBy),
          at: str(x.submittedAt ?? x.createdAt),
          amount: str(x.estimate),
          href: `/purchase/requisitions/${String(x.id)}`,
          adminHref: `/purchase/requisitions/${String(x.id)}`,
        }),
      ),
    decide: (id, d, r) => ({
      method: 'POST',
      url: `/purchase/requisitions/${id}/decide`,
      body: { action: action(d), ...note(r) },
    }),
  },
  {
    kind: 'cs_sign',
    label: 'Comparative statements to sign',
    permissions: [],
    app: 'teacher',
    list: { method: 'GET', url: '/purchase/requisitions?view=sign&size=100' },
    total: (a) => count(a, 'total'),
    approveAs: 'sign',
    rejectAs: null,
    reasonOnReject: false,
    items: (a) =>
      rows(a).map((x) =>
        item({
          id: String(x.id),
          title: join(x.number, x.department) ?? 'Comparative statement',
          detail: str(x.purpose),
          by: name(x.createdBy),
          at: str(x.submittedAt ?? x.createdAt),
          amount: str(x.estimate),
          href: `/purchase/requisitions/${String(x.id)}`,
          adminHref: `/purchase/requisitions/${String(x.id)}`,
        }),
      ),
    decide: (id, _d, r) => ({
      method: 'POST',
      url: `/purchase/requisitions/${id}/sign`,
      body: note(r),
    }),
  },
  {
    kind: 'fee_adjustment',
    label: 'Fee adjustments',
    // those who decide them (the list is open to them as to those who raise them); the ones riding approval
    // levels come as workflow steps
    permissions: ['fees.adjustment.approve'],
    app: 'admin',
    list: { method: 'GET', url: '/fees/adjustments?status=pending' },
    reasonOnReject: false,
    items: (a) =>
      rows(a)
        .filter((x) => x.workflowInstanceId == null)
        .map((x) =>
          item({
            id: String(x.id),
            title: join(x.studentName, x.kind) ?? 'Fee adjustment',
            detail: join(x.demandLabel ?? x.receiptNo, x.reason),
            by: name(x.requestedBy),
            at: str(x.requestedAt),
            amount: str(x.amount),
            href: '/fees/adjustments',
          }),
        ),
    // the route asks for a recent second factor (fees.adjustment.approve)
    decide: (id, d, r) => ({
      method: 'POST',
      url: `/fees/adjustments/${id}/decide`,
      body: { outcome: outcome(d), ...note(r) },
    }),
  },
  {
    kind: 'fee_request',
    label: 'Fee requests',
    permissions: ['fees.adjustment.approve'],
    app: 'admin',
    list: { method: 'GET', url: '/fees/requests?status=pending' },
    reasonOnReject: false,
    items: (a) =>
      rows(a)
        .filter((x) => x.workflowInstanceId == null)
        .map((x) =>
          item({
            id: String(x.id),
            title: join(name(x.student), x.kind) ?? 'Fee request',
            detail: join(x.receiptNo, x.reason),
            by: null,
            at: str(x.requestedAt),
            amount: str(x.amount),
            href: '/fees/requests?tab=list',
          }),
        ),
    decide: (id, d, r) => ({
      method: 'POST',
      url: `/fees/requests/${id}/decide`,
      body: { outcome: outcome(d), ...note(r) },
    }),
  },
  {
    kind: 'withdrawal',
    label: 'Withdrawal clearances',
    permissions: ['people.withdrawal.clear'],
    // the list and the withdrawal's page, where the clearance is recorded, are for those who see withdrawals
    needsAll: ['people.withdrawal.view'],
    app: 'admin',
    list: { method: 'GET', url: '/people/withdrawals?mine=true&size=100' },
    total: (a) => count(a, 'page', 'total'),
    // a department's clearance with its dues: on its own page
    items: (a) =>
      rows(a).map((x) =>
        item({
          id: String(x.id),
          title: join(x.studentName, x.section) ?? 'Withdrawal',
          detail: join(x.reason, x.leavingOn),
          by: null,
          at: str(x.initiatedOn),
          amount: null,
          href: `/people/withdrawals/${String(x.id)}`,
        }),
      ),
  },
  {
    kind: 'transfer',
    label: 'Students sent from other schools',
    permissions: ['people.transfer.manage'],
    app: 'admin',
    list: { method: 'GET', url: '/people/school-transfers?box=incoming' },
    // accepting places the student in a class: on its own page
    items: (a) =>
      rows(a)
        .filter((x) => x.status === 'requested')
        .map((x) => {
          const st = (x.student ?? {}) as Record<string, unknown>;
          return item({
            id: String(x.id),
            title: join(st.name, st.classSection) ?? 'School transfer',
            detail: name(x.fromSchool),
            by: null,
            at: str(x.requestedAt),
            amount: null,
            href: `/people/school-transfers?open=${String(x.id)}`,
          });
        }),
  },
  {
    kind: 'gate_pass',
    label: 'Gate passes',
    permissions: [],
    app: 'teacher',
    list: { method: 'GET', url: '/gate-passes/inbox' },
    total: (a) => count(a, 'waiting'),
    items: (a) =>
      rows(a).map((x) =>
        item({
          id: String(x.id),
          title: join(x.number, name(x.student) ?? name(x.employee)) ?? 'Gate pass',
          detail: join(
            GATE_PASS_KIND[String(x.kind)] ?? x.kind,
            x.section,
            x.onDate,
            x.atTime,
            x.reason,
          ),
          by: null,
          at: str(x.createdAt),
          amount: null,
          href: `/gate-passes`,
          adminHref: `/engagement/gate-passes/${String(x.id)}`,
        }),
      ),
    decide: (id, d, r) => ({
      method: 'POST',
      url: `/gate-passes/${id}/decide`,
      body: { outcome: outcome(d), ...note(r) },
    }),
  },
  {
    kind: 'vacancy',
    label: 'Vacancies to approve',
    permissions: [],
    app: 'admin',
    list: { method: 'GET', url: '/people/recruitment/to-approve' },
    rejectAs: 'send_back',
    items: (a) =>
      rows(a).map((x) =>
        item({
          id: String(x.id),
          title: join(x.code, x.title) ?? 'Vacancy',
          detail: join(x.department, x.posts == null ? null : `${String(x.posts)} post(s)`),
          by: name(x.raisedBy),
          at: str(x.since),
          amount: null,
          href: `/people/recruitment/${String(x.id)}`,
        }),
      ),
    decide: (id, d, r) => ({
      method: 'POST',
      url: `/people/recruitment/vacancies/${id}/${d === 'approve' ? 'approve' : 'send-back'}`,
      body: note(r),
    }),
  },
  {
    kind: 'acr',
    label: 'ACRs to assess',
    permissions: [],
    app: 'teacher',
    list: { method: 'GET', url: '/people/acr/to-assess' },
    // an assessment form: on its own page
    items: (a) =>
      rows(a, 'waiting').map((x) => {
        const e = (x.employee ?? {}) as Record<string, unknown>;
        return item({
          id: String(x.id),
          title: join(e.name, e.code) ?? 'ACR',
          detail: join(x.cycle, (x.level as Record<string, unknown> | undefined)?.label),
          by: null,
          at: str(x.updatedAt),
          amount: null,
          href: `/acr`,
          adminHref: `/me/acr/${String(x.id)}`,
        });
      }),
  },
  {
    kind: 'transport',
    label: 'Transport requests',
    permissions: [],
    app: 'admin',
    list: { method: 'GET', url: '/transport/requests/inbox' },
    total: (a) => count(a, 'waiting'),
    items: (a) =>
      rows(a).map((x) =>
        item({
          id: String(x.id),
          title: join(x.number, name(x.student)) ?? 'Transport request',
          detail: join(x.kindLabel, x.section, x.what),
          by: null,
          at: str(x.requestedAt),
          amount: null,
          href: `/transport/requests/${String(x.id)}`,
        }),
      ),
    decide: (id, d, r) => ({
      method: 'POST',
      url: `/transport/requests/${id}/decide`,
      body: { outcome: outcome(d), ...note(r) },
    }),
  },
  {
    kind: 'file',
    label: 'File movement',
    permissions: ['files.movement.raise'],
    app: 'admin',
    list: { method: 'GET', url: '/file-movement?box=inbox' },
    items: (a) =>
      rows(a).map((x) =>
        item({
          id: String(x.id),
          title: join(x.number, x.subject) ?? 'File',
          detail: null,
          by: name(x.createdBy),
          at: str(x.submittedAt),
          amount: null,
          href: `/workflow/files/${String(x.id)}`,
        }),
      ),
    decide: (id, d, r) => ({
      method: 'POST',
      url: `/file-movement/${id}/decide`,
      body: { outcome: outcome(d), ...(r ? { remark: r } : {}) },
    }),
  },
  {
    kind: 'lesson',
    label: 'Lessons',
    permissions: ['academics.lesson_plan.view'],
    app: 'teacher',
    list: { method: 'GET', url: '/academics/lessons?mine=approve&size=100' },
    total: (a) => count(a, 'page', 'total'),
    approveAs: 'acknowledge',
    items: (a) =>
      rows(a).map((x) =>
        item({
          id: String(x.id),
          title: str(x.topic) ?? 'Lesson',
          detail: null,
          by: name(x.employee),
          at: str(x.requestedAt),
          amount: null,
          href: `/lesson-plans`,
          adminHref: `/academics/lesson-plans/${String(x.id)}`,
        }),
      ),
    decide: (id, d, r) => ({
      method: 'POST',
      url: `/academics/lessons/${id}/decide`,
      body: { action: d === 'approve' ? 'acknowledge' : 'reject', ...(r ? { remark: r } : {}) },
    }),
  },
  {
    kind: 'leave',
    label: 'Student leave',
    permissions: [],
    app: 'teacher',
    list: { method: 'GET', url: '/attendance/leaves?tab=inbox' },
    total: (a) => count(a, 'inbox'),
    items: (a) =>
      rows(a).map((x) =>
        item({
          id: String(x.id),
          title: join(x.student, x.section) ?? 'Student leave',
          detail: join(x.leaveTypeLabel, dates(x.fromDate, x.toDate), x.reason),
          by: name(x.appliedBy),
          at: str(x.appliedAt),
          amount: null,
          href: `/leaves?tab=inbox&open=${String(x.id)}`,
          adminHref: `/attendance/leaves?tab=inbox&open=${String(x.id)}`,
        }),
      ),
    decide: (id, d, r) => ({
      method: 'POST',
      url: `/attendance/leaves/${id}/decide`,
      body: { outcome: outcome(d), ...note(r) },
    }),
  },
  {
    kind: 'staff_leave',
    label: 'Staff leave',
    permissions: [],
    app: 'teacher',
    list: { method: 'GET', url: '/leave/approvals?view=waiting&kind=leave&size=100' },
    total: (a) => count(a, 'total'),
    items: (a) =>
      rows(a, 'rows')
        .filter((x) => (x.what ?? 'leave') === 'leave')
        .map((x) => staffLeave(x)),
    decide: (id, d, r) => ({
      method: 'POST',
      url: `/leave/requests/${id}/decide`,
      body: { outcome: outcome(d), note: r ?? '' },
    }),
  },
  {
    kind: 'staff_leave_cancel',
    label: 'Staff leave cancellations',
    permissions: [],
    app: 'teacher',
    list: { method: 'GET', url: '/leave/approvals?view=waiting&kind=cancellation&size=100' },
    total: (a) => count(a, 'total'),
    items: (a) =>
      rows(a, 'rows')
        .filter((x) => x.what === 'cancellation')
        .map((x) => staffLeave(x)),
    decide: (id, d, r) => ({
      method: 'POST',
      url: `/leave/requests/${id}/cancel-decide`,
      body: { outcome: outcome(d), note: r ?? '' },
    }),
  },
  {
    kind: 'staff_regularisation',
    label: 'Attendance corrections',
    permissions: [],
    app: 'teacher',
    list: { method: 'GET', url: '/staff-attendance/regularisations/approvals?view=waiting' },
    total: (a) => count(a, 'total'),
    items: (a) =>
      rows(a, 'rows')
        .filter((x) => x.mayDecide !== false)
        .map((x) =>
          item({
            id: String(x.id),
            title: join(x.employee, x.code) ?? 'Attendance correction',
            detail: join(
              x.day,
              x.in_time || x.out_time
                ? `${String(x.in_time ?? '')}–${String(x.out_time ?? '')}`
                : null,
              x.day_type,
              x.reason,
            ),
            by: str(x.employee),
            at: str(x.since),
            amount: null,
            href: `/attendance-corrections`,
            adminHref:
              x.employee_id == null || x.day == null
                ? '/leave/attendance/approvals'
                : `/leave/attendance/day?emp=${String(x.employee_id)}&day=${String(x.day)}`,
          }),
        ),
    decide: (id, d, r) => ({
      method: 'POST',
      url: `/staff-attendance/regularisations/${id}/decide`,
      body: { outcome: outcome(d), note: r ?? '' },
    }),
  },
  {
    kind: 'admission',
    label: 'Registrations to decide',
    permissions: [],
    app: 'teacher',
    list: { method: 'GET', url: '/admissions/approvals?tab=waiting&size=100' },
    total: (a) => count(a, 'total'),
    reasonOnApprove: true,
    items: (a) =>
      rows(a).map((x) =>
        item({
          id: String(x.id),
          title: join(x.number, x.candidate) ?? 'Registration',
          detail: join(x.className, x.category, x.stage),
          by: null,
          at: str(x.since),
          amount: null,
          href: `/admission-approvals/${String(x.id)}`,
          adminHref: `/admissions/approvals/${String(x.id)}`,
        }),
      ),
    decide: (id, d, r) => ({
      method: 'POST',
      url: `/admissions/approvals/${id}/decide`,
      body: { decision: d, remarks: r ?? '' },
    }),
  },
  {
    kind: 'exit',
    label: 'Resignations and exits',
    permissions: [],
    app: 'teacher',
    list: { method: 'GET', url: '/people/exits/to-approve' },
    items: (a) =>
      rows(a).map((x) => {
        const e = (x.employee ?? {}) as Record<string, unknown>;
        return item({
          id: String(x.id),
          title: join(e.name, e.code) ?? 'Exit',
          detail: join(
            (x.exitType as Record<string, unknown> | undefined)?.name,
            x.acceptedLastDay ?? x.proposedLastDay,
            x.reason,
          ),
          by: str(e.name),
          at: str(x.requestedOn),
          amount: null,
          href: `/exit-approvals`,
        });
      }),
    decide: (id, d, r) => ({
      method: 'POST',
      url: `/people/exits/${id}/${d === 'approve' ? 'approve' : 'reject'}`,
      body: note(r),
    }),
  },
  {
    kind: 'no_dues',
    label: 'No-dues clearances',
    permissions: [],
    app: 'teacher',
    list: { method: 'GET', url: '/people/exits/clearance/mine' },
    // a department's dues: on its own page
    items: (a) =>
      rows(a).map((x) => {
        const e = (x.employee ?? {}) as Record<string, unknown>;
        return item({
          id: String(x.id),
          title: join(e.name, e.code) ?? 'No dues',
          detail: join(e.department, x.exitType, x.lastDay),
          by: null,
          at: str(x.lastDay),
          amount: null,
          href: `/no-dues`,
        });
      }),
  },
  {
    kind: 'consent',
    label: 'Consent answers',
    permissions: [],
    app: 'teacher',
    list: { method: 'GET', url: '/engagement/mine/consent-approvals' },
    items: (a) =>
      rows(a).map((x) =>
        item({
          id: String(x.stepId),
          title: join(x.form, x.about) ?? 'Consent answer',
          detail: join(x.number, x.section, x.level),
          by: name(x.byUser),
          at: str(x.signedAt),
          amount: null,
          href: `/consent-approvals`,
        }),
      ),
    decide: (id, d, r) => ({
      method: 'POST',
      url: `/engagement/mine/consent-approvals/${id}`,
      body: { decision: outcome(d), ...note(r) },
    }),
  },
  {
    kind: 'hostel_visit',
    label: 'Hostel visits',
    permissions: ['hostel.visit.decide'],
    // the list is the hostel visitors' book
    needsAll: ['hostel.visit.view'],
    app: 'teacher',
    list: { method: 'GET', url: '/hostel/visits?show=waiting' },
    total: (a) => count(a, 'total'),
    items: (a) =>
      rows(a, 'rows').map((x) =>
        item({
          id: String(x.id),
          title: join(x.pupil, x.hostel) ?? 'Hostel visit',
          detail: join(x.visitorName, x.purpose),
          by: null,
          at: str(x.createdAt),
          amount: null,
          href: `/hostel`,
        }),
      ),
    decide: (id, d, r) => ({
      method: 'POST',
      url: `/hostel/visits/${id}/decide`,
      body: { outcome: d === 'approve' ? 'allowed' : 'refused', ...note(r) },
    }),
  },
];

function staffLeave(x: Record<string, unknown>) {
  const e = (x.employee ?? {}) as Record<string, unknown>;
  const t = (x.leaveType ?? {}) as Record<string, unknown>;
  return item({
    id: String(x.id),
    title: join(e.name, t.name) ?? 'Leave',
    detail: join(dates(x.from, x.to), x.days == null ? null : `${String(x.days)} day(s)`, x.reason),
    by: str(e.name),
    at: str(x.since ?? x.appliedAt),
    amount: null,
    href: `/my-leave/${String(x.id)}`,
    adminHref: `/leave/requests/${String(x.id)}`,
  });
}
