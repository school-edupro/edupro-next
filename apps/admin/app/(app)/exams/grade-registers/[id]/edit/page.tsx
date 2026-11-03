import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { GradeRegisterBuilder } from '@/components/exams/GradeRegisterBuilder';
import { ApiError, apiFetch } from '@/lib/api';
import type { GradeBuilderData, GradeRegister } from '@/lib/grade-registers';

/** A grade register in the builder (docs/design/69); a locked one saves as its next version. */
export default async function EditGradeRegisterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const reg = await apiFetch<GradeRegister>(`/exams/grade-registers/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  });
  if (!reg.rights.edit || reg.status === 'superseded') notFound();
  const q = new URLSearchParams({
    classIds: reg.classIds.join(','),
    examIds: reg.def.exams.map((e) => e.examId).join(','),
  });
  const data = await apiFetch<GradeBuilderData>(`/exams/grade-registers/builder?${q.toString()}`);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Exams', href: '/exams' },
          { label: 'Grade registers', href: '/exams/grade-registers' },
          { label: reg.name },
        ]}
      />
      <PageHeader
        kicker={`Edit · version ${String(reg.version)}`}
        title={reg.name}
        actions={
          reg.status === 'locked' ? (
            <Badge tone="success">Locked: saving makes the next version</Badge>
          ) : null
        }
      />
      <GradeRegisterBuilder
        init={{
          id: reg.id,
          name: reg.name,
          classIds: reg.classIds,
          def: reg.def,
          status: reg.status,
          version: reg.version,
        }}
        initialData={data}
      />
    </>
  );
}
