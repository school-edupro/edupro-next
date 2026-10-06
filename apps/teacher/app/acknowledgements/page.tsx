import { Badge, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

interface Status {
  title: string;
  section: string | null;
  roster: boolean;
  acknowledged: number;
  total: number;
  data: Array<{
    id: string;
    name: string;
    admissionNo: string | null;
    rollNo: number | null;
    ackedAt: string | null;
    by: string | null;
  }>;
}
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Who acknowledged a piece of daily work or a class document, and who has not yet. */
export default async function AcknowledgementsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; id?: string }>;
}) {
  const sp = await searchParams;
  const type = sp.type === 'document' || sp.type === 'notice' ? sp.type : 'daily_work';
  let s: Status | null = null;
  let problem = '';
  if (/^\d+$/.test(sp.id ?? ''))
    try {
      s = await bff.api.fetch<Status>(`/academics/acks?type=${type}&id=${sp.id!}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401)
        redirect('/login?error=session-expired');
      if (error instanceof ApiError) problem = error.problem.detail ?? error.problem.type;
      else throw error;
    }
  const back = type === 'document' ? '/documents' : '/daily-work';
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
      <PageHeader
        kicker="Acknowledgements"
        title={s?.title ?? 'Acknowledgements'}
        description={
          s
            ? `${s.section ? `Class ${s.section} · ` : ''}${String(s.acknowledged)} of ${String(s.total)} acknowledged`
            : ''
        }
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href={back}>
            Back
          </a>
        }
      />
      {problem ? (
        <div className="ep-alert ep-alert--danger" role="alert">
          {problem}
        </div>
      ) : null}
      {s ? (
        <Card>
          {s.data.length === 0 ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              Nobody has acknowledged it yet.
            </p>
          ) : (
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Acknowledgements">
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">Who acknowledged</caption>
                <thead>
                  <tr>
                    <th scope="col">Roll</th>
                    <th scope="col">Student</th>
                    <th scope="col">Status</th>
                    <th scope="col">When</th>
                    <th scope="col">By</th>
                  </tr>
                </thead>
                <tbody>
                  {s.data.map((x, i) => (
                    <tr key={`${x.id}-${String(i)}`}>
                      <td>{x.rollNo ?? ''}</td>
                      <th scope="row">
                        {x.name}
                        <div className="ep-kicker">{x.admissionNo}</div>
                      </th>
                      <td>
                        <Badge tone={x.ackedAt ? 'success' : 'warning'}>
                          {x.ackedAt ? 'Acknowledged' : 'Not yet'}
                        </Badge>
                      </td>
                      <td>{x.ackedAt ? when(x.ackedAt) : ''}</td>
                      <td>{x.by ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}
    </main>
  );
}
