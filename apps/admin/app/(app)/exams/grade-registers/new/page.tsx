import { Breadcrumbs, PageHeader, newGradeDef } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { GradeRegisterBuilder } from '@/components/exams/GradeRegisterBuilder';
import { apiFetch, getMe } from '@/lib/api';
import type { GradeBuilderData } from '@/lib/grade-registers';

/** A new grade register (docs/design/69): the four-step builder from blank. */
export default async function NewGradeRegisterPage() {
  const me = await getMe();
  if (!me.permissions.includes('exams.registers.manage')) notFound();
  const data = await apiFetch<GradeBuilderData>('/exams/grade-registers/builder');
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Exams', href: '/exams' },
          { label: 'Grade registers', href: '/exams/grade-registers' },
          { label: 'New' },
        ]}
      />
      <PageHeader kicker="Registers" title="Create grade register" />
      <GradeRegisterBuilder
        init={{ name: '', classIds: [], def: newGradeDef() }}
        initialData={data}
      />
    </>
  );
}
