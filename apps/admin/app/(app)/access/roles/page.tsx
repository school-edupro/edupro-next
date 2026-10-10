import { Badge, Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { createRole, disableRole } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import { buildMatrix } from '@/lib/permission-matrix';
import type { Permission, Role } from '@/lib/types';

/**
 * Roles and permissions: the school's own roles (changeable) and the standard roles (read-only, to
 * copy). Each row says in words where the role has access; opening it shows the rights grid.
 */
export default async function RolesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [me, roles, permissions] = await Promise.all([
    getMe(),
    apiFetch<{ data: Role[] }>('/access/roles'),
    apiFetch<{ data: Permission[] }>('/access/permissions'),
  ]);
  const canManage = me.permissions.includes('access.role.manage');
  const modules = buildMatrix(permissions.data);
  const access = (r: Role) => {
    const held = new Set(r.permissions);
    const full: string[] = [];
    const part: string[] = [];
    for (const m of modules) {
      const n = m.codes.filter((c) => held.has(c)).length;
      if (n === m.codes.length) full.push(m.label);
      else if (n > 0) part.push(m.label);
    }
    return { full, part };
  };
  const own = roles.data.filter((r) => !r.isSystem);
  const standard = roles.data.filter((r) => r.isSystem);

  const table = (list: Role[], caption: string) => (
    <div className="ep-table-wrap">
      <table className="ep-table">
        <caption className="ep-sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Role</th>
            <th scope="col">Where it has access</th>
            <th scope="col">Users</th>
            <th scope="col">Status</th>
            <th scope="col">
              <span className="ep-sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => {
            const a = access(r);
            return (
              <tr key={r.id}>
                <td>
                  <a href={`/access/roles/${r.id}`}>
                    <strong>{r.name}</strong>
                  </a>
                  {r.description ? <div className="ep-field__help">{r.description}</div> : null}
                </td>
                <td>
                  {a.full.length === 0 && a.part.length === 0 ? (
                    'No access yet'
                  ) : (
                    <>
                      {a.full.length > 0 ? <div>Full: {a.full.join(', ')}</div> : null}
                      {a.part.length > 0 ? <div>Part: {a.part.join(', ')}</div> : null}
                    </>
                  )}
                </td>
                <td>{r.activeAssignments}</td>
                <td>
                  <Badge tone={r.isSystem ? 'info' : r.status === 'active' ? 'success' : 'neutral'}>
                    {r.isSystem ? 'Standard' : r.status === 'active' ? 'In use' : 'Switched off'}
                  </Badge>
                </td>
                <td>
                  <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                    <a
                      className="ep-btn ep-btn--secondary ep-btn--sm"
                      href={`/access/roles/${r.id}`}
                    >
                      {r.isSystem || !canManage ? 'View rights' : 'Change rights'}
                    </a>
                    {!r.isSystem && canManage && r.status === 'active' ? (
                      <form action={disableRole}>
                        <input type="hidden" name="id" value={r.id} />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          disabled={r.activeAssignments > 0}
                          title={
                            r.activeAssignments > 0
                              ? 'Take the role back from its users first'
                              : undefined
                          }
                        >
                          Switch off
                        </Button>
                      </form>
                    ) : null}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <PageHeader
        kicker="Access"
        title="Roles and permissions"
        description="A role is a set of rights (view, add / edit, delete, approve). Give a role to a user under Assignments; change what a role allows here."
      />
      <Notice params={sp} />
      {canManage ? (
        <Card title="New role">
          <form
            action={createRole}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))',
              gap: 'var(--sp-4)',
              alignItems: 'end',
            }}
          >
            <InputField
              id="name"
              name="name"
              label="Role name"
              required
              placeholder="Fee cashier"
            />
            <InputField
              id="description"
              name="description"
              label="What it is for"
              placeholder="Collects fees at the counter"
            />
            <SelectField
              id="copyFromRoleId"
              name="copyFromRoleId"
              label="Start with the rights of"
              options={[
                { value: '', label: 'Nothing (tick the rights yourself)' },
                ...roles.data.map((r) => ({
                  value: r.id,
                  label: r.isSystem ? `${r.name} (standard)` : r.name,
                })),
              ]}
            />
            <div>
              <Button type="submit">Create and choose rights</Button>
            </div>
          </form>
        </Card>
      ) : null}
      <Card title={`School roles (${own.length})`} style={{ marginTop: 'var(--sp-4)' }}>
        {own.length === 0 ? (
          <p>
            No school role yet. The standard roles below work as they are; make a new role (or a
            copy of a standard one) when you need different rights.
          </p>
        ) : (
          table(own, 'School roles')
        )}
      </Card>
      <Card title={`Standard roles (${standard.length})`} style={{ marginTop: 'var(--sp-4)' }}>
        <p className="ep-field__help">
          Ready-made and the same in every school, so they cannot be changed here. Open one to see
          its rights or to make your own copy.
        </p>
        {table(standard, 'Standard roles')}
      </Card>
    </>
  );
}
