import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { GroupDetail } from '@/components/comms/GroupDetail';
import { apiFetch, getMe } from '@/lib/api';
import { KIND_LABEL, type Group, type Member } from '@/lib/comms';
import { loadPickers } from '@/lib/comms-data';

export default async function GroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [me, group, members] = await Promise.all([
    getMe(),
    apiFetch<Group>(`/comms/groups/${id}`),
    apiFetch<{ data: Member[] }>(`/comms/groups/${id}/members`).then((r) => r.data),
  ]);
  const canManage = me.permissions.includes('comms.group.manage');
  const pickers = await loadPickers();
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Communication', href: '/comms' },
          { label: 'Groups', href: '/comms/groups' },
          { label: group.name },
        ]}
      />
      <PageHeader
        kicker={`${KIND_LABEL[group.kind]} · ${group.mode === 'rule' ? 'rule' : 'by hand / Excel'}`}
        title={group.name}
        description={group.description ?? undefined}
        actions={
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/comms/compose">
            Send a message
          </a>
        }
      />
      <Notice params={sp} />
      <GroupDetail
        group={group}
        members={members}
        canManage={canManage}
        options={pickers.options}
        classes={pickers.classes}
        sections={pickers.sections}
      />
    </>
  );
}
