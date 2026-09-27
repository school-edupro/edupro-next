import {
  Badge,
  Button,
  Card,
  DataTable,
  InputField,
  PageHeader,
  SelectField,
  toneForStatus,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { createRole, disableRole } from '@/lib/actions';
import { apiFetch } from '@/lib/api';
import type { Permission, Role } from '@/lib/types';

export default async function RolesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const t = await getTranslations('pages.access_roles');
  const params = await searchParams;
  const [roles, permissions] = await Promise.all([
    apiFetch<{ data: Role[] }>('/access/roles'),
    apiFetch<{ data: Permission[] }>('/access/permissions'),
  ]);
  const templates = roles.data.filter((r) => r.isSystem);
  const modules = [...new Set(permissions.data.map((p) => p.module))].sort();

  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={params} />
      <Card>
        <DataTable<Role>
          caption="Roles"
          columns={[
            {
              key: 'name',
              header: 'Role',
              render: (r) => <a href={`/access/roles/${r.id}`}>{r.name}</a>,
            },
            { key: 'code', header: 'Code', render: (r) => <code>{r.code}</code> },
            { key: 'kind', header: 'Kind', render: (r) => (r.isSystem ? 'template' : r.kind) },
            {
              key: 'perms',
              header: 'Permissions',
              numeric: true,
              render: (r) => r.permissions.length,
            },
            {
              key: 'holders',
              header: 'Active holders',
              numeric: true,
              render: (r) => r.activeAssignments,
            },
            {
              key: 'status',
              header: 'Status',
              render: (r) => <Badge tone={toneForStatus(r.status)}>{r.status}</Badge>,
            },
            {
              key: 'actions',
              header: '',
              render: (r) =>
                r.isSystem ? null : (
                  <form action={disableRole}>
                    <input type="hidden" name="id" value={r.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="sm"
                      disabled={r.activeAssignments > 0}
                    >
                      Disable
                    </Button>
                  </form>
                ),
            },
          ]}
          rows={roles.data}
          rowKey={(r) => r.id}
        />
      </Card>

      <Card title="Create a school role" style={{ marginTop: 'var(--sp-5)' }}>
        <form action={createRole} style={{ display: 'grid', gap: 'var(--sp-4)' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 'var(--sp-4)',
            }}
          >
            <InputField
              id="code"
              name="code"
              label="Code"
              required
              placeholder="fee_cashier"
              help="Lower snake case"
              pattern="[a-z][a-z0-9_]{1,39}"
            />
            <InputField id="name" name="name" label="Name" required placeholder="Fee cashier" />
            <SelectField
              id="kind"
              name="kind"
              label="Kind"
              options={[
                { value: 'module', label: 'Module role' },
                { value: 'global', label: 'Global role' },
              ]}
            />
            <SelectField
              id="copyFromRoleId"
              name="copyFromRoleId"
              label="Copy permissions from"
              options={[
                { value: '', label: 'Start empty' },
                ...templates.map((t) => ({ value: t.id, label: `${t.name} (template)` })),
              ]}
            />
          </div>
          <InputField
            id="description"
            name="description"
            label="Description"
            placeholder="Collects fees at the counter"
          />
          <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
            <legend className="ep-field__label">Additional permissions</legend>
            {modules.map((m) => (
              <details key={m} style={{ marginBottom: 'var(--sp-2)' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 'var(--fw-semibold)' }}>
                  {m}
                </summary>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                    gap: 'var(--sp-2)',
                    padding: 'var(--sp-2) 0 var(--sp-3)',
                  }}
                >
                  {permissions.data
                    .filter((p) => p.module === m)
                    .map((p) => (
                      <label key={p.code} className="ep-check" htmlFor={`perm-${p.code}`}>
                        <input
                          id={`perm-${p.code}`}
                          type="checkbox"
                          name="permissions"
                          value={p.code}
                          className="ep-check__input"
                        />
                        <span className="ep-check__box" aria-hidden="true" />
                        <span className="ep-check__text">
                          <code>{p.code}</code>
                          <span className="ep-field__help">
                            {p.description}
                            {p.requiresMfa ? ' (MFA)' : ''}
                          </span>
                        </span>
                      </label>
                    ))}
                </div>
              </details>
            ))}
          </fieldset>
          <div>
            <Button type="submit">Create role</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
