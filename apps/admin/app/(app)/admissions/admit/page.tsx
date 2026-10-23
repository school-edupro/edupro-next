import { Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { AdmitBoard } from '@/components/admissions/AdmitBoard';
import { Notice } from '@/components/Notice';
import type { SessionPlan } from '@/lib/admission-setup';
import { apiFetch, getMe } from '@/lib/api';
import type { AdmissionCycle } from '@/lib/types';

interface AdmitList {
  session: { id: string; name: string; academicYear: string };
  class: { id: string; name: string };
  sections: Array<{ id: string; name: string; capacity: number | null; enrolled: number }>;
  candidates: Array<{
    id: string;
    number: string | null;
    admissionNo: string | null;
    candidate: string | null;
    gender: string;
    category: string | null;
    status: string;
    section: string | null;
  }>;
}

/** Admit (docs/design/39, part 6): who paid the admission fee in a class, sections given, then admitted together. */
export default async function AdmitPage({
  searchParams,
}: {
  searchParams: Promise<{
    cycleId?: string;
    classId?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('admissions.application.view')) notFound();
  const cycles = await apiFetch<{ data: AdmissionCycle[] }>('/admissions/cycles').then(
    (r) => r.data,
  );
  const cycleId = sp.cycleId ?? cycles.find((c) => c.status === 'open')?.id ?? cycles[0]?.id;
  const plan = cycleId ? await apiFetch<SessionPlan>(`/admissions/cycles/${cycleId}/plan`) : null;
  const classId =
    sp.classId && plan?.classes.some((k) => k.classId === sp.classId)
      ? sp.classId
      : plan?.classes[0]?.classId;
  const data =
    cycleId && classId
      ? await apiFetch<AdmitList>(`/admissions/cycles/${cycleId}/admit/${classId}`)
      : null;
  return (
    <>
      <PageHeader
        kicker="Admissions"
        title="Admit"
        description="Candidates who paid the admission fee become pupils: their form's answers, documents and photos go to the student master, the parents to the guardian records, and each gets a class-section."
      />
      <Notice params={sp} />
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <form
          method="get"
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'end', flexWrap: 'wrap' }}
        >
          <label className="ep-field">
            <span className="ep-field__label">Session</span>
            <select className="ep-select" name="cycleId" defaultValue={cycleId ?? ''}>
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Class</span>
            <select className="ep-select" name="classId" defaultValue={classId ?? ''}>
              {(plan?.classes ?? []).map((k) => (
                <option key={k.classId} value={k.classId}>
                  {k.className}
                </option>
              ))}
            </select>
          </label>
          <button className="ep-btn ep-btn--secondary" type="submit">
            Show
          </button>
        </form>
      </Card>
      {data ? (
        <Card elevated title={`${data.class.name} · ${data.session.academicYear}`}>
          <AdmitBoard
            candidates={data.candidates}
            sections={data.sections}
            canAdmit={me.permissions.includes('admissions.application.admit')}
          />
        </Card>
      ) : (
        <Card>No class in this session yet.</Card>
      )}
    </>
  );
}
