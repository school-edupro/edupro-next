import { PageHeader } from '@edupro/ui';
import { NoticeCompose } from '@/components/academics/NoticeCompose';
import { apiFetch } from '@/lib/api';
import { sectionOptions } from '@/lib/sections';
import type { ClassRow, Employee, Page } from '@/lib/types';

/** New notice or office order, composed like Communication → Compose. */
export default async function NewNoticePage() {
  const [classes, sections, employees] = await Promise.all([
    apiFetch<Page<ClassRow>>('/academics/classes?size=200').then((r) => r.data),
    sectionOptions(),
    apiFetch<Page<Employee>>('/people/employees?size=200')
      .then((r) => r.data)
      .catch(() => [] as Employee[]),
  ]);
  return (
    <>
      <PageHeader
        kicker="Communication · Notices and office orders"
        title="Compose"
        description="Write a notice for students and parents, or an office order for employees. It shows in their portal; it can also go by e-mail."
        actions={
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/academics/notices">
            Back to the list
          </a>
        }
      />
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
