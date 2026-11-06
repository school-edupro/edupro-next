import { Badge, Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { notFound, redirect } from 'next/navigation';
import { FileLinks } from '@/components/FileLinks';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import type { IssueDetail } from '@/lib/purchase';
import { acknowledgeIssue } from '@/lib/purchase-actions';

const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(iso.length === 10 ? `${iso}T00:00:00+05:30` : iso))
    : '—';
const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

/** One issue in the staff app (docs/design/84, part 8): what came, the slip; acknowledge it. */
export default async function StaffIssuePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const lang = await currentLang();
  let is: IssueDetail;
  try {
    is = await bff.api.fetch<IssueDetail>(`/purchase/issues/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) notFound();
    throw error;
  }
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: '52rem', margin: '0 auto' }}>
      <p style={{ margin: '0 0 var(--sp-2)' }}>
        <a href="/purchase/issues" style={{ textDecoration: 'underline' }}>
          ← {t(lang, 'Issued to my department')}
        </a>
      </p>
      <PageHeader
        kicker={`${is.kindLabel} · ${is.department}`}
        title={is.number}
        description={`From ${is.store} on ${when(is.issuedOn)}${is.takenBy ? ` · taken by ${is.takenBy}` : ''}`}
      />
      {sp.ok ? (
        <p className="ep-alert ep-alert--success" role="status">
          {sp.detail || 'Done.'}
        </p>
      ) : null}
      {sp.error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {sp.detail || 'That did not work. Please try again.'}
        </p>
      ) : null}
      <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
        <Card title="Status">
          <p style={{ marginTop: 0 }}>
            <Badge tone={is.status === 'acknowledged' ? 'success' : 'warning'}>
              {is.status === 'acknowledged' ? 'Acknowledged' : 'To acknowledge'}
            </Badge>
            {is.status === 'acknowledged'
              ? ` by ${is.acknowledgedBy ?? ''} on ${when(is.acknowledgedAt)}${is.ackNote ? `: ${is.ackNote}` : ''}`
              : ''}
          </p>
          {is.indent || is.purpose ? (
            <p className="ep-field__help">
              {[is.indent ? `For ${is.indent}` : null, is.purpose].filter(Boolean).join(' · ')}
            </p>
          ) : null}
          <p style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
            Slip{' '}
            <FileLinks
              url={`/api/purchase-issue/${is.id}`}
              saveUrl={`/api/purchase-issue/${is.id}?save=1`}
              label={`${is.number} slip as a PDF`}
            />
          </p>
          {is.can.acknowledge ? (
            <form>
              <input type="hidden" name="id" value={is.id} />
              <label className="ep-field" htmlFor="ack-note">
                <span className="ep-field__label">Note (anything short or damaged)</span>
                <input id="ack-note" name="note" className="ep-input" maxLength={300} />
              </label>
              <button
                type="submit"
                formAction={acknowledgeIssue}
                className="ep-btn ep-btn--primary"
              >
                {t(lang, 'Acknowledge: received')}
              </button>
            </form>
          ) : null}
        </Card>
        <Card title="What came">
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="What came">
            <table className="ep-table">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Quantity
                  </th>
                </tr>
              </thead>
              <tbody>
                {is.lineItems.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.item} ({l.itemCode})
                      {l.batch || l.returned ? (
                        <span className="ep-field__help" style={{ display: 'block' }}>
                          {[
                            l.batch ? `Batch ${l.batch}` : null,
                            l.returned ? `${fmt(l.returned)} brought back` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      ) : null}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {fmt(l.qty)} {l.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </main>
  );
}
