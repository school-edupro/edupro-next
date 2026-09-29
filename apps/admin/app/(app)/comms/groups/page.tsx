import { Button, Card, DataTable, FormActions, FormRow, InputField, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { createGroup, updateGroupMembers } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { CommsGroup, Membership, Page } from '@/lib/types';

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; group?: string }>;
}) {
  const sp = await searchParams;
  const [t, m, me, groups] = await Promise.all([
    getTranslations('pages.comms_groups'),
    getTranslations('comms'),
    getMe(),
    apiFetch<{ data: CommsGroup[] }>('/comms/groups').then((r) => r.data),
  ]);
  const canManage = me.permissions.includes('comms.group.manage');
  const selected = groups.find((g) => g.id === sp.group) ?? groups[0];
  const [members, all] = await Promise.all([
    selected
      ? apiFetch<{
          data: Array<{ id: string; name: string; mobile: string | null; email: string | null }>;
        }>(`/comms/groups/${selected.id}/members`).then((r) => r.data)
      : Promise.resolve([]),
    canManage
      ? apiFetch<Page<Membership>>('/access/memberships?size=200')
          .then((r) => r.data)
          .catch(() => [] as Membership[])
      : Promise.resolve([] as Membership[]),
  ]);
  const inGroup = new Set(members.map((x) => x.id));
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 560px), 1fr))',
        }}
      >
        <Card title={m('group')}>
          <DataTable<CommsGroup>
            caption={m('group')}
            density="dense"
            columns={[
              {
                key: 'name',
                header: m('groupName'),
                render: (g) => <a href={`/comms/groups?group=${g.id}`}>{g.name}</a>,
              },
              { key: 'code', header: m('groupCode'), render: (g) => <code>{g.code}</code> },
              { key: 'members', header: m('members'), numeric: true, render: (g) => g.members },
            ]}
            rows={groups}
            rowKey={(g) => g.id}
            emptyTitle={m('noGroups')}
          />
          {canManage ? (
            <form action={createGroup} style={{ marginTop: 'var(--sp-4)' }}>
              <FormRow columns={3}>
                <InputField
                  id="code"
                  name="code"
                  label={m('groupCode')}
                  required
                  pattern="[a-z0-9_-]{2,40}"
                />
                <InputField id="name" name="name" label={m('groupName')} required maxLength={120} />
                <InputField id="description" name="description" label={m('note')} maxLength={500} />
              </FormRow>
              <FormActions>
                <Button type="submit">{m('addGroup')}</Button>
              </FormActions>
            </form>
          ) : null}
        </Card>
        {selected ? (
          <Card title={`${selected.name} · ${m('members')}`}>
            <DataTable<{ id: string; name: string; mobile: string | null; email: string | null }>
              caption={m('members')}
              density="dense"
              columns={[
                { key: 'name', header: m('member'), render: (x) => x.name },
                { key: 'contact', header: m('address'), render: (x) => x.mobile ?? x.email ?? '' },
                ...(canManage
                  ? [
                      {
                        key: 'remove',
                        header: '',
                        render: (x: { id: string }) => (
                          <form action={updateGroupMembers}>
                            <input type="hidden" name="id" value={selected.id} />
                            <input type="hidden" name="remove" value={x.id} />
                            <Button type="submit" variant="ghost" size="sm">
                              {m('remove')}
                            </Button>
                          </form>
                        ),
                      },
                    ]
                  : []),
              ]}
              rows={members}
              rowKey={(x) => x.id}
              emptyTitle={m('members')}
            />
            {canManage ? (
              <form action={updateGroupMembers} style={{ marginTop: 'var(--sp-4)' }}>
                <input type="hidden" name="id" value={selected.id} />
                <label className="ep-field" htmlFor="add">
                  <span className="ep-field__label">{m('addMembers')}</span>
                  <select id="add" name="add" className="ep-input" multiple size={8}>
                    {all
                      .filter((u) => !inGroup.has(u.userId))
                      .map((u) => (
                        <option key={u.userId} value={u.userId}>
                          {u.displayName} · {u.personType} · {u.mobile ?? u.email ?? ''}
                        </option>
                      ))}
                  </select>
                </label>
                <FormActions>
                  <Button type="submit" variant="secondary">
                    {m('addMembers')}
                  </Button>
                </FormActions>
              </form>
            ) : null}
          </Card>
        ) : null}
      </div>
    </>
  );
}
