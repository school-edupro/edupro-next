import { Badge, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { DrawPicker } from '@/components/admissions/DrawPicker';
import { DrawRecord } from '@/components/admissions/DrawRecord';
import { DrawSettingsForm } from '@/components/admissions/DrawSettingsForm';
import { DrawTwins } from '@/components/admissions/DrawTwins';
import { ViewDownload } from '@/components/admissions/ViewDownload';
import { whenIst } from '@/lib/admission-process';
import type {
  DrawGroup,
  DrawOptions,
  DrawRecord as DrawRecordRow,
  DrawSettingsView,
  DrawTotals,
} from '@/lib/admission-draw';
import { apiFetch, getMe } from '@/lib/api';

type Tab = 'slips' | 'settings' | 'record';
const TABS: Array<[Tab, string]> = [
  ['slips', 'Slips'],
  ['settings', 'Slip settings'],
  ['record', 'Record the draw'],
];
const okId = (x: string | undefined) => (x && /^\d{1,18}$/.test(x) ? x : undefined);
const dmy = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'UTC',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(`${iso}T00:00:00Z`))
    : '-';

/**
 * Draw of lots (docs/design/60), the nursery practice: the candidates of a class sharing a points total
 * confirmed at Document check get a printed slip each (twins one), with the school's own heading and
 * details; the slips drawn by hand are entered in order: the first seats offered, the rest wait-listed.
 */
