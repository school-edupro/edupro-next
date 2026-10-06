import { PageHeader } from '@edupro/ui';
import { AcademicsNav } from '@/components/academics/AcademicsNav';
import { NoticeCompose } from '@/components/academics/NoticeCompose';
import { apiFetch, getMe } from '@/lib/api';
import { sectionOptions } from '@/lib/sections';
import type { ClassRow, Employee, Page } from '@/lib/types';

/** New notice or office order, composed like Communication → Compose. */
export default async function NewNoticePage() {
  const [me, classes, sections, employees] = await Promise.all([
    getMe(),
    apiFetch<Page<ClassRow>>('/academics/classes?size=200').then((r) => r.data),
    sectionOptions(),
    apiFetch<Page<Employee>>('/people/employees?size=200')
      .then((r) => r.data)
      .catch(() => [] as Employee[]),
  ]);
  return (
    <>
      <PageHeader
        kicker="Academics · Notices and office orders"
        title="Compose"
        description="Write a notice for students and parents, or an office order for employees. It shows in their portal; it can also go by e-mail."
        actions={
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/academics/notices">
            Back to the list
          </a>
        }
      />
      <AcademicsNav current="/academics/notices" permissions={me.permissions} />
      <NoticeCompose
        classes={classes.map((k) => ({ value: k.id, label: `${k.code} · ${k.name}` }))}
        sections={sections}
        employees={employees.map((e) => ({
          value: e.id,
          label: `${e.employeeCode} · ${e.displayName}`,
        }))}
      />
    </>
  );
}
