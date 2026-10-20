import { apiFetch } from './api';
import type { SchoolTransfer } from './types';

/**
 * One kind of approval waiting for the signed-in user, for the header count and My approvals. Queries
 * and tickets are not approvals: they live only under the header Queries icon.
 */
export interface ApprovalGroup {
  key:
    | 'profile'
    | 'workflow'
    | 'withdrawal'
    | 'transfer'
    | 'gate_pass'
    | 'lesson'
    | 'transport'
    | 'leave'
    | 'fee'
    | 'file'
    | 'acr'
    | 'vacancy';
  title: string;
  help: string;
  href: string;
  count: number;
  items: Array<{ id: string; title: string; detail: string; href: string; since: string | null }>;
}

interface ProfileInbox {
  data: Array<{
    id: string;
    studentName: string;
    classSection: string | null;
    items: Array<{ label: string }>;
    createdAt: string;
  }>;
  page: { total: number };
}
interface WorkflowItem {
  id: string;
  name: string;
  overdue?: boolean;
  instance: {
    definitionName: string;
    subject: string | null;
    createdAt?: string;
    entityType?: string;
  };
}

/**
 * Everything waiting for this user to act on, grouped. Each source is asked only when the user holds
 * its permission, and a source that fails never hides the others (the count is best effort).
 */
