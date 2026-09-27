import { Badge, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

interface Child {
  id: string;
  name: string;
  section: string | null;
  month: string;
  days: Array<{ date: string; code: string; inAt: string | null; outAt: string | null }>;
  summary: { days: number; present: number; absent: number };
}
const LABEL: Record<string, [string, 'success' | 'danger' | 'warning' | 'neutral' | 'info']> = {
  P: ['Present', 'success'],
  A: ['Absent', 'danger'],
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
  // Sprint 12: a previous session (chosen on the home page) opens on its last month, not on today's
  let yearHint = '';
  let defaultMonth: string | undefined;
  if (!sp.month) {
    try {
      const me = await bff.api.me();
      const y = me.academicYears?.find((x) => x.id === me.academicYear?.id);
      if (y && y.status !== 'active') {
        defaultMonth = y.endDate.slice(0, 7);
        yearHint = ` · Session ${y.code} (read-only)`;
      }
    } catch {
      /* the fetch below reports session problems */
    }
  }
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
          <PageHeader kicker="EduPro" title="Attendance" />
          <Card>
            Your account is not linked to a student yet. Please contact the school office.
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
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker="Attendance"
        title={title}
        description={`${data.children.length} ${data.children.length === 1 ? 'child' : 'children'}${yearHint}`}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={`/attendance?month=${shift(month, -1)}`}
            >
              ‹ Previous
            </a>
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={`/attendance?month=${shift(month, 1)}`}
            >
              Next ›
            </a>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
              Home
            </a>
          </span>
        }
      />
      {data.children.map((c) => {
        const pct = c.summary.days ? Math.round((c.summary.present / c.summary.days) * 100) : null;
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
                  ? 'No school days yet'
                  : `${pct}% · ${c.summary.present}/${c.summary.days} days`}
              </Badge>
            }
            style={{ marginBottom: 'var(--sp-3)' }}
          >
            {c.days.length === 0 ? (
              <p className="ep-field__help">No attendance marked in this month.</p>
            ) : (
              <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Status</th>
                    <th>In</th>
                    <th>Out</th>
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
                          <Badge tone={tone}>{label}</Badge>
                        </td>
                        <td>{time(d.inAt)}</td>
                        <td>{time(d.outAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>
        );
      })}
    </main>
  );
}
