import { Badge, Button, Card, DataTable, InputField, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { grantRole, revokeAssignment } from '@/lib/actions';
import { apiFetch } from '@/lib/api';
import type { Assignment, Membership, Page, Role, School } from '@/lib/types';

export default async function AssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    active?: string;
    userId?: string;
  }>;
}) {
  const t = await getTranslations('pages.access_assignments');
  const sp = await searchParams;
  const filter = new URLSearchParams();
  if (sp.active) filter.set('active', sp.active);
  if (sp.userId) filter.set('userId', sp.userId);
  filter.set('size', '200');
  const [assignments, roles, members, school] = await Promise.all([
    apiFetch<Page<Assignment>>(`/access/assignments?${filter.toString()}`),
    apiFetch<{ data: Role[] }>('/access/roles'),
    apiFetch<Page<Membership>>('/access/memberships?size=200'),
    apiFetch<School>('/platform/school'),
  ]);

  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <div className="ep-filter-band">
        <form
          method="get"
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <SelectField
            id="active"
            name="active"
            label="Show"
            defaultValue={sp.active ?? ''}
            options={[
              { value: '', label: 'All' },
              { value: 'true', label: 'Active only' },
              { value: 'false', label: 'Inactive or revoked' },
            ]}
          />
          <SelectField
            id="userId"
            name="userId"
            label="Person"
            defaultValue={sp.userId ?? ''}
            options={[
              { value: '', label: 'Anyone' },
              ...members.data.map((m) => ({ value: m.userId, label: m.displayName })),
            ]}
          />
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </form>
      </div>
      <Card>
        <DataTable<Assignment>
          caption="Assignments"
          columns={[
            { key: 'user', header: 'Person', render: (a) => a.userName },
            {
              key: 'role',
              header: 'Role',
              render: (a) => <a href={`/access/roles/${a.roleId}`}>{a.roleName}</a>,
            },
            {
              key: 'valid',
              header: 'Valid',
              render: (a) => `${a.validFrom} → ${a.validTo ?? 'open'}`,
            },
            {
              key: 'scopes',
              header: 'Scopes',
              render: (a) =>
                a.scopes.length ? (
                  <a href={`/access/assignments/${a.id}`}>{a.scopes.length} scope(s)</a>
                ) : (
                  <a href={`/access/assignments/${a.id}`}>all</a>
                ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (a) => (
                <Badge tone={a.active ? 'success' : a.revokedAt ? 'danger' : 'warning'}>
                  {a.active ? 'active' : a.revokedAt ? 'revoked' : 'inactive'}
                </Badge>
              ),
            },
            {
              key: 'actions',
              header: '',
              render: (a) =>
                a.revokedAt ? null : (
                  <form action={revokeAssignment} style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="reason" value="revoked from admin" />
                    <Button type="submit" variant="ghost" size="sm">
                      Revoke
                    </Button>
                  </form>
                ),
            },
          ]}
          rows={assignments.data}
          rowKey={(a) => a.id}
          emptyTitle="No assignments match"
        />
      </Card>

      <Card title="Grant a role" style={{ marginTop: 'var(--sp-5)' }}>
        <form
          action={grantRole}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 'var(--sp-4)',
            alignItems: 'end',
          }}
        >
          <SelectField
            id="g-userId"
            name="userId"
            label="Person"
            required
            options={members.data
              .filter((m) => m.status === 'active')
              .map((m) => ({ value: m.userId, label: `${m.displayName} (${m.personType})` }))}
          />
          <SelectField
            id="g-roleId"
            name="roleId"
            label="Role"
            required
            options={roles.data
              .filter((r) => r.status === 'active')
              .map((r) => ({ value: r.id, label: r.isSystem ? `${r.name} (template)` : r.name }))}
          />
          <SelectField
            id="g-campusId"
            name="campusId"
            label="Campus"
            options={[
              { value: '', label: 'All campuses' },
              ...school.campuses.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <InputField id="g-validFrom" name="validFrom" label="Valid from" type="date" />
          <InputField
            id="g-validTo"
            name="validTo"
            label="Valid to"
            type="date"
            help="Leave empty for open-ended"
          />
          <InputField
            id="g-reason"
            name="reason"
            label="Reason"
            required
            placeholder="Joined as class teacher of VI-A"
          />
          <div>
            <Button type="submit">Grant</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
