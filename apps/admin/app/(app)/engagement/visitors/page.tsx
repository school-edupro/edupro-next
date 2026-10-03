import { Alert, Badge, Button, Card, PageHeader, SelectField } from '@edupro/ui';
import { AppointmentNav } from '@/components/appointments/AppointmentNav';
import { ExportWatcher } from '@/components/ExportWatcher';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { timeOf, when } from '@/lib/appointments';
import { admitVisitor, exitVisitor, exportVisitorsPdf, refuseVisitor } from '@/lib/visitor-actions';
import {
  VISITOR_SOURCE,
  VISITOR_STATE,
  VISITOR_TONE,
  type Visitor,
  type VisitorList,
  type VisitorOptions,
} from '@/lib/visitors';

type Search = {
  state?: string;
  from?: string;
  to?: string;
  type?: string;
  q?: string;
  size?: string;
  page?: string;
  export?: string;
  ok?: string;
  error?: string;
  detail?: string;
};
const STATES: Array<[string, string]> = [
  ['inside', 'Inside now'],
  ['waiting', 'Waiting at the gate'],
  ['today', 'Today'],
  ['left', 'Left'],
  ['all', 'Everything'],
];
const SIZES = ['10', '25', '50', '100'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const OK: Record<string, string> = {
  admitted: 'Let in. The person to be met has been told by mail.',
  refused: 'Marked as not let in.',
  left: 'Exit recorded.',
};

/**
 * The visitor register (0065): everyone who came through the gate, with or without an appointment. Who is
 * inside now, who registered on their phone and is waiting to be let in, the exit, the card, and the list
 * for any period as Excel or PDF.
 */
export default async function VisitorsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const state = STATES.some(([v]) => v === sp.state) ? sp.state! : 'inside';
  const size = SIZES.includes(sp.size ?? '') ? sp.size! : '25';
  const page = Math.max(1, Number(sp.page) || 1);
  const filters = Object.fromEntries(
    Object.entries({
      state,
      from: DATE.test(sp.from ?? '') ? sp.from : undefined,
      to: DATE.test(sp.to ?? '') ? sp.to : undefined,
      type: sp.type?.trim().slice(0, 60) || undefined,
      q: sp.q?.trim().slice(0, 80) || undefined,
    }).filter(([, v]) => v),
  ) as Record<string, string>;
  const qs = (extra: Record<string, string>) =>
    new URLSearchParams({ ...filters, ...(size === '25' ? {} : { size }), ...extra }).toString();
  const [me, list, options] = await Promise.all([
    getMe(),
    apiFetch<VisitorList>(
      `/visitors?${new URLSearchParams({ ...filters, size, page: String(page) }).toString()}`,
    ),
    apiFetch<VisitorOptions>('/visitors/options'),
  ]);
  const pages = Math.max(1, Math.ceil(list.page.total / list.page.size));
  const here = `/engagement/visitors?${qs({ page: String(page) })}`;
  const tabs: Array<[string, string, number | null]> = [
    ['inside', 'Inside now', list.counts.inside],
    ['waiting', 'Waiting at the gate', list.counts.waiting],
    ['today', 'Today', list.counts.today],
    ['left', 'Left', null],
    ['all', 'Everything', null],
  ];
  const gates = options.gates.map((g) => ({ value: g, label: g }));
  const action = (v: Visitor) =>
    v.state === 'inside' ? (
      <form action={exitVisitor} className="ep-gate__act">
        <input type="hidden" name="id" value={v.id} />
        <input type="hidden" name="returnTo" value={here} />
        {gates.length > 1 ? (
          <select
            name="exitGate"
            className="ep-select"
            defaultValue={v.gate ?? gates[0]!.value}
            aria-label={`Exit gate for ${v.number}`}
          >
            {gates.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        ) : (
          <input type="hidden" name="exitGate" value={gates[0]?.value ?? ''} />
        )}
        <input
          name="note"
          className="ep-input"
          maxLength={300}
          placeholder={v.equipment ? 'Equipment taken back?' : 'Note'}
          aria-label={`Exit note for ${v.number}`}
        />
        <Button type="submit" size="sm" aria-label={`Record exit of ${v.number}`}>
          Exit
        </Button>
      </form>
    ) : v.state === 'waiting' ? (
      <div className="ep-gate__act">
        <form action={admitVisitor} className="ep-gate__act">
          <input type="hidden" name="id" value={v.id} />
          <input type="hidden" name="returnTo" value={here} />
          <input type="hidden" name="gate" value={gates[0]?.value ?? ''} />
          <Button type="submit" size="sm" aria-label={`Let in ${v.number}`}>
            Let in
          </Button>
        </form>
        <form action={refuseVisitor}>
          <input type="hidden" name="id" value={v.id} />
          <input type="hidden" name="returnTo" value={here} />
          <Button type="submit" size="sm" variant="ghost" aria-label={`Do not let in ${v.number}`}>
            Refuse
          </Button>
        </form>
      </div>
    ) : null;
  return (
    <>
      <PageHeader
        kicker="Visitors"
        title="Visitor register"
        description={`${String(list.counts.inside)} visitor passes inside now (${String(list.counts.peopleInside)} people). Appointment visitors checked in at the gate are listed here too.`}
        actions={
          <a className="ep-btn ep-btn--primary ep-btn--sm" href="/engagement/visitors/new">
            Register a visitor
          </a>
        }
      />
      <AppointmentNav current="/engagement/visitors" permissions={me.permissions} />
      {sp.ok && OK[sp.ok] ? (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <Alert tone="success">{OK[sp.ok]}</Alert>
        </div>
      ) : null}
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      {sp.export ? (
        <ExportWatcher
          id={sp.export}
          format="pdf"
          labels={{
            queued: 'PDF requested',
            ready: 'Download',
            pending: 'Preparing the PDF…',
            failed: 'The PDF could not be made',
            stuck: 'Still waiting: the workers service makes the files; check that it is running.',
          }}
        />
      ) : null}
      <nav className="ep-tabs-links" aria-label="Lists" style={{ marginBottom: 'var(--sp-3)' }}>
        {tabs.map(([value, label, n]) => (
          <a
            key={value}
            href={`/engagement/visitors?state=${value}`}
            aria-current={state === value ? 'page' : undefined}
          >
            {label}
            {n === null ? '' : ` · ${String(n)}`}
          </a>
        ))}
      </nav>
      <div className="ep-filter-band">
        <form method="get" className="ep-dlog__filters">
          <input type="hidden" name="state" value={state} />
          <label className="ep-field" htmlFor="vr-from">
            <span className="ep-field__label">From</span>
            <input
              id="vr-from"
              name="from"
              type="date"
              className="ep-input"
              defaultValue={filters.from ?? ''}
            />
          </label>
          <label className="ep-field" htmlFor="vr-to">
            <span className="ep-field__label">To</span>
            <input
              id="vr-to"
              name="to"
              type="date"
              className="ep-input"
              defaultValue={filters.to ?? ''}
            />
          </label>
          <SelectField
            id="vr-type"
            name="type"
            label="Type of visitor"
            defaultValue={filters.type ?? ''}
            options={[
              { value: '', label: 'All' },
              ...options.types.map((x) => ({ value: x, label: x })),
            ]}
          />
          <label className="ep-field ep-dlog__search" htmlFor="vr-q">
            <span className="ep-field__label">
              Pass no. or code, name, mobile, company, vehicle or purpose
            </span>
            <input
              id="vr-q"
              name="q"
              type="search"
              className="ep-input"
              defaultValue={filters.q ?? ''}
              maxLength={80}
            />
          </label>
          <SelectField
            id="vr-size"
            name="size"
            label="Rows per page"
            defaultValue={size}
            options={SIZES.map((v) => ({ value: v, label: v }))}
          />
          <Button type="submit">Show</Button>
        </form>
      </div>
      <Card>
        <div className="ep-hd__listhead">
          <p className="ep-field__help" style={{ margin: 0 }} aria-live="polite">
            {list.page.total
              ? `${String(list.page.total)} ${list.page.total === 1 ? 'visitor' : 'visitors'} · latest first`
              : 'No visitors for these filters.'}
          </p>
          {list.page.total ? (
            <span className="ep-cdash__export">
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/api/visitors/report?${new URLSearchParams(filters).toString()}`}
                download
              >
                Excel
              </a>
              <form action={exportVisitorsPdf}>
                {Object.entries(filters).map(([k, v]) => (
                  <input key={k} type="hidden" name={k} value={v} />
                ))}
                <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                  PDF
                </button>
              </form>
            </span>
          ) : null}
        </div>
        {list.data.length ? (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Visitors">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Visitors</caption>
              <thead>
                <tr>
                  <th scope="col">Pass</th>
                  <th scope="col">Visitor</th>
                  <th scope="col">To meet</th>
                  <th scope="col">Carrying</th>
                  <th scope="col">In</th>
                  <th scope="col">Out</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="ep-sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <a
                        href={`/engagement/visitors/${v.id}/card`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Visitor card ${v.number}`}
                      >
                        {v.number}
                      </a>
                      <div className="ep-field__help">{VISITOR_SOURCE[v.source]}</div>
                    </td>
                    <td>
                      {v.hasPhoto ? (
                        <img
                          className="ep-appt__thumb"
                          src={`/api/visitors/${v.id}/photo`}
                          alt={`Photo of ${v.visitorName}`}
                        />
                      ) : null}
                      {v.visitorName}
                      {v.partySize > 1 ? ` + ${String(v.partySize - 1)}` : ''}
                      <div className="ep-field__help">
                        {[
                          v.visitorType,
                          v.organisation,
                          v.mobile,
                          v.idProofKind
                            ? `${v.idProofKind}${v.idProofLast4 ? ` …${v.idProofLast4}` : ''}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </td>
                    <td>
                      {v.toMeet ?? '—'}
                      <div className="ep-field__help">{v.purpose}</div>
                    </td>
                    <td>
                      {v.equipment ?? '—'}
                      {v.vehicleNo ? <div className="ep-field__help">{v.vehicleNo}</div> : null}
                    </td>
                    <td>
                      {v.inAt ? (state === 'inside' ? timeOf(v.inAt) : when(v.inAt)) : '—'}
                      {v.gate ? <div className="ep-field__help">{v.gate}</div> : null}
                    </td>
                    <td>
                      {v.outAt ? when(v.outAt) : '—'}
                      {v.exitNote ? <div className="ep-field__help">{v.exitNote}</div> : null}
                    </td>
                    <td>
                      <Badge tone={VISITOR_TONE[v.state]}>{VISITOR_STATE[v.state]}</Badge>
                    </td>
                    <td>{action(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {pages > 1 ? (
          <nav className="ep-grid__pager ep-dlog__pager" aria-label="Pages">
            {page > 1 ? (
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={`?${qs({ page: String(page - 1) })}`}
              >
                ← Previous
              </a>
            ) : null}
            <span>
              Page {page} of {pages}
            </span>
            {page < pages ? (
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={`?${qs({ page: String(page + 1) })}`}
              >
                Next →
              </a>
            ) : null}
          </nav>
        ) : null}
      </Card>
    </>
  );
}
