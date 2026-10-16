import { Card } from '@edupro/ui';
import { HostelPicker, MessHeader } from '@/components/hostel/MessHeader';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { messFile, messHostels } from '@/lib/mess';

interface Register {
  hostel: { id: string; name: string };
  hostels: Array<{ id: string; name: string }>;
  month: string;
  days: string[];
  meals: Array<{ id: string; name: string; at: string; short: string }>;
  columns: Array<{ day: string; meal: string; marked: boolean; had: number }>;
  rows: Array<{
    studentId: string;
    name: string;
    admissionNo: string;
    cells: string[];
    had: number;
    skipped: number;
    away: number;
  }>;
}
const thisMonth = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 7);
const TONE: Record<string, string> = {
  X: 'var(--status-danger-text)',
  LV: 'var(--status-info-text)',
};
const ROW_HEAD = {
  textTransform: 'none',
  letterSpacing: 'normal',
  whiteSpace: 'nowrap',
  fontWeight: 600,
} as const;

/** Hostel → Mess → Meal register: the month of a hostel, each pupil and each meal of each day. */
export default async function MessRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{
    hostel?: string;
    month?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const { hostel: first } = await messHostels(sp.hostel);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? '') ? sp.month! : thisMonth();
  let reg: Register | null = null;
  let problem = '';
  try {
    reg = await apiFetch<Register>(
      `/hostel/meal-register?month=${month}${first ? `&hostelId=${first.id}` : ''}`,
    );
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    problem = error.status === 403 ? 'You see your own hostel only.' : 'No hostel is set up yet.';
  }
  const many = (reg?.meals.length ?? 0) > 1;
  const dd = (d: string) => d.slice(8);
  return (
    <>
      <MessHeader
        current="register"
        permissions={me.permissions}
        hostelId={reg?.hostel.id}
        sp={sp}
        description="The month of one hostel: who had each meal, who skipped it and who was away on hostel leave. Download it as Excel or PDF."
        actions={
          reg ? (
            <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={messFile('register', { hostelId: reg.hostel.id, month }, 'xlsx')}
              >
                Excel
              </a>
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={messFile('register', { hostelId: reg.hostel.id, month }, 'pdf')}
              >
                PDF
              </a>
            </span>
          ) : undefined
        }
      />
      {!reg ? (
        <Card>{problem}</Card>
      ) : (
        <>
          <HostelPicker hostels={reg.hostels} hostelId={reg.hostel.id}>
            <label className="ep-field" htmlFor="mr-month">
              <span className="ep-field__label">Month</span>
              <input
                id="mr-month"
                name="month"
                type="month"
                className="ep-input"
                defaultValue={month}
                max={thisMonth()}
              />
            </label>
          </HostelPicker>
          <Card title={`${reg.hostel.name} · ${String(reg.rows.length)} boarder(s)`}>
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              {many
                ? `${reg.meals.map((m) => `${m.short} ${m.name} (${m.at})`).join(' · ')} · `
                : ''}
              P had the meal · X skipped · LV away on hostel leave · – not marked · blank: no bed in
              the hostel that day.
            </p>
            {!reg.meals.length ? (
              <p>This hostel serves no meal: tick it on a meal under Mess → Set-up.</p>
            ) : !reg.days.length ? (
              <p>This month has not started yet.</p>
            ) : !reg.rows.length ? (
              <p>Nobody held a bed in this hostel in this month.</p>
            ) : (
              <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Meal register">
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">
                    Meal register of {reg.hostel.name}, {reg.month}
                  </caption>
                  <thead>
                    {many ? (
                      <tr>
                        <th scope="col">
                          <span className="ep-sr-only">Pupil</span>
                        </th>
                        {reg.days.map((d) => (
                          <th
                            key={d}
                            scope="colgroup"
                            colSpan={reg!.meals.length}
                            style={{ textAlign: 'center' }}
                          >
                            {dd(d)}
                          </th>
                        ))}
                        <th scope="col" colSpan={3}>
                          <span className="ep-sr-only">Totals</span>
                        </th>
                      </tr>
                    ) : null}
                    <tr>
                      <th scope="col">Pupil</th>
                      {reg.columns.map((c, i) => (
                        <th
                          key={`${c.day}-${c.meal}`}
                          scope="col"
                          style={{ textAlign: 'center' }}
                          title={`${c.day} · ${reg!.meals[i % reg!.meals.length]!.name}`}
                        >
                          {many ? reg!.meals[i % reg!.meals.length]!.short : dd(c.day)}
                        </th>
                      ))}
                      <th scope="col" className="ep-num">
                        Had
                      </th>
                      <th scope="col" className="ep-num">
                        Skipped
                      </th>
                      <th scope="col" className="ep-num">
                        Away
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {reg.rows.map((r) => (
                      <tr key={r.studentId}>
                        <th scope="row" style={ROW_HEAD}>
                          {r.name}
                          <div className="ep-field__help">{r.admissionNo}</div>
                        </th>
                        {r.cells.map((x, i) => (
                          <td
                            key={reg!.columns[i]!.day + reg!.columns[i]!.meal}
                            style={{
                              textAlign: 'center',
                              color: TONE[x],
                              fontWeight: TONE[x] ? 600 : undefined,
                            }}
                          >
                            {x === '-' ? '–' : x}
                          </td>
                        ))}
                        <td className="ep-num">{r.had}</td>
                        <td className="ep-num">{r.skipped}</td>
                        <td className="ep-num">{r.away}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row" style={ROW_HEAD}>
                        Had the meal
                      </th>
                      {reg.columns.map((c) => (
                        <td key={`${c.day}-${c.meal}`} style={{ textAlign: 'center' }}>
                          {c.marked ? c.had : '–'}
                        </td>
                      ))}
                      <td className="ep-num">{reg.rows.reduce((n, r) => n + r.had, 0)}</td>
                      <td className="ep-num">{reg.rows.reduce((n, r) => n + r.skipped, 0)}</td>
                      <td className="ep-num">{reg.rows.reduce((n, r) => n + r.away, 0)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
