import { Badge, Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { GatePassNav } from '@/components/gate-passes/GatePassNav';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { when } from '@/lib/appointments';
import {
  KIND_LABEL,
  STATE_TONE,
  approvalLine,
  escortLine,
  type GatePass,
  type PassCounts,
} from '@/lib/gate-passes';

interface PassList {
  data: GatePass[];
  page: { number: number; size: number; total: number };
  counts: PassCounts;
}
const STAGES = ['approval', 'handover', 'gate', 'out', 'closed', 'today', 'all'] as const;
type Stage = (typeof STAGES)[number];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The front desk's gate pass register: what waits for approval (with where each approval stands), what
 * is approved and waits for hand-over, what is at the gate, who is out and due back, and what is closed.
 * Pupils and staff are together; filters, pages and Excel.
 */
export default async function GatePassRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{
    stage?: string;
    audience?: string;
    from?: string;
    to?: string;
    q?: string;
    page?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const stage: Stage = STAGES.includes(sp.stage as Stage) ? (sp.stage as Stage) : 'approval';
  const page = Math.max(1, Number(sp.page) || 1);
  const filters = Object.fromEntries(
    Object.entries({
      stage,
      audience: ['student', 'staff'].includes(sp.audience ?? '') ? sp.audience : undefined,
      from: DATE.test(sp.from ?? '') ? sp.from : undefined,
      to: DATE.test(sp.to ?? '') ? sp.to : undefined,
      q: sp.q?.trim().slice(0, 80) || undefined,
    }).filter(([, v]) => v),
  ) as Record<string, string>;
  const qs = (extra: Record<string, string> = {}) =>
    new URLSearchParams({ ...filters, ...extra }).toString();
  const [me, list] = await Promise.all([
    getMe(),
    apiFetch<PassList>(`/gate-passes?${qs({ page: String(page) })}`),
  ]);
  const pages = Math.max(1, Math.ceil(list.page.total / list.page.size));
  const tabs: Array<[Stage, string, number | null]> = [
    ['approval', 'Waiting for approval', list.counts.approval],
    ['handover', 'To hand over', list.counts.handover],
    ['gate', 'At the gate', list.counts.gate],
    ['out', 'Out, to come back', list.counts.out],
    ['today', 'Today', list.counts.today],
    ['closed', 'Closed', null],
    ['all', 'Everything', null],
  ];
  const filtered = Object.keys(filters).length > 1;
  return (
    <>
      <PageHeader
        kicker="Gate passes"
        title="Gate pass register"
        description="Pupils leaving early or arriving late, and staff going out (RGP / NRGP). Every pass shows where its approval stands."
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/api/gate-passes/report?${qs()}`}
            >
              Excel
            </a>
            {me.permissions.includes('engagement.gate_pass.issue') ? (
              <a className="ep-btn ep-btn--primary ep-btn--sm" href="/engagement/gate-passes/new">
                New pupil pass
              </a>
            ) : null}
          </span>
        }
      />
      <GatePassNav current="/engagement/gate-passes" permissions={me.permissions} ok={sp.ok} />
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      <nav className="ep-tabs-links" aria-label="Lists" style={{ marginBottom: 'var(--sp-3)' }}>
        {tabs.map(([value, label, n]) => (
          <a
            key={value}
            href={`/engagement/gate-passes?stage=${value}`}
            aria-current={stage === value ? 'page' : undefined}
          >
            {label}
            {n === null ? '' : ` · ${String(n)}`}
          </a>
        ))}
      </nav>
      <div className="ep-filter-band">
        <form method="get" className="ep-dlog__filters">
          <input type="hidden" name="stage" value={stage} />
          <SelectField
            id="gp-aud"
            name="audience"
            label="For"
            defaultValue={filters.audience ?? ''}
            options={[
              { value: '', label: 'Pupils and staff' },
              { value: 'student', label: 'Pupils' },
              { value: 'staff', label: 'Staff' },
            ]}
          />
          <label className="ep-field" htmlFor="gp-from">
            <span className="ep-field__label">From</span>
            <input
              id="gp-from"
              name="from"
              type="date"
              className="ep-input"
              defaultValue={filters.from ?? ''}
            />
          </label>
          <label className="ep-field" htmlFor="gp-to">
            <span className="ep-field__label">To</span>
            <input
              id="gp-to"
              name="to"
              type="date"
              className="ep-input"
              defaultValue={filters.to ?? ''}
            />
          </label>
          <InputField
            id="gp-q"
            name="q"
            type="search"
            label="Pass no., name, admission no., employee code or reason"
            defaultValue={filters.q ?? ''}
            maxLength={80}
          />
          <Button type="submit">Show</Button>
          {filtered ? (
            <a className="ep-btn ep-btn--secondary" href={`/engagement/gate-passes?stage=${stage}`}>
              Clear
            </a>
          ) : null}
        </form>
      </div>
      <Card>
        {list.data.length === 0 ? (
          <p className="ep-field__help" style={{ margin: 0 }}>
            {filtered ? 'Nothing matches these filters.' : 'Nothing here.'}
          </p>
        ) : (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Gate passes">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Gate passes, latest first</caption>
              <thead>
                <tr>
                  <th scope="col">Pass</th>
                  <th scope="col">For</th>
                  <th scope="col">When</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Approval</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="ep-sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.number}
                      <div className="ep-field__help">{KIND_LABEL[p.kind]}</div>
                    </td>
                    <td>
                      {p.student ?? p.employee}
                      <div className="ep-field__help">
                        {p.audience === 'student'
                          ? [p.section, p.admissionNo ? `Adm. no. ${p.admissionNo}` : null]
                              .filter(Boolean)
                              .join(' · ')
                          : [p.employeeCode, p.designation].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td>
                      {p.onDate}
                      <div className="ep-field__help">
                        {[p.atTime, p.returnBy ? `back by ${when(p.returnBy)}` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </td>
                    <td>
                      {p.reason}
                      <div className="ep-field__help">
                        {[
                          escortLine(p) ? `With ${escortLine(p)!}` : null,
                          p.destination,
                          p.items ? `${String(p.items)} item(s)` : null,
                          p.itemsDue && p.state !== 'pending' && p.state !== 'approved'
                            ? `${String(p.itemsDue)} not back`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </td>
                    <td>{approvalLine(p)}</td>
                    <td>
                      <Badge tone={STATE_TONE[p.state]}>{p.stage}</Badge>
                    </td>
                    <td>
                      <a
                        className="ep-btn ep-btn--secondary ep-btn--sm"
                        href={`/engagement/gate-passes/${p.id}`}
                        aria-label={`Open ${p.number}`}
                      >
                        {p.state === 'approved' &&
                        p.audience === 'student' &&
                        p.kind === 'early_leave'
                          ? 'Hand over'
                          : 'Open'}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {pages > 1 ? (
        <nav
          aria-label="Pages"
          style={{
            display: 'flex',
            gap: 'var(--sp-3)',
            alignItems: 'center',
            marginTop: 'var(--sp-3)',
          }}
        >
          {page > 1 ? (
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`?${qs({ page: String(page - 1) })}`}
            >
              ← Previous
            </a>
          ) : null}
          <span className="ep-field__help">
            Page {page} of {pages} · {String(list.page.total)} in all
          </span>
          {page < pages ? (
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`?${qs({ page: String(page + 1) })}`}
            >
              Next →
            </a>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
