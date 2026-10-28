import { Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ResultsTools } from '@/components/admissions/ResultsTools';
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
      {canManage
        ? // marks by Excel for the slot's classes with a paper (docs/design/57): only this slot's candidates
          [
            ...new Map(
              slot.candidates.filter((c) => c.parts).map((c) => [c.classId, c.className] as const),
            ),
          ].map(([classId, className], _i, all) => (
            <ResultsTools
              key={classId}
              place={{ cycleId: slot.session.id, classId, stageId: slot.stageId }}
              query={new URLSearchParams({
                cycleId: slot.session.id,
                classId,
                stageId: slot.stageId,
                slotId: slot.id,
              }).toString()}
              canEdit={canManage}
              slotId={slot.id}
              title={`Marks by Excel${all.length > 1 ? ` · ${className}` : ''}`}
              help={`The sheet lists this slot's ${className} candidates still to be marked or decided, with a column per ${slot.kind === 'interview' ? 'parameter' : 'subject'}. Fill the marks, Absent (Y), Decision (Select or Hold) and Remark, then Check and Save. Every candidate of the class is on Admissions → Test results.`}
            />
          ))
        : null}
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
