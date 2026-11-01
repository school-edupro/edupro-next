import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { RegisterBuilder } from '@/components/exams/RegisterBuilder';
import { ApiError, apiFetch } from '@/lib/api';
import type { BuilderData, MarkScheme, RegisterRow } from '@/lib/mark-schemes';
import type { ClassRow, GradeScale, Page } from '@/lib/types';

/** A mark register in the builder (docs/design/68); a locked one is saved as its next version. */
export default async function EditRegisterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const s = await apiFetch<MarkScheme>(`/exams/schemes/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  if (!s.rights.edit || s.status === 'superseded') notFound();
  const [classes, scales, list, data] = await Promise.all([
    apiFetch<Page<ClassRow>>('/academics/classes?size=200').then((r) => r.data),
    apiFetch<{ data: GradeScale[] }>('/exams/grade-scales').then((r) => r.data),
    apiFetch<{ data: RegisterRow[] }>('/exams/schemes').then((r) => r.data),
    apiFetch<BuilderData>(`/exams/schemes/builder?classIds=${s.classIds.join(',')}`),
  ]);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Exams', href: '/exams' },
          { label: 'Mark registers', href: '/exams/schemes' },
          { label: s.name, href: `/exams/schemes/${s.id}` },
          { label: 'Edit' },
        ]}
      />
      <PageHeader
        kicker={`Mark register · version ${String(s.version)}`}
        title={`Edit ${s.name}`}
        description={
          s.status === 'locked'
            ? 'This register is locked: saving makes its next version (a draft) and keeps this one until that is locked.'
            : undefined
        }
      />
      <RegisterBuilder
        init={{
          id: s.id,
          name: s.name,
          purpose: s.purpose,
          termCode: s.termCode,
          classIds: s.classIds,
          def: s.def,
          status: s.status,
          version: s.version,
        }}
        classes={classes.map((k) => ({ id: k.id, code: k.code }))}
        scales={scales.map((g) => ({
          id: g.id,
          code: g.code,
          name: g.name,
          bands: (g.bands ?? []).map((b) => ({ grade: b.grade, minPct: Number(b.minPct) })),
        }))}
        registers={list.map((r) => ({ id: r.id, name: r.name }))}
        initialData={data}
      />
    </>
  );
}