export default async function DrawPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('admissions.application.view')) notFound();
  const canEdit = me.permissions.includes('admissions.schedule.manage');
  const opts = await apiFetch<DrawOptions>('/admissions/draw/options');
  // the session and class with candidates on points first
  const cycle =
    opts.cycles.find((y) => y.id === sp.cycleId) ??
    opts.cycles.find((y) => y.classes.some((k) => k.withPoints > 0)) ??
    opts.cycles.find((y) => y.classes.length) ??
    opts.cycles[0];
  const cls =
    cycle?.classes.find((k) => k.id === sp.classId) ??
    cycle?.classes.find((k) => k.withPoints > 0) ??
    cycle?.classes[0];
  const categoryId = opts.categories.some((k) => k.id === okId(sp.categoryId))
    ? sp.categoryId!
    : '';
  const tab: Tab = TABS.some(([t]) => t === sp.tab) ? (sp.tab as Tab) : 'slips';
  const header = (
    <PageHeader
      kicker="Admissions"
      title="Draw of lots"
      description="Where the seats run out inside one points total, the candidates of that total are drawn by lot in front of the parents. Print their slips (points confirmed at Document check; twins share a slip), draw them by hand, then enter the drawn order: the first seats are offered and the rest wait-listed in that order."
    />
  );
  if (!cycle || !cls)
    return (
      <>
        {header}
        <p>No admission session with classes yet.</p>
      </>
    );
  const place: Record<string, string> = { cycleId: cycle.id, classId: cls.id };
  if (categoryId) place.categoryId = categoryId;
  const href = (t: Tab, extra: Record<string, string> = {}) =>
    `/admissions/draw?${new URLSearchParams({ ...place, ...(t === 'slips' ? {} : { tab: t }), ...extra }).toString()}`;
  const totals = await apiFetch<DrawTotals>(
    `/admissions/draw/totals?${new URLSearchParams(place).toString()}`,
  );
  const drawable = totals.totals.filter((t) => t.confirmed > 0);

  let body: React.ReactNode = null;
  if (tab === 'slips') {
    const points =
      totals.totals.find((t) => t.points === sp.points)?.points ??
      drawable[0]?.points ??
      totals.totals[0]?.points ??
      null;
    const group = points
      ? await apiFetch<DrawGroup>(
          `/admissions/draw/group?${new URLSearchParams({ ...place, points }).toString()}`,
        )
      : null;
    // each slip's number: twins not split share one
    const slipNo = new Map<string, number>();
    if (group) {
      let n = 0;
      for (const x of group.candidates) {
        if (slipNo.has(x.id)) continue;
        n += 1;
        const twin = group.twins.find((t) => t.state !== 'split' && t.ids.includes(x.id));
        for (const id of twin?.ids ?? [x.id]) slipNo.set(id, n);
      }
    }
    const names = Object.fromEntries(
      (group?.candidates ?? []).map((x) => [x.id, x.candidate ?? x.number]),
    );
    const twinOf = new Set(
      (group?.twins ?? []).filter((t) => t.state !== 'split').flatMap((t) => t.ids),
    );
    body = (
      <>
        <Card elevated title={`Points totals · ${cls.name}`}>
          {totals.totals.length ? (
            <div
              className="ep-table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Points totals (scrolls sideways)"
            >
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">
                  Each points total of {cls.name}: candidates confirmed and not yet
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="ep-num">
                      Points
                    </th>
                    <th scope="col" className="ep-num">
                      Confirmed
                    </th>
                    <th scope="col" className="ep-num">
                      Not confirmed yet
                    </th>
                    <th scope="col">
                      <span className="ep-sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {totals.totals.map((t) => (
                    <tr key={t.points} aria-current={t.points === points ? 'true' : undefined}>
                      <th scope="row" className="ep-num">
                        {t.points}
                      </th>
                      <td className="ep-num">{t.confirmed}</td>
                      <td className="ep-num">{t.unconfirmed || '-'}</td>
                      <td>
                        {t.points === points ? (
                          <Badge tone="info">Shown below</Badge>
                        ) : (
                          <a
                            className="ep-btn ep-btn--ghost ep-btn--sm"
                            href={href('slips', { points: t.points })}
                          >
                            Open<span className="ep-sr-only"> {t.points} points</span>
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ margin: 0 }}>
              No candidate of {cls.name} has points yet (the points come from the form and are
              confirmed at Document check).
            </p>
          )}
        </Card>
        {group ? (
          <section
            className="ep-card"
            aria-labelledby="draw-group-h"
            style={{ marginTop: 'var(--sp-4)' }}
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 'var(--sp-3)',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <h2 id="draw-group-h" className="ep-card__title" style={{ margin: 0 }}>
                {group.points} points · {group.candidates.length} candidate
                {group.candidates.length === 1 ? '' : 's'} · {group.slips} slip
                {group.slips === 1 ? '' : 's'}
              </h2>
              {group.candidates.length ? (
                <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                  <span className="ep-field__help" style={{ margin: 0 }}>
                    Slips
                  </span>
                  <ViewDownload
                    href={`/api/admission-draw/slips?${new URLSearchParams({ ...place, points: group.points }).toString()}`}
                    what={`the draw slips of ${cls.name}, ${group.points} points`}
                  />
                </span>
              ) : null}
            </div>
            {group.unconfirmed.length ? (
              <p className="ep-alert ep-alert--warning" role="status">
                <span>
                  {group.unconfirmed.length} more with {group.points} points{' '}
                  {group.unconfirmed.length === 1 ? 'has' : 'have'} no slip until the points are
                  confirmed at Document check:{' '}
                  {group.unconfirmed.map((x, i) => (
                    <span key={x.id}>
                      {i ? ', ' : ''}
                      <a href={`/admissions/registrations/${x.id}`}>{x.candidate ?? x.number}</a>
                    </span>
                  ))}
                  .
                </span>
              </p>
            ) : null}
            {group.twins.length ? (
              <div style={{ marginBottom: 'var(--sp-3)' }}>
                <h3 className="ep-card__title" style={{ fontSize: 'var(--fs-h5)' }}>
                  Twins
                </h3>
                <DrawTwins
                  cycleId={cycle.id}
                  classId={cls.id}
                  twins={group.twins}
                  names={names}
                  canEdit={canEdit}
                />
              </div>
            ) : null}
            {group.candidates.length ? (
              <div
                className="ep-table-wrap"
                tabIndex={0}
                role="region"
                aria-label="Candidates on the slips (scrolls sideways)"
              >
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">The candidates on the slips</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="ep-num">
                        S.No.
                      </th>
                      <th scope="col">Registration no.</th>
                      <th scope="col">Candidate</th>
                      <th scope="col">Father</th>
                      <th scope="col">Date of birth</th>
                      <th scope="col">Category</th>
                      <th scope="col">At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.candidates.map((x) => (
                      <tr key={x.id}>
                        <td className="ep-num">{slipNo.get(x.id)}</td>
                        <td>
                          <a href={`/admissions/registrations/${x.id}`}>{x.number}</a>
                        </td>
                        <td>
                          {x.candidate ?? '-'}{' '}
                          {twinOf.has(x.id) ? <Badge tone="info">Twin</Badge> : null}
                        </td>
                        <td>{x.father ?? '-'}</td>
                        <td>{dmy(x.dob)}</td>
                        <td>{x.category ?? '-'}</td>
                        <td>{x.stage ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ margin: 0 }}>Nobody of this total has confirmed points yet.</p>
            )}
          </section>
        ) : null}
      </>
    );
  } else if (tab === 'settings') {
    const view = await apiFetch<DrawSettingsView>(
      `/admissions/draw/settings?${new URLSearchParams({ cycleId: cycle.id, classId: cls.id }).toString()}`,
    );
    body = (
      <Card elevated title={`Slip settings · ${cls.name}`}>
        <DrawSettingsForm
          key={`${cycle.id}:${cls.id}:${view.from}`}
          cycleId={cycle.id}
          classId={cls.id}
          className={cls.name}
          view={view}
          canEdit={canEdit}
        />
      </Card>
    );
  } else {
    const records = await apiFetch<DrawRecordRow[]>(
      `/admissions/draw/records?${new URLSearchParams({ cycleId: cycle.id, classId: cls.id }).toString()}`,
    );
    body = (
      <>
        {canEdit ? (
          <Card elevated title={`Record the draw · ${cls.name}`}>
            {drawable.length ? (
              <DrawRecord
                key={`${cycle.id}:${cls.id}:${categoryId}`}
                cycleId={cycle.id}
                classId={cls.id}
                categoryId={categoryId}
                totals={drawable.map((t) => ({ points: t.points, slips: t.confirmed }))}
              />
            ) : (
              <p style={{ margin: 0 }}>No candidate of {cls.name} has confirmed points to draw.</p>
            )}
          </Card>
        ) : null}
        <Card elevated title="Draws recorded" style={{ marginTop: 'var(--sp-4)' }}>
          {records.length ? (
            <div
              className="ep-table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Draws recorded (scrolls sideways)"
            >
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">The draws recorded for {cls.name}</caption>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col" className="ep-num">
                      Points
                    </th>
                    <th scope="col">Category</th>
                    <th scope="col" className="ep-num">
                      Seats
                    </th>
                    <th scope="col" className="ep-num">
                      Offered
                    </th>
                    <th scope="col" className="ep-num">
                      Waiting list
                    </th>
                    <th scope="col">By</th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id}>
                      <td>{whenIst(r.at)}</td>
                      <td className="ep-num">{r.points}</td>
                      <td>{r.category ?? 'Every category'}</td>
                      <td className="ep-num">
                        {r.seats}
                        {r.extraSeats ? ` (+${String(r.extraSeats)} twin)` : ''}
                      </td>
                      <td className="ep-num">{r.offered}</td>
                      <td className="ep-num">{r.waitlisted}</td>
                      <td>{r.by ?? '-'}</td>
                      <td>
                        <ViewDownload
                          href={`/api/admission-draw/result/${r.id}`}
                          what={`the result of the ${r.points} points draw`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ margin: 0 }}>No draw recorded for {cls.name} yet.</p>
          )}
        </Card>
      </>
    );
  }

  return (
    <>
      {header}
      <DrawPicker
        opts={opts}
        cycleId={cycle.id}
        classId={cls.id}
        categoryId={categoryId}
        tab={tab}
      />
      <nav
        className="ep-lead-views"
        aria-label="Draw of lots"
        style={{ marginBottom: 'var(--sp-4)' }}
      >
        {TABS.map(([t, label]) => (
          <a key={t} href={href(t)} aria-current={tab === t ? 'page' : undefined}>
            {label}
          </a>
        ))}
      </nav>
      {body}
    </>
  );
}
