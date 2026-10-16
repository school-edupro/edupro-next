import { Card, PageHeader } from '@edupro/ui';
import { HostelNav } from '@/components/hostel/HostelNav';
import { RollcallTabs } from '@/components/hostel/RollcallTabs';
import { ApiError, apiFetch, getMe } from '@/lib/api';

interface Register {
  hostel: { id: string; name: string };
  hostels: Array<{ id: string; name: string }>;
  month: string;
  days: string[];
  sessions: Array<{ id: string; name: string; at: string; short: string }>;
  columns: Array<{ day: string; session: string; taken: boolean; present: number }>;
  rows: Array<{
    studentId: string;
    name: string;
    admissionNo: string;
    section: string;
    bed: string;
    cells: string[];
    present: number;
    absent: number;
    leave: number;
    sick: number;
    percent: number | null;
  }>;
}

const thisMonth = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 7);
/** A pupil's name as a row head: as read, not as a column heading. */
const ROW_HEAD = {
  textTransform: 'none',
  letterSpacing: 'normal',
  whiteSpace: 'nowrap',
  fontWeight: 600,
} as const;
const TONE: Record<string, string> = {
  A: 'var(--status-danger-text)',
  LV: 'var(--status-info-text)',
  S: 'var(--status-warning-text)',
};

/**
 * The hostel roll-call register of a month: the boarders down, each day a column per session (M morning,
 * N night ...), the mark of each roll, and each pupil's totals; as Excel or PDF. A warden sees their own
 * hostel only.
 */
