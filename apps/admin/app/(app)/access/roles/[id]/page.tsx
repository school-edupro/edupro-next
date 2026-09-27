import {
  Alert,
  Badge,
  Breadcrumbs,
  Button,
  Card,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { updateRole } from '@/lib/actions';
import { apiFetch } from '@/lib/api';
import type { Permission, Role } from '@/lib/types';

export default async function RolePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const t = await getTranslations('pages.access_roles_detail');
  const { id } = await params;
  const sp = await searchParams;
  const [role, permissions] = await Promise.all([
    apiFetch<Role>(`/access/roles/${id}`),
    apiFetch<{ data: Permission[] }>('/access/permissions'),
  ]);
  const modules = [...new Set(permissions.data.map((p) => p.module))].sort();
  const held = new Set(role.permissions);

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Access', href: '/access/roles' },
          { label: 'Roles', href: '/access/roles' },
          { label: role.name },
        ]}
      />
      <PageHeader
        kicker={t('kicker')}
        title={role.name}
        description={
          <>
            <code>{role.code}</code> · {role.isSystem ? 'system template' : `${role.kind} role`} ·{' '}
            {role.activeAssignments} active holder(s)
          </>
        }
        actions={
          <Badge tone={role.isSystem ? 'info' : 'success'}>
            {role.isSystem ? 'template' : role.status}
          </Badge>
        }
      />
      <Notice params={sp} />
      {role.isSystem ? (
        <Alert tone="info" title="Templates are read-only">
          Create a school role from the Roles page and choose this template under "Copy permissions
          from" to adapt it.
        </Alert>
      ) : null}
      <Card style={{ marginTop: 'var(--sp-4)' }}>
        <form action={updateRole} style={{ display: 'grid', gap: 'var(--sp-4)' }}>
          <input type="hidden" name="id" value={role.id} />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 'var(--sp-4)',
            }}
          >
            <InputField
              id="name"
              name="name"
              label="Name"
              defaultValue={role.name}
              required
              disabled={role.isSystem}
            />
            <SelectField
              id="status"
              name="status"
              label="Status"
              defaultValue={role.status}
              disabled={role.isSystem}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
            />
          </div>
          <InputField
            id="description"
            name="description"
            label="Description"
            defaultValue={role.description}
            disabled={role.isSystem}
          />
          <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
            <legend className="ep-field__label">Permissions ({role.permissions.length})</legend>
            {modules.map((m) => (
              <div key={m} style={{ marginBottom: 'var(--sp-3)' }}>
                <div className="ep-kicker">{m}</div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                    gap: 'var(--sp-2)',
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
                          defaultChecked={held.has(p.code)}
                          disabled={role.isSystem}
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
              </div>
            ))}
          </fieldset>
          {role.isSystem ? null : (
            <div>
              <Button type="submit">Save role</Button>
            </div>
          )}
        </form>
      </Card>
    </>
  );
}
