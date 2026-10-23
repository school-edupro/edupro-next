import { PageHeader } from '@edupro/ui';
import { NoticeCompose } from '@/components/academics/NoticeCompose';
import { apiFetch } from '@/lib/api';
import { sectionOptions } from '@/lib/sections';
import type { AdmissionCycle, ClassRow, Employee, Page } from '@/lib/types';
import type { SessionPlan } from '@/lib/admission-setup';

/** New notice or office order, composed like Communication → Compose. */
export default async function NewNoticePage() {
  const [classes, sections, employees, departments, settings] = await Promise.all([
    apiFetch<Page<ClassRow>>('/academics/classes?size=200').then((r) => r.data),
    sectionOptions(),
    apiFetch<Page<Employee>>('/people/employees?size=200')
      .then((r) => r.data)
      .catch(() => [] as Employee[]),
    apiFetch<{ data: Array<{ name: string; employees: number }> }>('/academics/notices/departments')
      .then((r) => r.data)
      .catch(() => []),
    apiFetch<{ maxNoticeFiles: number }>('/academics/settings').catch(() => ({
      maxNoticeFiles: 5,
    })),
  ]);
  // classes of the open admission sessions, for a notice to candidates (online admission)
  const admissionClasses = await apiFetch<{ data: AdmissionCycle[] }>('/admissions/cycles')
    .then(async (r) => {
      const plans = await Promise.all(
        r.data
          .filter((c) => c.status === 'open')
          .map((c) => apiFetch<SessionPlan>(`/admissions/cycles/${c.id}/plan`).catch(() => null)),
      );
      const seen = new Map<string, string>();
      for (const p of plans) for (const k of p?.classes ?? []) seen.set(k.classId, k.className);
      return [...seen.entries()].map(([value, label]) => ({ value, label }));
    })
    .catch(() => [] as Array<{ value: string; label: string }>);
  return (
    <>
      <PageHeader
        kicker="Communication · Notices and office orders"
        title="Compose"
        description="Write a notice for students and parents, for candidates registering for admission, or an office order for employees. It shows in their portal; it can also go by e-mail."
        actions={
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/academics/notices">
            Back to the list
          </a>
        }
      />
      <NoticeCompose
        departments={departments.map((d) => ({
          value: d.name,
          label: `${d.name} (${String(d.employees)})`,
        }))}
        maxFiles={settings.maxNoticeFiles}
        admissionClasses={admissionClasses}
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
