import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ExitSetupEditor } from '@/components/exits/ExitSetupEditor';
import { ApprovalLevelsEditor } from '@/components/recruitment/ApprovalLevelsEditor';
import { apiFetch, getMe } from '@/lib/api';
import { saveExitApproval } from '@/lib/exit-actions';
import type { EmployeeType, ExitSetup } from '@/lib/exits';
import type { ApprovalSetup } from '@/lib/recruitment';

/** Exit set-up: types, notice, clearance departments, and who approves per employee type. */
export default async function ExitSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('people.exit.view')) notFound();
  const setup = await apiFetch<ExitSetup>('/people/exits/setup');
  const type = (setup.employeeTypes.find((t) => t.code === sp.type)?.code ??
    'teaching') as EmployeeType;
  const approval = await apiFetch<ApprovalSetup>(`/people/exits/setup/approval/${type}`);
  const typeName = setup.employeeTypes.find((t) => t.code === type)?.name ?? type;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Employee management', href: '/people/employees' },
          { label: 'Exits and resignations', href: '/people/exits' },
          { label: 'Set-up' },
        ]}
      />
      <PageHeader
        kicker="Employee exit"
        title="Exit set-up"
        description="The exit types, the notice period, the no-dues departments, and who approves an exit for each type of employee."
      />
      <ExitSetupEditor setup={setup} />
      <nav
        aria-label="Employee type"
        className="ep-tabs-links"
        style={{ margin: 'var(--sp-4) 0 var(--sp-2)' }}
      >
        {setup.employeeTypes.map((t) => (
          <a
            key={t.code}
            href={`?type=${t.code}`}
            aria-current={t.code === type ? 'page' : undefined}
          >
            {t.name}
          </a>
        ))}
      </nav>
      <ApprovalLevelsEditor
        key={type}
        setup={approval}
        save={saveExitApproval.bind(null, type)}
        title={`Who approves the exit of ${typeName.toLowerCase()} staff`}
        intro="A resignation or an exit the office records goes through these levels in order and shows in each approver’s approvals (here and in the staff app). A level nobody holds is skipped; the level of the person who raised it, and a level of someone who already approved it, count as approved."
        hodLabel="HOD of the employee’s department"
        hodHelp="The HOD set on the employee’s department approves."
        waitingNoun={['exit', 'exits']}
        allowManager
        allowRole
        idPrefix={`xa-${type}`}
      />
    </>
  );
}
