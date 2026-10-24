import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ExitNewForm } from '@/components/exits/ExitNewForm';
import { apiFetch, getMe } from '@/lib/api';
import type { ExitSetup } from '@/lib/exits';

/** The office records an exit on an employee's behalf (any type); it goes through the approval levels. */
export default async function NewExitPage() {
  const me = await getMe();
  if (!me.permissions.includes('people.exit.manage')) notFound();
  const setup = await apiFetch<ExitSetup>('/people/exits/setup');
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Employee management', href: '/people/employees' },
          { label: 'Exits and resignations', href: '/people/exits' },
          { label: 'Record an exit' },
        ]}
      />
      <PageHeader
        kicker="Employee exit"
        title="Record an exit"
        description="A resignation handed in at the office, a termination, a retirement or the end of a contract. It goes through the approval levels of the employee’s type."
      />
      <ExitNewForm setup={setup} />
    </>
  );
}