export async function myApprovals(
  permissions: string[],
  withItems = false,
): Promise<ApprovalGroup[]> {
  const has = new Set(permissions);
  const size = withItems ? 10 : 1;
  const groups = await Promise.all([
    has.has('engagement.change_request.approve')
      ? apiFetch<ProfileInbox>(`/engagement/profile-approvals?box=mine&size=${size}`)
          .then((r): ApprovalGroup => ({
            key: 'profile',
            title: 'Profile changes',
            help: 'Changes parents and students asked for, waiting for your decision',
            href: '/people/profile-approvals',
            count: r.page.total,
            items: r.data.map((x) => ({
              id: x.id,
              title: `${x.studentName}${x.classSection ? ` · ${x.classSection}` : ''}`,
              detail: x.items.map((i) => i.label).join(', '),
              href: '/people/profile-approvals',
              since: x.createdAt,
            })),
          }))
          .catch(() => null)
      : null,
    has.has('workflow.inbox.act')
      ? apiFetch<{ data: WorkflowItem[] }>('/workflow/inbox')
          // vacancies have their own group below
          .then((r) => r.data.filter((x) => x.instance.entityType !== 'vacancy'))
          .then((data): ApprovalGroup => ({
            key: 'workflow',
            title: 'Approval steps',
            help: 'Leave, admissions, lesson plans, messages and other requests at your step',
            href: '/workflow/inbox',
            count: data.length,
            items: data.slice(0, size).map((x) => ({
              id: x.id,
              title: x.instance.subject ?? x.instance.definitionName,
              detail: `${x.instance.definitionName} · ${x.name}${x.overdue ? ' · overdue' : ''}`,
              href: '/workflow/inbox',
              since: x.instance.createdAt ?? null,
            })),
          }))
          .catch(() => null)
      : null,
    // fee requests one approver decides on their own pages: receipt cancel, cheque bounce, date
    // corrections (the ones that ride the approval levels come through "Approval steps")
    has.has('fees.adjustment.approve')
      ? Promise.all([
          apiFetch<{
            data: Array<{
              id: string;
              kind: string;
              studentName: string;
              receiptNo: string | null;
              amount: string;
              reason: string;
              requestedAt: string;
              workflowInstanceId: string | null;
            }>;
          }>('/fees/adjustments?status=pending')
            .then((r) => r.data.filter((x) => !x.workflowInstanceId))
            .catch(() => []),
          apiFetch<{
            data: Array<{
              id: string;
              kind: string;
              student: string;
              receiptNo: string | null;
              reason: string;
              requestedAt: string;
              workflowInstanceId: string | null;
            }>;
          }>('/fees/requests?status=pending')
            .then((r) => r.data.filter((x) => !x.workflowInstanceId))
            .catch(() => []),
        ]).then(([adj, req]): ApprovalGroup | null => {
          const KIND: Record<string, string> = {
            reversal: 'Cancel receipt',
            bounce: 'Cheque bounced',
            waiver: 'Fee waiver',
            late_fee: 'Late-fee waiver',
            transfer: 'Move receipt',
            date_change: 'Date correction',
            late_fee_to_fee: 'Paid late fee to fee',
            bounce_to_fee: 'Paid bounce charge to fee',
          };
          const items = [
            ...adj.map((x) => ({
              id: `a${x.id}`,
              title: `${KIND[x.kind] ?? x.kind}: ${x.receiptNo ?? ''} · ${x.studentName}`,
              detail: `₹${x.amount} · ${x.reason}`,
              href: '/fees/adjustments',
              since: x.requestedAt,
            })),
            ...req.map((x) => ({
              id: `r${x.id}`,
              title: `${KIND[x.kind] ?? x.kind}: ${x.receiptNo ?? ''} · ${x.student}`,
              detail: x.reason,
              href: '/fees/requests?tab=list',
              since: x.requestedAt,
            })),
          ];
          return items.length
            ? {
                key: 'fee',
                title: 'Fee requests',
                help: 'Receipt cancellations, cheque bounces and date corrections waiting for your decision',
                href: adj.length ? '/fees/adjustments' : '/fees/requests?tab=list',
                count: items.length,
                items: items.slice(0, size),
              }
            : null;
        })
      : null,
    has.has('people.withdrawal.clear')
      ? apiFetch<{
          data: Array<{
            id: string;
            studentName: string;
            section: string | null;
            leavingOn: string;
            initiatedOn: string;
            currentStep: number | null;
            clearances: Array<{
              departmentName: string;
              step: number;
              status: string;
              canAct?: boolean;
            }>;
          }>;
          page: { total: number };
        }>(`/people/withdrawals?mine=true&size=${size}`)
          .then((r): ApprovalGroup => ({
            key: 'withdrawal',
            title: 'Withdrawal clearances',
            help: 'Leaving students waiting for your department to clear them',
            href: '/people/withdrawals?status=mine',
            count: r.page.total,
            items: r.data.map((w) => ({
              id: w.id,
              title: `${w.studentName}${w.section ? ` · ${w.section}` : ''}`,
              detail: `${w.clearances
                .filter((x) => x.canAct && x.step === w.currentStep && x.status !== 'cleared')
                .map((x) => x.departmentName)
                .join(', ')} · leaving ${w.leavingOn}`,
              href: `/people/withdrawals/${w.id}`,
              since: w.initiatedOn,
            })),
          }))
          .catch(() => null)
      : null,
    has.has('people.transfer.manage')
      ? apiFetch<{ data: SchoolTransfer[] }>('/people/school-transfers?box=incoming')
          .then((r): ApprovalGroup | null => {
            const waiting = r.data.filter((t) => t.status === 'requested');
            return waiting.length
              ? {
                  key: 'transfer',
                  title: 'Students sent from other schools',
                  help: 'Transfers from schools of the group, waiting to be admitted here',
                  href: '/people/school-transfers',
                  count: waiting.length,
                  items: waiting.slice(0, size).map((t) => ({
                    id: t.id,
                    title: `${t.student.name}${t.student.classSection ? ` · ${t.student.classSection}` : ''}`,
                    detail: `from ${t.fromSchool}`,
                    href: `/people/school-transfers?open=${t.id}`,
                    since: t.requestedAt,
                  })),
                }
              : null;
          })
          .catch(() => null)
      : null,
    // gate passes wait on a person by name (class teacher, coordinator, principal...), not on a
    // permission: everyone is asked, and the group shows only when something waits
    apiFetch<{
      data: Array<{
        id: string;
        number: string;
        kind: string;
        audience: string;
        student: string | null;
        section: string | null;
        employee: string | null;
        onDate: string;
        atTime: string | null;
        reason: string;
        createdAt: string;
      }>;
    }>('/gate-passes/inbox')
      .then((r): ApprovalGroup | null =>
        r.data.length
          ? {
              key: 'gate_pass',
              title: 'Gate passes',
              help: 'Pupil and staff gate passes waiting for your approval',
              href: '/engagement/gate-passes/approvals',
              count: r.data.length,
              items: r.data.slice(0, size).map((p) => ({
                id: p.id,
                title:
                  p.audience === 'student'
                    ? `${p.student ?? 'Student'}${p.section ? ` · ${p.section}` : ''}`
                    : (p.employee ?? 'Employee'),
                detail: `${p.kind.replace('_', ' ')} · ${p.onDate}${p.atTime ? `, ${p.atTime}` : ''} · ${p.reason}`,
                href: `/engagement/gate-passes/${p.id}`,
                since: p.createdAt,
              })),
            }
          : null,
      )
      .catch(() => null),
    // vacancies at my approval level (docs/design/34-recruitment.md): anybody may sit at a level, so this
    // is asked for everyone and is empty for those who do not
    apiFetch<{
      data: Array<{
        id: string;
        code: string;
        title: string;
        department: string | null;
        posts: number;
        level: string;
        raisedBy: string | null;
        since: string;
        overdue: boolean;
      }>;
    }>('/people/recruitment/to-approve')
      .then((r): ApprovalGroup | null =>
        r.data.length
          ? {
              key: 'vacancy',
              title: 'Vacancies to approve',
              help: 'Posts raised for recruitment, waiting at your approval level',
              href: `/people/recruitment/${r.data[0]!.id}`,
              count: r.data.length,
              items: r.data.slice(0, size).map((x) => ({
                id: x.id,
                title: `${x.code} · ${x.title}`,
                detail: `${x.level} · ${x.department ? `${x.department} · ` : ''}${x.posts} post${x.posts > 1 ? 's' : ''}${x.raisedBy ? ` · raised by ${x.raisedBy}` : ''}${x.overdue ? ' · overdue' : ''}`,
                href: `/people/recruitment/${x.id}`,
                since: x.since,
              })),
            }
          : null,
      )
      .catch(() => null),
    // ACRs at my level (docs/design/32-employee-acr.md): any staff member may sit at a level, so this is
    // asked for everyone and is empty for those who do not
    apiFetch<{
      waiting: Array<{
        id: string;
        cycle: string;
        employee: { name: string; code: string; designation: string | null };
        level: { seq: number; label: string | null } | null;
        updatedAt: string;
      }>;
    }>('/people/acr/to-assess')
      .then((r): ApprovalGroup | null =>
        r.waiting.length
          ? {
              key: 'acr',
              title: 'ACRs to assess',
              help: 'Annual confidential reports at your level, waiting for your rating or review',
              href: '/me/acr',
              count: r.waiting.length,
              items: r.waiting.slice(0, size).map((x) => ({
                id: x.id,
                title: `${x.employee.name} · ${x.employee.code}`,
                detail: `${x.level?.label ?? 'Your level'} · ${x.cycle}${x.employee.designation ? ` · ${x.employee.designation}` : ''}`,
                href: `/me/acr/${x.id}`,
                since: x.updatedAt,
              })),
            }
          : null,
      )
      .catch(() => null),
    // transport requests wait on the people of a level (transport in-charge, fee department)
    apiFetch<{
      data: Array<{
        id: string;
        number: string;
        kindLabel: string;
        student: string;
        section: string | null;
        what: string;
        requestedAt: string;
      }>;
    }>('/transport/requests/inbox')
      .then((r): ApprovalGroup | null =>
        r.data.length
          ? {
              key: 'transport',
              title: 'Transport requests',
              help: 'New transport, changes and withdrawals waiting for your approval',
              href: '/transport/requests/approvals',
              count: r.data.length,
              items: r.data.slice(0, size).map((p) => ({
                id: p.id,
                title: `${p.student}${p.section ? ` · ${p.section}` : ''}`,
                detail: `${p.kindLabel} · ${p.what}`,
                href: `/transport/requests/${p.id}`,
                since: p.requestedAt,
              })),
            }
          : null,
      )
      .catch(() => null),
    // files for approval wait on the people their creator named
    has.has('files.movement.raise')
      ? apiFetch<{
          data: Array<{
            id: string;
            number: string;
            subject: string;
            createdBy: string;
            submittedAt: string;
          }>;
        }>('/file-movement?box=inbox')
          .then((r): ApprovalGroup | null =>
            r.data.length
              ? {
                  key: 'file',
                  title: 'File movement',
                  help: 'Files raised for approval that are with you now',
                  href: '/workflow/files',
                  count: r.data.length,
                  items: r.data.slice(0, size).map((n) => ({
                    id: n.id,
                    title: `${n.number} · ${n.subject}`,
                    detail: `raised by ${n.createdBy}`,
                    href: `/workflow/files/${n.id}`,
                    since: n.submittedAt,
                  })),
                }
              : null,
          )
          .catch(() => null)
      : null,
    // lessons uploaded by teachers wait for the approver of their level
    has.has('academics.lesson_plan.view')
      ? apiFetch<{
          data: Array<{ id: string; topic: string; employee: string; requestedAt: string }>;
          page: { total: number };
        }>('/academics/lessons?mine=approve&size=20')
          .then((r): ApprovalGroup | null =>
            r.data.length
              ? {
                  key: 'lesson',
                  title: 'Lessons',
                  help: 'Lessons uploaded by teachers that wait for you',
                  href: '/academics/lesson-plans?tab=report&mine=approve',
                  count: r.page.total,
                  items: r.data.slice(0, size).map((n) => ({
                    id: n.id,
                    title: `#${n.id} · ${n.topic}`,
                    detail: `uploaded by ${n.employee}`,
                    href: `/academics/lesson-plans/${n.id}`,
                    since: n.requestedAt,
                  })),
                }
              : null,
          )
          .catch(() => null)
      : null,
    // student leave waits on the people of a level (class teacher, coordinator, principal)
    has.has('attendance.leave.decide') || has.has('attendance.setup.manage')
      ? apiFetch<{
          data: Array<{
            id: string;
            number: string;
            student: string;
            section: string | null;
            leaveTypeLabel: string;
            fromDate: string;
            toDate: string;
            days: number;
            appliedAt: string;
          }>;
        }>('/attendance/leaves?tab=inbox')
          .then((r): ApprovalGroup | null =>
            r.data.length
              ? {
                  key: 'leave',
                  title: 'Student leave',
                  help: 'Leave the families applied for, waiting for your approval',
                  href: '/attendance/leaves',
                  count: r.data.length,
                  items: r.data.slice(0, size).map((l) => ({
                    id: l.id,
                    title: `${l.student}${l.section ? ` · ${l.section}` : ''}`,
                    detail: `${l.leaveTypeLabel} · ${l.fromDate}${l.toDate !== l.fromDate ? ` to ${l.toDate}` : ''} · ${String(l.days)} day${l.days === 1 ? '' : 's'}`,
                    href: `/attendance/leaves?tab=inbox&open=${l.id}`,
                    since: l.appliedAt,
                  })),
                }
              : null,
          )
          .catch(() => null)
      : null,
  ]);
  return groups.filter((g): g is ApprovalGroup => g !== null);
}
