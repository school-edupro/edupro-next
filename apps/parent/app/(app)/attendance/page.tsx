import { Badge, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { ChildSwitch } from '@/components/ChildSwitch';
import { chosenChild } from '@/lib/child';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';

interface Child {
  id: string;
  name: string;
  section: string | null;
  month: string;
  days: Array<{ date: string; code: string; inAt: string | null; outAt: string | null }>;
  summary: { days: number; present: number; absent: number; leave?: number };
}
interface BusChild {
  id: string;
  days: Array<{ date: string; pick: string | null; drop: string | null; route: string }>;
  summary: { trips: number; onBus: number; notOnBus: number };
}
const BUS: Record<string, [string, 'success' | 'danger' | 'warning' | 'neutral' | 'info']> = {
  P: ['On the bus', 'success'],
  A: ['Not on the bus', 'danger'],
  LV: ['On leave', 'info'],
  GP: ['Gate pass', 'warning'],
  OT: ['Other arrangement', 'neutral'],
};
const LABEL: Record<string, [string, 'success' | 'danger' | 'warning' | 'neutral' | 'info']> = {
  P: ['Present', 'success'],
  A: ['Absent', 'danger'],
  LV: ['On leave', 'info'],
  L: ['Late', 'warning'],
  SR: ['Short leave', 'warning'],
  H: ['Half day', 'warning'],
  OD: ['On duty', 'info'],
  SB: ['Stay back', 'info'],
};
const monthOf = (v?: string) =>
  v && /^\d{4}-\d{2}$/.test(v)
    ? v
    : new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 7);
const shift = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};
const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';

/** S9-08: the month's attendance of every child linked to the guardian, with gate in/out times. */
export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  // Sprint 12: a previous session (chosen on the home page) opens on its last month, not on today's
  let yearHint = '';
  let defaultMonth: string | undefined;
  if (!sp.month) {
    try {
      const me = await bff.api.me();
      const y = me.academicYears?.find((x) => x.id === me.academicYear?.id);
      if (y && y.status !== 'active') {
        defaultMonth = y.endDate.slice(0, 7);
        yearHint = ` · ${t(lang, 'Session')} ${y.code} (${t(lang, 'read-only')})`;
      }
    } catch {
      /* the fetch below reports session problems */
    }
  }
  const kid = await chosenChild();
  const month = monthOf(sp.month ?? defaultMonth);
  let data: { month: string; children: Child[] };
  try {
    data = await bff.api.fetch<{ month: string; children: Child[] }>(
      `/attendance/mine?month=${month}`,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title={t(lang, 'Attendance')} />
          <Card>
            {t(
              lang,
              'Your account is not linked to a student yet. Please contact the school office.',
            )}
          </Card>
        </main>
      );
    throw error;
  }
  const title = new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  // the bus of the same month: morning and afternoon, as the bus teacher marked it
  const bus = await bff.api
    .fetch<{ children: BusChild[] }>(`/attendance/bus-roll/mine?month=${month}`)
    .then((r) => r.children)
    .catch(() => [] as BusChild[]);
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Attendance')}
        title={title}
        description={`${data.children.length} ${data.children.length === 1 ? t(lang, 'child') : t(lang, 'children')}${yearHint}`}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={`/attendance?month=${shift(month, -1)}`}
            >
              ‹ {t(lang, 'Previous')}
            </a>
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={`/attendance?month=${shift(month, 1)}`}
            >
              {t(lang, 'Next')} ›
            </a>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
              {t(lang, 'Home')}
            </a>
          </span>
        }
      />
      <ChildSwitch lang={lang} back="/attendance" />
      {data.children
        .filter((c) => !kid || c.id === kid.id)
        .map((c) => {
          const pct = c.summary.days
            ? Math.round((c.summary.present / c.summary.days) * 100)
            : null;
          return (
            <Card
              key={c.id}
              title={`${c.name}${c.section ? ` · ${c.section}` : ''}`}
              actions={
                <Badge
                  tone={
                    pct === null
                      ? 'neutral'
                      : pct >= 90
                        ? 'success'
                        : pct >= 75
                          ? 'warning'
                          : 'danger'
                  }
                >
                  {pct === null
                    ? t(lang, 'No school days yet')
                    : `${pct}% · ${c.summary.present}/${c.summary.days} ${t(lang, 'days')}${c.summary.leave ? ` · ${String(c.summary.leave)} ${t(lang, 'on leave')}` : ''}`}
                </Badge>
              }
              style={{ marginBottom: 'var(--sp-3)' }}
            >
              {c.days.length === 0 ? (
                <p className="ep-field__help">{t(lang, 'No attendance marked in this month.')}</p>
              ) : (
                <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>{t(lang, 'Date')}</th>
                      <th>{t(lang, 'Status')}</th>
                      <th>{t(lang, 'In')}</th>
                      <th>{t(lang, 'Out')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...c.days].reverse().map((d) => {
                      const [label, tone] = LABEL[d.code] ?? [d.code, 'neutral'];
                      return (
                        <tr key={d.date}>
                          <td>
                            {new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-IN', {
                              weekday: 'short',
                              day: '2-digit',
                              month: 'short',
                              timeZone: 'UTC',
                            })}
                          </td>
                          <td>
                            <Badge tone={tone}>{t(lang, label)}</Badge>
                          </td>
                          <td>{time(d.inAt)}</td>
                          <td>{time(d.outAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {(() => {
                const b = bus.find((x) => x.id === c.id);
                if (!b || b.days.length === 0) return null;
                return (
                  <>
                    <h3 className="ep-cdash__h3" style={{ marginTop: 'var(--sp-4)' }}>
                      {t(lang, 'School bus')} · {b.summary.onBus}/{b.summary.trips}{' '}
                      {t(lang, 'trips on the bus')}
                    </h3>
                    <div
                      className="ep-table-wrap"
                      tabIndex={0}
                      role="region"
                      aria-label={`${t(lang, 'School bus')} · ${c.name}`}
                    >
                      <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
                        <caption className="ep-sr-only">
                          {t(lang, 'School bus')} · {c.name}
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col">{t(lang, 'Date')}</th>
                            <th scope="col">{t(lang, 'Morning')}</th>
                            <th scope="col">{t(lang, 'Afternoon')}</th>
                            <th scope="col">{t(lang, 'Route')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...b.days].reverse().map((d) => (
                            <tr key={d.date}>
                              <td>
                                {new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-IN', {
                                  weekday: 'short',
                                  day: '2-digit',
                                  month: 'short',
                                  timeZone: 'UTC',
                                })}
                              </td>
                              {[d.pick, d.drop].map((code, i) => (
                                <td key={String(i)}>
                                  {code ? (
                                    <Badge tone={BUS[code]?.[1] ?? 'neutral'}>
                                      {t(lang, BUS[code]?.[0] ?? code)}
                                    </Badge>
                                  ) : (
                                    '—'
                                  )}
                                </td>
                              ))}
                              <td>{d.route}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                );
              })()}
            </Card>
          );
        })}
    </main>
  );
}
