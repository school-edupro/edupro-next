import { Badge, Card, PageHeader } from '@edupro/ui';
import { apiFetch } from '@/lib/api';

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
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Who acknowledged a notice, an office order, a class document or a piece of daily work. */
export default async function AcknowledgementsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; id?: string }>;
}) {
  const sp = await searchParams;
  const type = sp.type === 'document' || sp.type === 'daily_work' ? sp.type : 'notice';
  const s = /^\d+$/.test(sp.id ?? '')
    ? await apiFetch<Status>(`/academics/acks?type=${type}&id=${sp.id!}`).catch(() => null)
    : null;
  return (
    <>
      <PageHeader
        kicker="Acknowledgements"
        title={s?.title ?? 'Acknowledgements'}
        description={
          s
            ? s.roster
              ? `Class ${s.section ?? ''} · ${String(s.acknowledged)} of ${String(s.total)} acknowledged`
              : `${String(s.acknowledged)} acknowledged so far`
            : 'Not found, or not yours to see.'
        }
        actions={
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href={type === 'notice' ? '/academics/notices' : '/academics/documents'}
          >
            Back
          </a>
        }
      />
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
                    <th scope="col">S.no</th>
                    <th scope="col">Name</th>
                    <th scope="col">Status</th>
                    <th scope="col">When</th>
                    <th scope="col">By</th>
                  </tr>
                </thead>
                <tbody>
                  {s.data.map((x, i) => (
                    <tr key={`${x.id}-${String(i)}`}>
                      <td>{x.rollNo ?? i + 1}</td>
                      <th scope="row">
                        {x.name}
                        <div className="ep-field__help">{x.admissionNo}</div>
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
    </>
  );
}
