import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { IssueForm } from '@/components/purchase/IssueForm';
import { apiFetch, ApiError } from '@/lib/api';
import type { IssueFormLists, ToIssueGroup } from '@/lib/purchase';

/** An issue against a requisition's reservations (?requisition=&store=), or at the counter. */
export default async function NewIssuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ok = (v: string | undefined) => !!v && /^\d{1,18}$/.test(v);
  let lists: IssueFormLists;
  try {
    lists = await apiFetch<IssueFormLists>('/purchase/issue-form');
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  let group: ToIssueGroup | null = null;
  if (ok(sp.requisition) && ok(sp.store)) {
    const to = await apiFetch<{ groups: ToIssueGroup[] }>('/purchase/to-issue');
    group =
      to.groups.find((g) => g.requisitionId === sp.requisition && g.storeId === sp.store) ?? null;
    if (!group) notFound();
  }
  const title = group ? `Issue ${group.requisition}` : 'Counter issue';
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Purchase', href: '/purchase' },
          { label: 'Issues', href: '/purchase/issues' },
          { label: title },
        ]}
      />
      <PageHeader
        kicker={group ? `${group.store} · ${group.department ?? ''}` : 'Purchase · Issues'}
        title={title}
        description={
          group
            ? `What ${group.requisition} reserved in ${group.store}${group.indents ? ` for ${group.indents}` : ''}. Each indent gets its own issue; whoever took it (or the indent's raiser) acknowledges it.`
            : 'A quick issue to a department: who took it and why. Only free stock (in hand less what requisitions reserved) can go out.'
        }
      />
      <IssueForm lists={lists} group={group} />
    </>
  );
}
