import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ApiError, apiFetch, getMe } from '@/lib/api';

interface Entry {
  entry: {
    id: string;
    at: string;
    who: string | null;
    kind: 'Change' | 'Event' | 'Read';
    action: string;
    entity_type: string | null;
    entity_id: string | null;
    ip: string | null;
    request_id: string | null;
  };
  fields: Array<{ field: string; before: unknown; after: unknown; changed: boolean }>;
}
const show = (v: unknown) =>
  v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);

/** One entry of the payroll audit trail, field by field (docs/design/86, phase F). */
export default async function AuditEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('payroll.audit.view')) notFound();
  let d: Entry;
  try {
    d = await apiFetch<Entry>(`/payroll/audit/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
  const e = d.entry;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Payroll', href: '/payroll' },
          { label: 'Audit trail', href: '/payroll/audit' },
          { label: `Entry ${e.id}` },
        ]}
      />
      <PageHeader
        kicker="Audit trail"
        title={e.action}
        description={`${new Date(e.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} · ${e.who ?? 'The system'}${
          e.entity_type ? ` · ${e.entity_type}${e.entity_id ? ` ${e.entity_id}` : ''}` : ''
        }`}
      />
      <p>
        <Badge tone={e.kind === 'Change' ? 'info' : e.kind === 'Read' ? 'warning' : 'neutral'}>
          {e.kind}
        </Badge>{' '}
        <span className="ep-field__help">
          {e.ip ? `From ${e.ip}` : ''}
          {e.request_id ? ` · request ${e.request_id}` : ''}
        </span>
      </p>
      <section className="ep-card" aria-labelledby="ae-f">
        <h2 id="ae-f" className="ep-card__title">
          Fields
        </h2>
        {d.fields.length ? (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="ae-f">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">Before</th>
                  <th scope="col">After</th>
                </tr>
              </thead>
              <tbody>
                {d.fields.map((f) => (
                  <tr key={f.field}>
                    <td>{f.changed ? <strong>{f.field}</strong> : f.field}</td>
                    <td>{show(f.before)}</td>
                    <td>{f.changed ? <strong>{show(f.after)}</strong> : show(f.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No fields recorded.</p>
        )}
      </section>
    </>
  );
}
