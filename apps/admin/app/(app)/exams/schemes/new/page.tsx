import { Breadcrumbs, PageHeader, newRegisterDef } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { RegisterBuilder } from '@/components/exams/RegisterBuilder';
import { apiFetch, getMe } from '@/lib/api';
import type { RegisterRow } from '@/lib/mark-schemes';
import type { ClassRow, GradeScale, Page } from '@/lib/types';

/** A new mark register (docs/design/68): the six-step builder from blank. */
export default async function NewRegisterPage() {
  const me = await getMe();
  if (!me.permissions.includes('exams.registers.manage')) notFound();
  const [classes, scales, list] = await Promise.all([
    apiFetch<Page<ClassRow>>('/academics/classes?size=200').then((r) => r.data),
    apiFetch<{ data: GradeScale[] }>('/exams/grade-scales').then((r) => r.data),
    apiFetch<{ data: RegisterRow[] }>('/exams/schemes').then((r) => r.data),
  ]);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Exams', href: '/exams' },
          { label: 'Mark registers', href: '/exams/schemes' },
          { label: 'New' },
        ]}
      />
      <PageHeader kicker="Exams" title="Create mark register" />
      <RegisterBuilder
        init={{
          name: '',
          purpose: 'register',
          termCode: null,
          classIds: [],
          def: newRegisterDef(),
        }}
        classes={classes.map((k) => ({ id: k.id, code: k.code }))}
        scales={scales.map((g) => ({
          id: g.id,
          code: g.code,
          name: g.name,
          bands: (g.bands ?? []).map((b) => ({ grade: b.grade, minPct: Number(b.minPct) })),
        }))}
        registers={list.map((r) => ({ id: r.id, name: r.name }))}
        initialData={null}
      />
    </>
  );
}
