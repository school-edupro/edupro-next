import { Alert, Button, Card, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { PeriodTable } from '@/components/transport/PeriodTable';
import { RideForm } from '@/components/transport/RideForm';
import { TransportNav } from '@/components/transport/TransportNav';
import { apiFetch, getMe } from '@/lib/api';
import { applyTransport, importTransportRequests } from '@/lib/transport-desk-actions';
import type { RideOptions } from '@/lib/transport-desk';

interface Hit {
  id: string;
  name: string;
  admissionNo: string | null;
  section: string | null;
  riding: string | null;
}

/**
 * The transport office asks for a pupil: find the pupil, then the same form a family fills (service,
 * route → stoppage → slab, months). The request goes to the fee department only.
 */
export default async function ApplyTransportPage({
  searchParams,
}: {
  searchParams: Promise<{
    sq?: string;
    student?: string;
    imported?: string;
    skipped?: string;
    problems?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const sq = (sp.sq ?? '').trim().slice(0, 80);
  const [me, hits] = await Promise.all([
    getMe(),
    sq.length >= 2
      ? apiFetch<{ data: Hit[] }>(`/transport/requests/students?q=${encodeURIComponent(sq)}`).then(
          (r) => r.data,
        )
      : Promise.resolve([] as Hit[]),
  ]);
  const student = hits.find((x) => x.id === sp.student) ?? null;
  const options = student
    ? await apiFetch<RideOptions>(`/transport/requests/options?studentId=${student.id}`)
    : null;
  const here = `/transport/requests/new?${new URLSearchParams({ sq, ...(student ? { student: student.id } : {}) }).toString()}`;
  return (
    <>
      <PageHeader
        kicker="Transport"
        title="Apply for a student"
        description="New transport, a change or a withdrawal made at the transport office. It goes to the fee department for approval; the fees follow the approval."
      />
      <TransportNav current="/transport/requests/new" permissions={me.permissions} />
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      {sp.imported !== undefined ? (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <Alert tone={Number(sp.skipped) ? 'warning' : 'success'}>
            {sp.imported} request(s) made from the Excel; they wait for approval under{' '}
            <a href="/transport/requests?tab=pending" style={{ textDecoration: 'underline' }}>
              Requests
            </a>
            .
            {Number(sp.skipped)
              ? ` ${sp.skipped ?? '0'} row(s) were left out: ${sp.problems ?? ''}`
              : ''}
          </Alert>
        </div>
      ) : null}
      <Card title="1. The student">
        <form method="get" className="ep-hd__row">
          <label className="ep-field" htmlFor="ta-sq">
            <span className="ep-field__label">Student name or admission no.</span>
            <input
              id="ta-sq"
              name="sq"
              type="search"
              className="ep-input"
              defaultValue={sq}
              minLength={2}
              maxLength={80}
              required
            />
          </label>
          <div>
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </div>
        </form>
        {sq.length >= 2 && !student ? (
          hits.length ? (
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Students found">
              <table className="ep-table ep-table--dense">
                <caption>Check the class and the admission number, then select the student</caption>
                <thead>
                  <tr>
                    <th scope="col">Student</th>
                    <th scope="col">Admission no.</th>
                    <th scope="col">Class</th>
                    <th scope="col">Bus now</th>
                    <th scope="col">
                      <span className="ep-sr-only">Select</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {hits.map((x) => (
                    <tr key={x.id}>
                      <td>{x.name}</td>
                      <td>{x.admissionNo ?? '—'}</td>
                      <td>{x.section ?? '—'}</td>
                      <td>{x.riding ?? 'Not on a bus'}</td>
                      <td>
                        <form method="get">
                          <input type="hidden" name="sq" value={sq} />
                          <Button
                            type="submit"
                            name="student"
                            value={x.id}
                            size="sm"
                            aria-label={`Select ${x.name}, ${x.admissionNo ?? ''}`}
                          >
                            Select
                          </Button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Alert tone="warning">No student matches “{sq}”.</Alert>
          )
        ) : null}
        {student ? (
          <Alert tone="success">
            <strong>{student.name}</strong> · {student.section ?? 'no class'} · Adm. no.{' '}
            {student.admissionNo ?? '—'} · {student.riding ?? 'not on a bus'}.{' '}
            <a href={`/transport/requests/new?sq=${encodeURIComponent(sq)}`}>Change</a>
          </Alert>
        ) : null}
      </Card>
      {student && options ? (
        <>
          {options.periods.length ? (
            <Card title="Transport this session" style={{ marginTop: 'var(--sp-4)' }}>
              <PeriodTable
                periods={options.periods}
                caption={`Transport history of ${student.name}`}
              />
            </Card>
          ) : null}
          <Card title="2. The request" style={{ marginTop: 'var(--sp-4)' }}>
            {options.routes.length === 0 ? (
              <Alert tone="warning">
                No route is set up yet. Add routes and their stoppages first.
              </Alert>
            ) : (
              <RideForm
                action={applyTransport}
                studentId={student.id}
                returnTo={here}
                routes={options.routes}
                months={options.months}
                thisMonth={options.thisMonth}
                settings={options.settings}
                riding={options.riding || Boolean(student.riding)}
                submitLabel="Send to the fee department"
              />
            )}
          </Card>
        </>
      ) : null}
      {!student ? (
        <Card title="Many students from Excel" style={{ marginTop: 'var(--sp-4)' }}>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            For the start of a session. 1. Download the Excel: service, stoppage (route · stoppage)
            and month are drop-downs. 2. Fill one row per pupil with the admission number. 3. Upload
            it. Every row becomes a request made by the transport office; the fee department
            approves them (one by one or all ticked together) and the fees follow.
          </p>
          <form action={importTransportRequests} className="ep-gate__act">
            <label className="ep-field" htmlFor="ti-file">
              <span className="ep-field__label">Excel file (.xlsx)</span>
              <input
                id="ti-file"
                name="file"
                type="file"
                className="ep-input"
                required
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              />
            </label>
            <Button type="submit">Upload</Button>
            <a className="ep-btn ep-btn--secondary" href="/api/transport/request-template">
              Download the Excel to fill
            </a>
          </form>
        </Card>
      ) : null}
    </>
  );
}
