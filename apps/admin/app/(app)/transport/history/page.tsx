import { Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { PeriodTable } from '@/components/transport/PeriodTable';
import { TransportNav } from '@/components/transport/TransportNav';
import { apiFetch, getMe } from '@/lib/api';
import { monthLabel, type TransportPeriod } from '@/lib/transport-desk';

interface History {
  data: TransportPeriod[];
  page: { number: number; size: number; total: number };
  routes: Array<{ id: string; name: string }>;
  months: string[];
}
const WHEN = ['now', 'upcoming', 'past', 'all'] as const;
type When = (typeof WHEN)[number];

/**
 * Student transport history: every stretch of months a pupil rode this session, how (pick, drop or
 * both), from which stoppage, at which slab and charge, who approved it and what ended it. By month,
 * route, service or pupil; Excel.
 */
export default async function TransportHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    when?: string;
    month?: string;
    routeId?: string;
    service?: string;
    studentId?: string;
    q?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const whenTab: When = WHEN.includes(sp.when as When) ? (sp.when as When) : 'now';
  const page = Math.max(1, Number(sp.page) || 1);
  const filters = Object.fromEntries(
    Object.entries({
      when: whenTab,
      month: /^\d{4}-\d{2}$/.test(sp.month ?? '') ? sp.month : undefined,
      routeId: /^\d+$/.test(sp.routeId ?? '') ? sp.routeId : undefined,
      service: ['pick', 'drop', 'both'].includes(sp.service ?? '') ? sp.service : undefined,
      studentId: /^\d+$/.test(sp.studentId ?? '') ? sp.studentId : undefined,
      q: sp.q?.trim().slice(0, 80) || undefined,
    }).filter(([, v]) => v),
  ) as Record<string, string>;
  const qs = (extra: Record<string, string> = {}) =>
    new URLSearchParams({ ...filters, ...extra }).toString();
  const [me, h] = await Promise.all([
    getMe(),
    apiFetch<History>(`/transport/desk/history?${qs({ page: String(page) })}`),
  ]);
  const pages = Math.max(1, Math.ceil(h.page.total / h.page.size));
  const one = filters.studentId ? (h.data[0] ?? null) : null;
  const filtered = Object.keys(filters).length > 1;
  const tabs: Array<[When, string]> = [
    ['now', 'Riding this month'],
    ['upcoming', 'To start'],
    ['past', 'Over or cancelled'],
    ['all', 'Everything'],
  ];
  return (
    <>
      <PageHeader
        kicker="Transport"
        title={one ? `Transport history · ${one.student}` : 'Student transport history'}
        description={
          one
            ? [one.section, one.admissionNo ? `Adm. no. ${one.admissionNo}` : null]
                .filter(Boolean)
                .join(' · ')
            : 'Who rides, how and from where, month by month. A change or a withdrawal closes one period and opens the next.'
        }
        actions={
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href={`/api/transport/history?${qs()}`}
          >
            Excel
          </a>
        }
      />
      <TransportNav current="/transport/history" permissions={me.permissions} />
      <nav className="ep-tabs-links" aria-label="Lists" style={{ marginBottom: 'var(--sp-3)' }}>
        {tabs.map(([value, label]) => (
          <a
            key={value}
            href={`/transport/history?${new URLSearchParams({ when: value, ...(filters.studentId ? { studentId: filters.studentId } : {}) }).toString()}`}
            aria-current={whenTab === value && !filters.month ? 'page' : undefined}
          >
            {label}
          </a>
        ))}
      </nav>
      <div className="ep-filter-band">
        <form method="get" className="ep-dlog__filters">
          <input type="hidden" name="when" value={whenTab} />
          {filters.studentId ? (
            <input type="hidden" name="studentId" value={filters.studentId} />
          ) : null}
          <SelectField
            id="th-month"
            name="month"
            label="Riding in the month"
            defaultValue={filters.month ?? ''}
            options={[
              { value: '', label: 'As the list above' },
              ...h.months.map((m) => ({ value: m, label: monthLabel(m) })),
            ]}
          />
          <SelectField
            id="th-route"
            name="routeId"
            label="Route"
            defaultValue={filters.routeId ?? ''}
            options={[
              { value: '', label: 'All routes' },
              ...h.routes.map((r) => ({ value: r.id, label: r.name })),
            ]}
          />
          <SelectField
            id="th-service"
            name="service"
            label="Service"
            defaultValue={filters.service ?? ''}
            options={[
              { value: '', label: 'All services' },
              { value: 'both', label: 'Pick and drop' },
              { value: 'pick', label: 'Pick only' },
              { value: 'drop', label: 'Drop only' },
            ]}
          />
          {filters.studentId ? null : (
            <InputField
              id="th-q"
              name="q"
              type="search"
              label="Student name or admission no."
              defaultValue={filters.q ?? ''}
              maxLength={80}
            />
          )}
          <Button type="submit">Show</Button>
          {filtered ? (
            <a className="ep-btn ep-btn--secondary" href="/transport/history">
              Clear
            </a>
          ) : null}
        </form>
      </div>
      <Card>
        {h.data.length === 0 ? (
          <p className="ep-field__help" style={{ margin: 0 }}>
            {filtered ? 'Nothing matches these filters.' : 'No pupil rides this month.'}
          </p>
        ) : (
          <PeriodTable
            periods={h.data}
            caption="Student transport history"
            withStudent={!filters.studentId}
          />
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
            Page {page} of {pages} · {String(h.page.total)} in all
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
