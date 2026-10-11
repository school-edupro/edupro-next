import { Alert, Breadcrumbs, Button, Card, PageHeader } from '@edupro/ui';
import { WithdrawalDepartmentsEditor } from '@/components/WithdrawalDepartmentsEditor';
import { apiFetch } from '@/lib/api';
import { savePortalAfterLeaving } from '@/lib/fee-setup-actions';
import type { WithdrawalDepartment } from '@/lib/types';

/** Withdrawal settings: departments, steps, approvers, automatic checks, bypass and the TC gate. */
export default async function WithdrawalSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const portal = await apiFetch<{ days: number; studentRoleId: string; parentRoleId: string }>(
    '/people/withdrawal-portal-access',
  );
  const data = await apiFetch<{
    departments: WithdrawalDepartment[];
    roles: Array<{ id: string; name: string }>;
    staff: Array<{ userId: string; name: string; designation: string | null }>;
  }>('/people/withdrawal-departments');
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'People', href: '/people/students' },
          { label: 'Withdrawals', href: '/people/withdrawals' },
          { label: 'Departments and steps' },
        ]}
      />
      <PageHeader
        kicker="Withdrawal settings"
        title="Departments and steps"
        description="Who clears a leaving student, in which order. Departments at the same step work in parallel; the next step opens when the current one has cleared."
      />
      {sp.ok ? <Alert tone="success">Saved.</Alert> : null}
      {sp.error ? <Alert tone="danger">{sp.detail ?? 'Could not save.'}</Alert> : null}
      <Card title="Portal after leaving">
        <p className="ep-muted">
          When a withdrawal is completed the pupil and the parent keep their login for the days set
          here, but only with the rights of the two roles below (fees and receipts, results, profile
          and certificates to begin with). After the last day the portal shows them only a note that
          the access has ended. Set 0 to close the login as soon as the withdrawal is completed. A
          parent with another child in the school keeps the full portal for that child. Revoking the
          withdrawal gives the full portal back.
        </p>
        <form
          action={savePortalAfterLeaving}
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'end', flexWrap: 'wrap' }}
        >
          <label className="ep-field" htmlFor="portalDays">
            <span className="ep-field__label">Days the login stays open</span>
            <input
              className="ep-input"
              id="portalDays"
              name="days"
              type="number"
              min={0}
              max={730}
              defaultValue={portal.days}
              required
            />
          </label>
          <Button type="submit">Save</Button>
        </form>
        <p>
          What they may open:{' '}
          <a href={`/access/roles/${portal.studentRoleId}`}>Former student rights</a>
          {' · '}
          <a href={`/access/roles/${portal.parentRoleId}`}>Former parent rights</a>
        </p>
      </Card>
      <Card title="Departments and steps">
        <WithdrawalDepartmentsEditor
          departments={data.departments}
          roles={data.roles}
          staff={data.staff}
        />
      </Card>
    </>
  );
}
