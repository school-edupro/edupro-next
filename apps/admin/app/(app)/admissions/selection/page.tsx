import { Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { SelectionBoard } from '@/components/admissions/SelectionBoard';
import { Notice } from '@/components/Notice';
import type { Selection } from '@/lib/admission-process';
import type { SessionPlan } from '@/lib/admission-setup';
import { apiFetch, getMe } from '@/lib/api';
import type { AdmissionCycle } from '@/lib/types';

/** Selection (docs/design/39, part 4): seats per category, the merit list, offers and the waiting list of a class. */
export default async function SelectionPage({
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
      ? await apiFetch<Selection>(`/admissions/cycles/${cycleId}/selection/${classId}`)
      : null;
  return (
    <>
      <PageHeader
        kicker="Admissions"
        title="Selection"
        description="Offer seats from the merit list or by draw within the seats of each category; the rest wait in order. An offer not paid by its last date lapses and the next on the list can be offered."
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
        <>
          <div className="ep-dash-kpis ep-dash-kpis--4" style={{ marginBottom: 'var(--sp-4)' }}>
            <Card title="Seats">
              <div className="ep-cdash__big">{data.class.seats}</div>
              <p className="ep-field__help" style={{ margin: 0 }}>
                in {data.class.name}
              </p>
            </Card>
            <Card title="Offered or paid">
              <div className="ep-cdash__big">{data.class.taken}</div>
              <p className="ep-field__help" style={{ margin: 0 }}>
                {data.lapsed ? `${String(data.lapsed)} offers lapsed just now` : 'seats taken'}
              </p>
            </Card>
            <Card title="Seats left">
              <div className="ep-cdash__big">{data.class.left}</div>
              <p className="ep-field__help" style={{ margin: 0 }}>
                offers stay open {data.session.offerDays} days
              </p>
            </Card>
            <Card title="At Selection">
              <div className="ep-cdash__big">{data.merit.length}</div>
              <p className="ep-field__help" style={{ margin: 0 }}>
                {data.waiting.length} on the waiting list
              </p>
            </Card>
          </div>
          <Card title="Seats by category" style={{ marginBottom: 'var(--sp-4)' }}>
            <div className="ep-table-wrap">
              <table className="ep-table">
                <caption className="ep-sr-only">Seats by category</caption>
                <thead>
                  <tr>
                    <th scope="col">Category</th>
                    <th scope="col">Seats</th>
                    <th scope="col">Offered</th>
                    <th scope="col">Fee paid or admitted</th>
                  </tr>
                </thead>
                <tbody>
                  {data.categories.map((k) => (
                    <tr key={k.id}>
                      <td>{k.name}</td>
                      <td>{k.seats ?? 'From the class seats'}</td>
                      <td>{k.offered}</td>
                      <td>{k.paid}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="ep-field__help">
              Seats per category are set in the session&rsquo;s fee table.
            </p>
          </Card>
          <SelectionBoard
            data={data}
            canManage={me.permissions.includes('admissions.schedule.manage')}
          />
        </>
      ) : (
        <Card>No class in this session yet.</Card>
      )}
    </>
  );
}
