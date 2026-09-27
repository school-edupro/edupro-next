import { Badge, Button, Card, DataTable, InputField, PageHeader, SelectField } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { inviteMember, setMembershipStatus } from '@/lib/actions';
import { apiFetch } from '@/lib/api';
import type { Membership, Page, Role } from '@/lib/types';

export default async function MembershipsPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    q?: string;
    personType?: string;
  }>;
}) {
  const sp = await searchParams;
  const filter = new URLSearchParams({ size: '200' });
  if (sp.q) filter.set('q', sp.q);
  if (sp.personType) filter.set('personType', sp.personType);
  const [members, roles] = await Promise.all([
    apiFetch<Page<Membership>>(`/access/memberships?${filter.toString()}`),
    apiFetch<{ data: Role[] }>('/access/roles'),
  ]);

  return (
    <>
      <PageHeader
        kicker="Access"
        title="Members"
        description="People who can sign in to this school. Invite by mobile number or One Auth subject; the account is claimed on first sign-in."
      />
      <Notice params={sp} />
      <div className="ep-filter-band">
        <form
          method="get"
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <InputField
            id="q"
            name="q"
            label="Search"
            defaultValue={sp.q ?? ''}
            placeholder="Name, mobile or email"
          />
          <SelectField
            id="personType"
            name="personType"
            label="Type"
            defaultValue={sp.personType ?? ''}
            options={[
              { value: '', label: 'All' },
              { value: 'employee', label: 'Employees' },
              { value: 'guardian', label: 'Guardians' },
              { value: 'student', label: 'Students' },
              { value: 'external', label: 'External' },
            ]}
          />
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </form>
      </div>
      <Card>
        <DataTable<Membership>
          caption="Members"
          columns={[
            { key: 'name', header: 'Name', render: (m) => m.displayName },
            { key: 'contact', header: 'Contact', render: (m) => m.mobile ?? m.email ?? '' },
            { key: 'type', header: 'Type', render: (m) => m.personType },
            {
              key: 'login',
              header: 'Last sign-in',
              render: (m) =>
                m.pendingFirstLogin ? (
                  <Badge tone="warning">invited</Badge>
                ) : m.lastLoginAt ? (
                  new Date(m.lastLoginAt).toLocaleString('en-IN')
                ) : (
                  'never'
                ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (m) => (
                <Badge tone={m.status === 'active' ? 'success' : 'danger'}>{m.status}</Badge>
              ),
            },
            {
              key: 'actions',
              header: '',
              render: (m) => (
                <form action={setMembershipStatus} style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                  <input type="hidden" name="id" value={m.id} />
                  <input
                    type="hidden"
                    name="status"
                    value={m.status === 'active' ? 'inactive' : 'active'}
                  />
                  <a
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    href={`/access/assignments?userId=${m.userId}`}
                  >
                    Roles
                  </a>
                  <Button type="submit" variant="ghost" size="sm">
                    {m.status === 'active' ? 'Deactivate' : 'Activate'}
                  </Button>
                </form>
              ),
            },
          ]}
          rows={members.data}
          rowKey={(m) => m.id}
          emptyTitle="No members match"
        />
      </Card>

      <Card title="Invite a person" style={{ marginTop: 'var(--sp-5)' }}>
        <form
          action={inviteMember}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 'var(--sp-4)',
            alignItems: 'end',
          }}
        >
          <InputField id="i-name" name="displayName" label="Full name" required />
          <InputField
            id="i-mobile"
            name="mobile"
            label="Mobile"
            placeholder="98765 43210"
            pattern="[6-9][0-9]{9}"
            help="10 digits; used to match the One Auth account"
          />
          <InputField id="i-email" name="email" label="Email" type="email" />
          <SelectField
            id="i-type"
            name="personType"
            label="Type"
            options={[
              { value: 'employee', label: 'Employee' },
              { value: 'guardian', label: 'Guardian' },
              { value: 'student', label: 'Student' },
              { value: 'external', label: 'External' },
            ]}
          />
          <SelectField
            id="i-role"
            name="roleId"
            label="Initial role"
            options={[
              { value: '', label: 'None' },
              ...roles.data
                .filter((r) => r.status === 'active')
                .map((r) => ({ value: r.id, label: r.name })),
            ]}
          />
          <div>
            <Button type="submit">Invite</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
