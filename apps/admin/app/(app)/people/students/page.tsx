import { PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { StudentList } from '@/components/StudentList';
import {
  builderSave,
  studentListExport,
  studentListLoad,
  studentListSaveView,
} from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import { sanitizeView, type StudentListFields, type StudentListResult } from '@/lib/student-list';

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const can = (p: string) => me.permissions.includes(p);
  const [fields, saved] = await Promise.all([
    apiFetch<StudentListFields>('/people/students/grid/fields'),
    // the view this user saved for this school; other users keep their own
    apiFetch<{ value: unknown }>('/me/preferences/students.list').catch(() => ({ value: null })),
  ]);
  const view = sanitizeView(saved.value, new Set(fields.fields.map((f) => f.key)));
  const initial = await apiFetch<StudentListResult>('/people/students/grid', {
    method: 'POST',
    body: JSON.stringify({ ...view, search: view.search || undefined, page: 1 }),
  });
  return (
    <>
      <PageHeader
        kicker="People"
        title="Students"
        description="Every student of the working year. Search, filter on any field, choose the columns you want, and export exactly what you see. Class teachers see their own sections."
      />
      <Notice params={sp} />
      <StudentList
        fields={fields}
        initial={initial}
        initialView={view}
        can={{
          create: can('people.student.create'),
          importRun: can('people.import.run'),
          builder: can('reports.builder.use'),
          edit: can('people.student.edit'),
        }}
        actions={{
          load: studentListLoad,
          exportFile: studentListExport,
          saveReport: builderSave,
          saveView: studentListSaveView,
        }}
      />
    </>
  );
}
