import { Breadcrumbs, Card, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { RegistersList } from '@/components/exams/RegistersList';
import { RegistersSwitch } from '@/components/exams/RegistersSwitch';
import { apiFetch, getMe } from '@/lib/api';
import type { GradeRegisterRow } from '@/lib/grade-registers';
import type { ClassRow, Page } from '@/lib/types';

/**
 * Grade registers (docs/design/69), the school's legacy Grade Register under the Registers switch: the
 * registers the person may use (a manager sees every one), each with Edit, Versions, Copy, Assign,
 * Access (All or As per mapping), Lock and Delete; a new one is built in four steps.
 */
export default async function GradeRegistersPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [me, list, classes] = await Promise.all([
    getMe(),
    apiFetch<{ data: GradeRegisterRow[]; canCreate: boolean; canAssign: boolean }>(
      '/exams/grade-registers',
    ),
    apiFetch<Page<ClassRow>>('/academics/classes?size=200').then((r) => r.data),
  ]);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Exams', href: '/exams' },
          { label: 'Registers', href: '/exams/schemes' },
          { label: 'Grade Register' },
        ]}
      />
      <PageHeader
        kicker="Registers"
        title="Grade registers"
        description="Set up once which assessments and indicators a class's grade sheet shows, in what order and with what headers, and the Overall per area; then run it for any section as a class sheet or student-wise, on screen, in PDF or in Excel."
      />
      <RegistersSwitch current="grade" permissions={me.permissions} />
      <Notice params={sp} />
      <Card elevated>
        <RegistersList
          kind="grade"
          rows={list.data}
          classes={classes.map((k) => ({ id: k.id, code: k.code }))}
          canCreate={list.canCreate}
          canAssign={list.canAssign}
        />
      </Card>
    </>
  );
}
