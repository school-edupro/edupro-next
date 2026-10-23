import { Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { SlotCandidates } from '@/components/admissions/SlotCandidates';
import { SlotForm } from '@/components/admissions/SlotForm';
import { Notice } from '@/components/Notice';
import { whenIst, type SlotDetail } from '@/lib/admission-process';
import { ApiError, apiFetch, getMe } from '@/lib/api';

/** One test / interview slot (docs/design/39, part 4): allot, then attendance, marks and decisions. */
export default async function SlotPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('admissions.application.view')) notFound();
  const slot = await apiFetch<SlotDetail>(`/admissions/slots/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const meta = await apiFetch<{
    stages: Array<{ id: string; name: string }>;
    classes: Array<{ id: string; name: string }>;
  }>(`/admissions/cycles/${slot.session.id}/slots`);
  const canManage = me.permissions.includes('admissions.schedule.manage');
  return (
    <>
      <PageHeader
        kicker={`${slot.session.name} · ${slot.stage}`}
        title={whenIst(slot.startsAt)}
        description={`${slot.venue} · ${slot.className ?? 'every class'} · ${String(slot.minutes)} minutes`}
        actions={
          <a
            className="ep-btn ep-btn--ghost ep-btn--sm"
            href={`/admissions/schedule?cycleId=${slot.session.id}`}
          >
            All slots
          </a>
        }
      />
      <Notice params={sp} />
      <Card elevated title="Candidates" style={{ marginBottom: 'var(--sp-4)' }}>
        <SlotCandidates
          slot={slot}
          canAllot={canManage}
          canDecide={
            me.permissions.includes('admissions.application.decide') ||
            me.permissions.includes('admissions.setup.manage')
          }
        />
      </Card>
      {canManage ? (
        <Card elevated title="The slot">
          <SlotForm
            cycleId={slot.session.id}
            stages={meta.stages}
            classes={meta.classes}
            slot={{
              id: slot.id,
              stageId: slot.stageId,
              classId: slot.classId,
              startsAt: slot.startsAt,
              minutes: slot.minutes,
              venue: slot.venue,
              capacity: slot.capacity,
              notes: slot.notes,
              allotted: slot.candidates.length,
            }}
          />
        </Card>
      ) : null}
    </>
  );
}
