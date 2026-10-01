import { apiFetch } from './api';

/** One kind of approval waiting for the signed-in user, for the header count and My approvals. */
export interface ApprovalGroup {
  key: 'profile' | 'workflow' | 'withdrawal';
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
  instance: { definitionName: string; subject: string | null; createdAt?: string };
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
          .then((r): ApprovalGroup => ({
            key: 'workflow',
            title: 'Approval steps',
            help: 'Leave, admissions, lesson plans, messages and other requests at your step',
            href: '/workflow/inbox',
            count: r.data.length,
            items: r.data.slice(0, size).map((x) => ({
              id: x.id,
              title: x.instance.subject ?? x.instance.definitionName,
              detail: `${x.instance.definitionName} · ${x.name}${x.overdue ? ' · overdue' : ''}`,
              href: '/workflow/inbox',
              since: x.instance.createdAt ?? null,
            })),
          }))
          .catch(() => null)
      : null,
  ]);
  return groups.filter((g): g is ApprovalGroup => g !== null);
}
