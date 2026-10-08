import { Alert, Badge, Button, Card, KpiTile, PageHeader, SelectField } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { carryAll, carrySelected, undoCarry } from '@/lib/fee-setup-actions';

interface Row {
  studentId: string;
  name: string;
  admissionNo: string;
  section: string | null;
  dueSchool: string;
  dueHostel: string;
  lateFee: string;
  advance: string;
  net: string;
  enrolled: boolean;
  carried: boolean;
}
interface Preview {
  from: { id: string; name: string };
  to: { id: string; name: string };
  asOf: string;
  ready: boolean;
  blocked: string | null;
  rows: Row[];
  totals: { students: number; due: string; late: string; advance: string; pending: number };
  runs: Array<{
    id: string;
    ranAt: string;
    ranBy: string | null;
    students: number;
    due: string;
    late: string;
    advance: string;
  }>;
}

const money = (v: string | number) =>
  `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
};

/**
 * Year-end carry-forward: every pupil's unpaid fee, unpaid late fine and advance of the closing year,
 * carried to the new year after the accountant has looked at the list.
 */
export default async function FeeCarryForwardPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    from?: string;
    to?: string;
    carried?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const years = [...me.academicYears].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const working = years.find((y) => y.id === me.academicYear?.id) ?? years[years.length - 1];
  const after = (id?: string) => {
    const i = years.findIndex((y) => y.id === id);
    return i >= 0 ? years[i + 1] : undefined;
  };
  const before = (id?: string) => {
    const i = years.findIndex((y) => y.id === id);
    return i > 0 ? years[i - 1] : undefined;
  };
  // by default: the working year receives the balance of the year before it
  const to =
    years.find((y) => y.id === sp.to) ?? (before(working?.id) ? working : after(working?.id));
  const from = years.find((y) => y.id === sp.from) ?? before(to?.id) ?? working;
  let preview: Preview | null = null;
  let problem: string | null = null;
  if (from && to && from.id !== to.id) {
    try {
      preview = (
        await apiFetch<{ data: Preview }>(
          `/fees/carry-forward?toYearId=${to.id}&fromYearId=${from.id}`,
        )
      ).data;
    } catch (error) {
      problem =
        error instanceof ApiError && typeof error.problem.detail === 'string'
          ? error.problem.detail
          : 'The list could not be loaded.';
    }
  }
  const open = preview?.rows.filter((r) => r.enrolled && !r.carried) ?? [];
  const yearOptions = years.map((y) => ({ value: y.id, label: y.name }));
  return (
    <>
      <PageHeader
        kicker="Fees"
        title="Carry forward to the new year"
        description="Unpaid fee, unpaid late fine and excess paid in the closing year open the new year as Previous dues, Previous late fine and Advance. Check the list, then carry."
      />
      <Notice params={sp} />
      {sp.carried ? (
        <Alert tone="success">{sp.carried} pupil(s) carried to the new year.</Alert>
      ) : null}
      <Card>
        <form
          method="get"
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <SelectField
            id="from"
            name="from"
            label="Closing year"
            defaultValue={from?.id ?? ''}
            options={yearOptions}
          />
          <SelectField
            id="to"
            name="to"
            label="New year"
            defaultValue={to?.id ?? ''}
            options={yearOptions}
          />
          <Button type="submit" variant="secondary">
            Show
          </Button>
        </form>
        {years.length < 2 ? (
          <p className="ep-field__help">
            Only one year is open. Open the new year under System → Years first; it then appears
            here.
          </p>
        ) : null}
        {problem ? <Alert tone="danger">{problem}</Alert> : null}
        {preview?.blocked ? <Alert tone="warning">{preview.blocked}</Alert> : null}
      </Card>
      {preview ? (
        <>
          <div
            style={{
              display: 'grid',
              gap: 'var(--sp-4)',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
              margin: 'var(--sp-5) 0',
            }}
          >
            <KpiTile label="Pupils to carry" value={preview.totals.students} />
            <KpiTile label="Previous dues" value={money(preview.totals.due)} />
            <KpiTile label="Previous late fine" value={money(preview.totals.late)} />
            <KpiTile label="Advance" value={money(preview.totals.advance)} />
            <KpiTile
              label="No class in the new year"
              value={preview.totals.pending}
              hint="Left or not promoted yet: not carried"
            />
          </div>
          <Card title={`${preview.from.name} → ${preview.to.name}`}>
            <p className="ep-field__help">
              Late fine is worked out as on {date(preview.asOf)}. The old year’s unpaid bills are
              closed as “carried”, so they are not counted twice. If the new year already has an
              opening balance typed for a pupil, the carry replaces it. A carry can be undone until
              a receipt is posted against it.
            </p>
            <form>
              <input type="hidden" name="fromYearId" value={preview.from.id} />
              <input type="hidden" name="toYearId" value={preview.to.id} />
              <div className="ep-table-wrap">
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">Balances to carry forward</caption>
                  <thead>
                    <tr>
                      <th scope="col">Carry</th>
                      <th scope="col">Pupil</th>
                      <th scope="col">Adm. no.</th>
                      <th scope="col">Class</th>
                      <th scope="col" style={{ textAlign: 'right' }}>
                        Previous dues
                      </th>
                      <th scope="col" style={{ textAlign: 'right' }}>
                        Hostel dues
                      </th>
                      <th scope="col" style={{ textAlign: 'right' }}>
                        Late fine
                      </th>
                      <th scope="col" style={{ textAlign: 'right' }}>
                        Advance
                      </th>
                      <th scope="col" style={{ textAlign: 'right' }}>
                        Opens with
                      </th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.length === 0 ? (
                      <tr>
                        <td colSpan={10}>Nobody has a balance to carry.</td>
                      </tr>
                    ) : null}
                    {preview.rows.map((r) => (
                      <tr key={r.studentId}>
                        <td>
                          {r.enrolled && !r.carried ? (
                            <input
                              type="checkbox"
                              name="studentIds"
                              value={r.studentId}
                              defaultChecked
                              aria-label={`Carry ${r.name}`}
                            />
                          ) : null}
                        </td>
                        <td>
                          <a href={`/fees/ledger/${r.studentId}`}>{r.name}</a>
                        </td>
                        <td>{r.admissionNo}</td>
                        <td>{r.section ?? '—'}</td>
                        <td style={{ textAlign: 'right' }}>{money(r.dueSchool)}</td>
                        <td style={{ textAlign: 'right' }}>{money(r.dueHostel)}</td>
                        <td style={{ textAlign: 'right' }}>{money(r.lateFee)}</td>
                        <td style={{ textAlign: 'right' }}>{money(r.advance)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <strong>{money(r.net)}</strong>
                        </td>
                        <td>
                          {r.carried ? (
                            <span
                              style={{
                                display: 'inline-flex',
                                gap: 'var(--sp-2)',
                                alignItems: 'center',
                              }}
                            >
                              <Badge tone="success">Carried</Badge>
                              <Button
                                type="submit"
                                variant="ghost"
                                size="sm"
                                formAction={undoCarry}
                                name="studentId"
                                value={r.studentId}
                              >
                                Undo
                              </Button>
                            </span>
                          ) : r.enrolled ? (
                            <Badge tone="warning">To carry</Badge>
                          ) : (
                            <Badge tone="neutral">No class in new year</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.ready && open.length > 0 ? (
                <div style={{ display: 'flex', gap: 'var(--sp-3)', marginTop: 'var(--sp-4)' }}>
                  <Button type="submit" formAction={carrySelected}>
                    Carry the ticked pupils
                  </Button>
                  <Button type="submit" variant="secondary" formAction={carryAll}>
                    Carry all {open.length}
                  </Button>
                </div>
              ) : null}
            </form>
          </Card>
          {preview.runs.length > 0 ? (
            <Card title="Earlier runs">
              <div className="ep-table-wrap">
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">Carry-forward runs</caption>
                  <thead>
                    <tr>
                      <th scope="col">Date and time</th>
                      <th scope="col">By</th>
                      <th scope="col" style={{ textAlign: 'right' }}>
                        Pupils
                      </th>
                      <th scope="col" style={{ textAlign: 'right' }}>
                        Dues
                      </th>
                      <th scope="col" style={{ textAlign: 'right' }}>
                        Late fine
                      </th>
                      <th scope="col" style={{ textAlign: 'right' }}>
                        Advance
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.runs.map((r) => (
                      <tr key={r.id}>
                        <td>
                          {new Date(r.ranAt).toLocaleString('en-IN', {
                            timeZone: 'Asia/Kolkata',
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </td>
                        <td>{r.ranBy ?? '—'}</td>
                        <td style={{ textAlign: 'right' }}>{r.students}</td>
                        <td style={{ textAlign: 'right' }}>{money(r.due)}</td>
                        <td style={{ textAlign: 'right' }}>{money(r.late)}</td>
                        <td style={{ textAlign: 'right' }}>{money(r.advance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}
        </>
      ) : null}
    </>
  );
}
