import { Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { SlotForm } from '@/components/admissions/SlotForm';
import { Notice } from '@/components/Notice';
import { whenIst, type SlotRow } from '@/lib/admission-process';
import { apiFetch, getMe } from '@/lib/api';
import type { AdmissionCycle } from '@/lib/types';

interface Slots {
  session: { id: string; name: string };
  stages: Array<{ id: string; name: string; kind: string; waiting: number }>;
  classes: Array<{ id: string; name: string }>;
  slots: SlotRow[];
}

/** Tests and interviews of a session (docs/design/39, part 4): the slots and who waits for one. */
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ cycleId?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('admissions.application.view')) notFound();
  const cycles = await apiFetch<{ data: AdmissionCycle[] }>('/admissions/cycles').then(
    (r) => r.data,
  );
  const cycleId = sp.cycleId ?? cycles.find((c) => c.status === 'open')?.id ?? cycles[0]?.id;
  const data = cycleId ? await apiFetch<Slots>(`/admissions/cycles/${cycleId}/slots`) : null;
  const canManage = me.permissions.includes('admissions.schedule.manage');
  return (
    <>
      <PageHeader
        kicker="Admissions"
        title="Tests and interviews"
        description="Slots with date, venue and capacity; candidates waiting at a test, interview or interaction are allotted with a roll number, the schedule is mailed and the admit card shows in the admission portal."
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
          <button className="ep-btn ep-btn--secondary" type="submit">
            Show
          </button>
        </form>
      </Card>
      {data ? (
        <>
          <div className="ep-dash-kpis ep-dash-kpis--4" style={{ marginBottom: 'var(--sp-4)' }}>
            {data.stages.map((s) => (
              <Card key={s.id} title={s.name}>
                <div className="ep-cdash__big">{s.waiting}</div>
                <p className="ep-field__help" style={{ margin: 0 }}>
                  waiting for a slot
                </p>
              </Card>
            ))}
          </div>
          <Card elevated title="Slots" style={{ marginBottom: 'var(--sp-4)' }}>
            {data.slots.length === 0 ? (
              <p style={{ margin: 0 }}>No slot yet.</p>
            ) : (
              <div className="ep-table-wrap">
                <table className="ep-table">
                  <caption className="ep-sr-only">Slots</caption>
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">Stage</th>
                      <th scope="col">Class</th>
                      <th scope="col">Venue</th>
                      <th scope="col">Allotted</th>
                      <th scope="col">Results</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.slots.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <a href={`/admissions/schedule/${s.id}`}>{whenIst(s.startsAt)}</a>
                          <div className="ep-kicker">{s.minutes} minutes</div>
                        </td>
                        <td>{s.stage}</td>
                        <td>{s.className ?? 'Every class'}</td>
                        <td>{s.venue}</td>
                        <td>
                          {s.allotted} / {s.capacity}
                        </td>
                        <td>
                          {s.marked} of {s.allotted}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          {canManage && data.stages.length ? (
            <Card elevated title="Add a slot">
              <SlotForm cycleId={data.session.id} stages={data.stages} classes={data.classes} />
            </Card>
          ) : null}
        </>
      ) : (
        <Card>No admission session yet.</Card>
      )}
    </>
  );
}
