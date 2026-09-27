import { Badge, Button, Card, DataTable, InputField, PageHeader, SelectField } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { createDelegation, revokeDelegation } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { Assignment, Delegation, Membership, Page } from '@/lib/types';

export default async function DelegationsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const canManage = me.permissions.includes('access.delegation.manage');
  const [delegations, members, myAssignments] = await Promise.all([
    apiFetch<{ data: Delegation[] }>('/access/delegations'),
    apiFetch<Page<Membership>>('/access/memberships?size=200'),
    apiFetch<Page<Assignment>>(
      `/access/assignments?active=true&size=200${canManage ? '' : `&userId=${me.user.id}`}`,
    ),
  ]);
  const roleOptions = [...new Map(myAssignments.data.map((a) => [a.roleId, a])).values()];
  const now = new Date();
  const local = (d: Date) =>
    new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  return (
    <>
      <PageHeader
        kicker="Access"
        title="Delegations"
        description="Hand a role you hold to a colleague for a fixed period, for example leave cover. Actions taken under a delegation record both people."
      />
      <Notice params={sp} />
      <Card>
        <DataTable<Delegation>
          caption="Delegations"
          columns={[
            { key: 'from', header: 'From', render: (d) => d.fromUserName },
            { key: 'to', header: 'To', render: (d) => d.toUserName },
            { key: 'role', header: 'Role', render: (d) => d.roleName },
            {
              key: 'window',
              header: 'Window',
              render: (d) =>
                `${new Date(d.startsAt).toLocaleString('en-IN')} → ${new Date(d.endsAt).toLocaleString('en-IN')}`,
            },
            { key: 'reason', header: 'Reason', render: (d) => d.reason },
            {
              key: 'status',
              header: 'Status',
              render: (d) => (
                <Badge tone={d.active ? 'success' : d.revokedAt ? 'danger' : 'neutral'}>
                  {d.active ? 'active' : d.revokedAt ? 'revoked' : 'scheduled or ended'}
                </Badge>
              ),
            },
            {
              key: 'actions',
              header: '',
              render: (d) =>
                d.revokedAt || (d.fromUserId !== me.user.id && !canManage) ? null : (
                  <form action={revokeDelegation}>
                    <input type="hidden" name="id" value={d.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      Revoke
                    </Button>
                  </form>
                ),
            },
          ]}
          rows={delegations.data}
          rowKey={(d) => d.id}
          emptyTitle="No delegations"
        />
      </Card>
      <Card title="Delegate a role" style={{ marginTop: 'var(--sp-5)' }}>
        <form
          action={createDelegation}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 'var(--sp-4)',
            alignItems: 'end',
          }}
        >
          {canManage ? (
            <SelectField
              id="d-from"
              name="fromUserId"
              label="On behalf of"
              options={[
                { value: '', label: 'Myself' },
                ...members.data.map((m) => ({ value: m.userId, label: m.displayName })),
              ]}
            />
          ) : null}
          <SelectField
            id="d-role"
            name="roleId"
            label="Role"
            required
            options={roleOptions.map((a) => ({
              value: a.roleId,
              label: canManage ? `${a.roleName} (held by ${a.userName})` : a.roleName,
            }))}
          />
          <SelectField
            id="d-to"
            name="toUserId"
            label="To"
            required
            options={members.data
              .filter((m) => m.status === 'active' && m.userId !== me.user.id)
              .map((m) => ({ value: m.userId, label: m.displayName }))}
          />
          <InputField
            id="d-start"
            name="startsAt"
            label="From"
            type="datetime-local"
            required
            defaultValue={local(now)}
          />
          <InputField
            id="d-end"
            name="endsAt"
            label="To"
            type="datetime-local"
            required
            defaultValue={local(new Date(now.getTime() + 7 * 86400000))}
            help="At most 90 days"
          />
          <InputField
            id="d-reason"
            name="reason"
            label="Reason"
            required
            placeholder="Leave cover 3 to 10 October"
          />
          <div>
            <Button type="submit">Delegate</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