export default async function HostelRollcallRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ hostel?: string; month?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? '') ? sp.month! : thisMonth();
  const hostelId = /^\d{1,18}$/.test(sp.hostel ?? '') ? sp.hostel! : '';
  let reg: Register | null = null;
  let problem = '';
  try {
    reg = await apiFetch<Register>(
      `/hostel/rollcall/register?month=${month}${hostelId ? `&hostelId=${hostelId}` : ''}`,
    );
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    problem =
      error.status === 403
        ? 'You see the register of your own hostel only.'
        : error.status === 404
          ? 'No hostel is set up yet.'
          : 'The register could not be read.';
  }
  const many = (reg?.sessions.length ?? 0) > 1;
  const file = (format: 'xlsx' | 'pdf') =>
    `/api/hostel/rollcall-register?month=${month}&format=${format}${reg ? `&hostel=${reg.hostel.id}` : ''}`;
  const dd = (d: string) => d.slice(8);
  return (
    <>
      <PageHeader
        kicker="Hostel"
        title="Roll-call register"
        description="The month's roll-calls of one hostel: every boarder, each day with a column per session (morning, evening, night), the totals and the present per cent. Download it as Excel or PDF."
        actions={
          reg ? (
            <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('xlsx')}>
                Excel
              </a>
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('pdf')}>
                PDF
              </a>
            </span>
          ) : undefined
        }
      />
      <HostelNav current="/hostel/rollcall" permissions={me.permissions} />
      <RollcallTabs current="register" />
      <div className="ep-filter-band" style={{ marginBottom: 'var(--sp-4)' }}>
        <form method="get" className="ep-dlog__filters">
          <label className="ep-field" htmlFor="rg-hostel">
            <span className="ep-field__label">Hostel</span>
            <select
              id="rg-hostel"
              name="hostel"
              className="ep-select"
              defaultValue={reg?.hostel.id ?? hostelId}
            >
              {(reg?.hostels ?? []).map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" htmlFor="rg-month">
            <span className="ep-field__label">Month</span>
            <input
              id="rg-month"
              name="month"
              type="month"
              className="ep-input"
              defaultValue={month}
              max={thisMonth()}
            />
          </label>
          <button type="submit" className="ep-btn ep-btn--secondary">
            Show
          </button>
        </form>
      </div>
      {!reg ? (
        <Card>
          <p>{problem}</p>
        </Card>
      ) : (
        <Card
          title={`${reg.hostel.name} · ${new Date(`${reg.month}-01T00:00:00Z`).toLocaleDateString(
            'en-IN',
            { month: 'long', year: 'numeric', timeZone: 'UTC' },
          )} · ${String(reg.rows.length)} boarder(s)`}
        >
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            {many
              ? `${reg.sessions.map((s) => `${s.short} ${s.name} (${s.at})`).join(' · ')} · `
              : ''}
            P present · A absent · LV on leave · S sick · – not marked · blank: no bed in the hostel
            that day. The present per cent leaves leave out.
          </p>
          {!reg.sessions.length ? (
            <p>
              This hostel has no roll-call sessions. Add them under Hostel → Set-up → Roll-call and
              leave rules.
            </p>
          ) : !reg.days.length ? (
            <p>This month has not started yet.</p>
          ) : !reg.rows.length ? (
            <p>Nobody held a bed in this hostel in this month.</p>
          ) : (
            <div
              className="ep-table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Roll-call register"
            >
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">
                  Roll-call register of {reg.hostel.name}, {reg.month}
                </caption>
                <thead>
                  {many ? (
                    <tr>
                      <th scope="col" colSpan={2}>
                        <span className="ep-sr-only">Pupil</span>
                      </th>
                      {reg.days.map((d) => (
                        <th
                          key={d}
                          scope="colgroup"
                          colSpan={reg.sessions.length}
                          className="ep-num"
                          style={{ textAlign: 'center' }}
                        >
                          {dd(d)}
                        </th>
                      ))}
                      <th scope="col" colSpan={5}>
                        <span className="ep-sr-only">Totals</span>
                      </th>
                    </tr>
                  ) : null}
                  <tr>
                    <th scope="col">Pupil</th>
                    <th scope="col">Room/bed</th>
                    {reg.columns.map((c, i) => (
                      <th
                        key={`${c.day}-${c.session}`}
                        scope="col"
                        className="ep-num"
                        style={{ textAlign: 'center' }}
                        title={`${c.day} · ${reg.sessions[i % reg.sessions.length]!.name}`}
                      >
                        {many ? reg.sessions[i % reg.sessions.length]!.short : dd(c.day)}
                      </th>
                    ))}
                    <th scope="col" className="ep-num">
                      P
                    </th>
                    <th scope="col" className="ep-num">
                      A
                    </th>
                    <th scope="col" className="ep-num">
                      LV
                    </th>
                    <th scope="col" className="ep-num">
                      S
                    </th>
                    <th scope="col" className="ep-num">
                      % present
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {reg.rows.map((r) => (
                    <tr key={r.studentId}>
                      <th scope="row" style={ROW_HEAD}>
                        {r.name}
                        <div className="ep-field__help">
                          {[r.admissionNo, r.section].filter(Boolean).join(' · ')}
                        </div>
                      </th>
                      <td>{r.bed || '—'}</td>
                      {r.cells.map((x, i) => (
                        <td
                          key={reg.columns[i]!.day + reg.columns[i]!.session}
                          className="ep-num"
                          style={{
                            textAlign: 'center',
                            color: TONE[x],
                            fontWeight: TONE[x] ? 600 : undefined,
                          }}
                        >
                          {x === '-' ? '–' : x}
                        </td>
                      ))}
                      <td className="ep-num">{r.present}</td>
                      <td className="ep-num">{r.absent}</td>
                      <td className="ep-num">{r.leave}</td>
                      <td className="ep-num">{r.sick}</td>
                      <td className="ep-num">{r.percent === null ? '–' : r.percent.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={2} style={ROW_HEAD}>
                      Present
                    </th>
                    {reg.columns.map((c) => (
                      <td
                        key={`${c.day}-${c.session}`}
                        className="ep-num"
                        style={{ textAlign: 'center' }}
                      >
                        {c.taken ? c.present : '–'}
                      </td>
                    ))}
                    <td className="ep-num">{reg.rows.reduce((n, r) => n + r.present, 0)}</td>
                    <td className="ep-num">{reg.rows.reduce((n, r) => n + r.absent, 0)}</td>
                    <td className="ep-num">{reg.rows.reduce((n, r) => n + r.leave, 0)}</td>
                    <td className="ep-num">{reg.rows.reduce((n, r) => n + r.sick, 0)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
