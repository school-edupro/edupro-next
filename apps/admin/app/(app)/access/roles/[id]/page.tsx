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
import { Notice } from '@/components/Notice';
import { PermissionMatrix } from '@/components/access/PermissionMatrix';
import { createRole, updateRole } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { Permission, Role } from '@/lib/types';

/**
 * One role: its name and its rights as a grid (features down, View / Add-Edit / Delete / Approve /
 * Other across). Standard roles are read-only; "Make my own copy" gives a school role to change.
 */
export default async function RolePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [me, role, permissions] = await Promise.all([
    getMe(),
    apiFetch<Role>(`/access/roles/${id}`),
    apiFetch<{ data: Permission[] }>('/access/permissions'),
  ]);
  const canManage = me.permissions.includes('access.role.manage');
  const readOnly = role.isSystem || !canManage;

  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Roles and permissions', href: '/access/roles' }, { label: role.name }]}
      />
      <PageHeader
        kicker="Access"
        title={role.name}
        description={
          <>
            {role.isSystem ? 'Standard role (read-only)' : 'School role'} · held by{' '}
            {role.activeAssignments} user{role.activeAssignments === 1 ? '' : 's'}
            {role.description ? ` · ${role.description}` : ''}
          </>
        }
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <Badge tone={role.isSystem ? 'info' : role.status === 'active' ? 'success' : 'neutral'}>
              {role.isSystem ? 'Standard' : role.status === 'active' ? 'In use' : 'Switched off'}
            </Badge>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/access/assignments">
              Give this role to a user
            </a>
          </span>
        }
      />
      <Notice params={sp} />
      {role.isSystem && canManage ? (
        <Alert tone="info" title="A standard role cannot be changed">
          <p>
            To change what it allows, make your own copy, tick or untick the rights there, then give
            the copy to your users in place of this role.
          </p>
          <form
            action={createRole}
            style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'end', flexWrap: 'wrap' }}
          >
            <input type="hidden" name="copyFromRoleId" value={role.id} />
            <input type="hidden" name="description" value={role.description} />
            <InputField
              id="copy-name"
              name="name"
              label="Name of your copy"
              defaultValue={`${role.name} (school)`}
              required
            />
            <Button type="submit">Make my own copy</Button>
          </form>
        </Alert>
      ) : null}
      <form action={updateRole} style={{ display: 'grid', gap: 'var(--sp-4)' }}>
        <input type="hidden" name="id" value={role.id} />
        {role.isSystem ? null : (
          <Card title="Role">
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))',
                gap: 'var(--sp-4)',
              }}
            >
              <InputField
                id="name"
                name="name"
                label="Name"
                defaultValue={role.name}
                required
                disabled={readOnly}
              />
              <InputField
                id="description"
                name="description"
                label="What this role is for"
                defaultValue={role.description}
                disabled={readOnly}
              />
              <SelectField
                id="status"
                name="status"
                label="Status"
                defaultValue={role.status}
                disabled={readOnly}
                options={[
                  { value: 'active', label: 'In use' },
                  { value: 'inactive', label: 'Switched off' },
                ]}
              />
            </div>
          </Card>
        )}
        <Card title="What this role can do">
          <PermissionMatrix
            permissions={permissions.data}
            held={role.permissions}
            readOnly={readOnly}
          />
        </Card>
        {readOnly ? null : (
          <div
            className="ep-card"
            style={{
              position: 'sticky',
              bottom: 0,
              display: 'flex',
              gap: 'var(--sp-3)',
              alignItems: 'center',
            }}
          >
            <Button type="submit">Save role</Button>
            <a className="ep-btn ep-btn--ghost" href="/access/roles">
              Cancel
            </a>
            <span className="ep-field__help">
              Users holding this role get the change at their next page load.
            </span>
          </div>
        )}
      </form>
    </>
  );
}
