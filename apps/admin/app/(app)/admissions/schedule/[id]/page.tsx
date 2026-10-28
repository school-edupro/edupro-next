import { Card, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ResultsGrid } from '@/components/admissions/ResultsGrid';
import { ResultsTools } from '@/components/admissions/ResultsTools';
import { SlotAllotment } from '@/components/admissions/SlotAllotment';
import { SlotCandidates } from '@/components/admissions/SlotCandidates';
import { SlotForm } from '@/components/admissions/SlotForm';
import { Notice } from '@/components/Notice';
import { whenIst, type SlotDetail } from '@/lib/admission-process';
import type { ResultsView } from '@/lib/admission-results';
import { ApiError, apiFetch, getMe } from '@/lib/api';

type Tab = 'marks' | 'excel' | 'allot' | 'details';
const TABS: Array<[Tab, string]> = [
  ['marks', 'Marks'],
  ['excel', 'Excel'],
  ['allot', 'Allotment and admit cards'],
  ['details', 'Slot details'],
];

/**
 * One test / interview slot (docs/design/58, part 2): a summary of the slot, then tabs. Marks: a row per
 * candidate with every subject of the class's paper, the total and %, absent, the decision and the
 * remark, any candidate changeable (a decided one with a reason); a class with no paper keeps one marks
 * figure. Excel: the slot's sheet. Allotment and admit cards. Slot details.
 */
export default async function SlotPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; tab?: string }>;
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
  const canManage = me.permissions.includes('admissions.schedule.manage');
  const canDecide =
    me.permissions.includes('admissions.application.decide') ||
    me.permissions.includes('admissions.setup.manage');
  const tab: Tab = TABS.some(([t]) => t === sp.tab) ? (sp.tab as Tab) : 'marks';
  const marksStage = slot.kind === 'test' || slot.kind === 'interview';
  // the slot's classes with a paper take marks by subject; the others keep one marks figure
  const paperClasses = [
    ...new Map(
      slot.candidates.filter((c) => c.parts).map((c) => [c.classId, c.className] as const),
    ),
  ];
  const plain = slot.candidates.filter((c) => !c.parts).map((c) => c.applicationId);
  const marked = slot.candidates.filter(
    (c) =>
      c.attendance === 'absent' ||
      c.marks !== null ||
      Object.values(c.partMarks).some((v) => v !== null),
  ).length;
  const held = slot.candidates.filter((c) => c.decision === 'hold').length;
  const waiting = slot.candidates.filter((c) => c.atStage && !c.decision).length;
  const decided = slot.candidates.filter((c) => c.decision && c.decision !== 'hold').length;
  const place = (classId: string) => ({
    cycleId: slot.session.id,
    classId,
    stageId: slot.stageId,
  });
  const grids =
    tab === 'marks' && marksStage
      ? await Promise.all(
          paperClasses.map(async ([classId, className]) => ({
            classId,
            className,
            data: await apiFetch<ResultsView>(
              `/admissions/results?${new URLSearchParams({ ...place(classId), slotId: slot.id }).toString()}`,
            ),
          })),
        )
      : [];
  const meta =
    tab === 'details'
      ? await apiFetch<{
          stages: Array<{ id: string; name: string }>;
          classes: Array<{ id: string; name: string }>;
        }>(`/admissions/cycles/${slot.session.id}/slots`)
      : null;
  const href = (t: Tab) => `/admissions/schedule/${slot.id}${t === 'marks' ? '' : `?tab=${t}`}`;

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
      <div className="ep-dash-kpis ep-dash-kpis--4" style={{ marginBottom: 'var(--sp-4)' }}>
        <KpiTile
          label="Allotted"
          value={`${String(slot.candidates.length)} / ${String(slot.capacity)}`}
          hint={`${String(slot.waiting)} more waiting for ${slot.stage}`}
        />
        <KpiTile
          label="Marked"
          value={marksStage ? marked : '-'}
          hint={marksStage ? 'marks (or absent) entered' : 'no marks at this stage'}
        />
        <KpiTile label="To decide" value={waiting + held} hint={`${String(held)} on hold`} />
        <KpiTile label="Decided" value={decided} hint="passed or not selected" />
      </div>
      <nav className="ep-lead-views" aria-label="Slot">
        {TABS.filter(([t]) => t !== 'excel' || marksStage).map(([t, label]) => (
          <a key={t} href={href(t)} aria-current={tab === t ? 'page' : undefined}>
            {label}
          </a>
        ))}
      </nav>

      {tab === 'marks' ? (
        <>
          {grids.map((g) =>
            g.data.place.paper ? (
              <div key={g.classId} style={{ marginBottom: 'var(--sp-4)' }}>
                <ResultsGrid
                  place={place(g.classId)}
                  paper={g.data.place.paper}
                  kind={g.data.place.kind}
                  rows={g.data.rows}
                  canEdit={canManage}
                  heading={`${g.className} · ${slot.stage} · out of ${String(g.data.place.paper.total)}`}
                />
              </div>
            ) : null,
          )}
          {plain.length || !marksStage ? (
            <Card
              elevated
              title={marksStage ? 'Marks (one figure: no paper for the class)' : 'Candidates'}
            >
              {marksStage ? (
                <p className="ep-field__help" style={{ marginTop: 0 }}>
                  These candidates&apos; class has no paper for {slot.stage}. Give it subjects in{' '}
                  <a href="/admissions/setup/papers">Test and interview papers</a> to mark them
                  subject by subject.
                </p>
              ) : null}
              <SlotCandidates
                slot={slot}
                only={marksStage ? plain : undefined}
                canAllot={false}
                canDecide={canDecide}
              />
            </Card>
          ) : null}
          {!slot.candidates.length ? (
            <p>
              No candidate is allotted yet: see{' '}
              <a href={href('allot')}>Allotment and admit cards</a>.
            </p>
          ) : null}
        </>
      ) : null}

      {tab === 'excel' ? (
        paperClasses.length ? (
          paperClasses.map(([classId, className], _i, all) => (
            <ResultsTools
              key={classId}
              place={place(classId)}
              query={new URLSearchParams({ ...place(classId), slotId: slot.id }).toString()}
              canEdit={canManage}
              slotId={slot.id}
              title={`Marks by Excel${all.length > 1 ? ` · ${className}` : ''}`}
              help={`The sheet lists this slot's ${className} candidates with their marks and decisions as they stand, a column per ${slot.kind === 'interview' ? 'parameter' : 'subject'}. Change what needs changing (a selected or not-selected candidate needs a Reason for change), then Check and Save: only the cells that differ are saved.`}
            />
          ))
        ) : (
          <p>
            The sheet needs a paper: give the class its subjects in{' '}
            <a href="/admissions/setup/papers">Test and interview papers</a>.
          </p>
        )
      ) : null}

      {tab === 'allot' ? (
        <Card elevated title="Allotment and admit cards">
          <SlotAllotment slot={slot} canAllot={canManage} />
        </Card>
      ) : null}

      {tab === 'details' ? (
        canManage && meta ? (
          <Card elevated title="Slot details">
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
        ) : (
          <Card elevated title="Slot details">
            <p style={{ margin: 0 }}>
              {whenIst(slot.startsAt)} · {String(slot.minutes)} minutes · {slot.venue} · up to{' '}
              {slot.capacity} candidates
              {slot.notes ? ` · ${slot.notes}` : ''}
            </p>
          </Card>
        )
      ) : null}
    </>
  );
}
