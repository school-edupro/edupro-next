import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ProfileEditor } from '@/components/ProfileEditor';
import { saveStudentProfile } from '@/lib/actions';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { ProfileCatalogue, ProfileSnapshot } from '@/lib/profile';

export default async function StudentProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const me = await getMe();
  const [catalogue, snapshot] = await Promise.all([
    apiFetch<ProfileCatalogue>('/people/profile/catalogue'),
    apiFetch<ProfileSnapshot>(`/people/students/${id}/profile`).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    }),
  ]);
  const e = snapshot.enrolment;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'People', href: '/people/students' },
          { label: 'Students', href: '/people/students' },
          { label: snapshot.displayName, href: `/people/students/${id}` },
          { label: 'Full profile' },
        ]}
      />
      <PageHeader
        kicker="Student profile"
        title={snapshot.displayName}
        description={
          <>
            Admission no <strong>{snapshot.admissionNo}</strong>
            {e
              ? ` · ${e.className} ${e.section}${e.rollNo ? ` · Roll ${String(e.rollNo)}` : ''} · ${e.academicYear}`
              : ''}
            {snapshot.masked.length ? ' · ID numbers are masked for you' : ''}
          </>
        }
        actions={
          <a className="ep-btn ep-btn--secondary" href={`/people/students/${id}`}>
            Back to student
          </a>
        }
      />
      <ProfileEditor
        catalogue={catalogue}
        snapshot={snapshot}
        canEdit={me.permissions.includes('people.student.edit')}
        save={saveStudentProfile}
        initialTab={catalogue.sections.some((s) => s.id === sp.tab) ? sp.tab : undefined}
      />
    </>
  );
}
