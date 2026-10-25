import { PageHeader } from '@edupro/ui';
import { NoticeCompose } from '@/components/academics/NoticeCompose';
import { apiFetch } from '@/lib/api';
import { sectionOptions } from '@/lib/sections';
import type { AdmissionCycle, ClassRow, Employee, Page } from '@/lib/types';
import type { SessionPlan } from '@/lib/admission-setup';
import type { CandidateSession } from '@/lib/comms';

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
  // the admission sessions with their classes, for a notice to candidates (as Communication → Compose)
  const candidateSessions: CandidateSession[] = await apiFetch<{ data: AdmissionCycle[] }>(
    '/admissions/cycles',
  )
    .then(async (r) =>
      Promise.all(
        r.data
          // the open sessions first, then the latest closed ones
          .filter((c) => c.status !== 'draft')
          .sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open'))
          .slice(0, 6)
          .map(async (c) => {
            const plan = await apiFetch<SessionPlan>(`/admissions/cycles/${c.id}/plan`).catch(
              () => null,
            );
            return {
              id: c.id,
              name: c.status === 'open' ? c.name : `${c.name} (closed)`,
              classes: (plan?.classes ?? []).map((k) => ({
                value: k.classId,
                label: k.className,
              })),
            };
          }),
      ),
    )
    .catch(() => [] as CandidateSession[]);
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
        candidateSessions={candidateSessions}
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
