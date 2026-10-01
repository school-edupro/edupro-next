import { Breadcrumbs, Card, PageHeader } from '@edupro/ui';
import { WithdrawalDepartmentsEditor } from '@/components/WithdrawalDepartmentsEditor';
import { apiFetch } from '@/lib/api';
import type { WithdrawalDepartment } from '@/lib/types';

/** Withdrawal settings: departments, steps, approvers, automatic checks, bypass and the TC gate. */
export default async function WithdrawalSettingsPage() {
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
      <Card>
        <WithdrawalDepartmentsEditor
          departments={data.departments}
          roles={data.roles}
          staff={data.staff}
        />
      </Card>
    </>
  );
}
