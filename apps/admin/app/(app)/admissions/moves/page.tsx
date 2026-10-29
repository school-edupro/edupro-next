import { Badge, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ViewDownload } from '@/components/admissions/ViewDownload';
import { Notice } from '@/components/Notice';
import { dmy, rupees } from '@/lib/admission-desk';
import { MOVE_TONE, type AdmissionMove } from '@/lib/admission-moves';
import { apiFetch, getMe } from '@/lib/api';

const TABS = [
  ['incoming', 'Coming here'],
  ['outgoing', 'Sent from here'],
  ['all', 'All moves'],
] as const;

/**
 * Registrations moved between the schools of the group (docs/design/64): those sent here wait to be
 * accepted (a fresh registration, the money carried over) or refused; those sent from here wait for the
 * other school; the register of every move as Excel or PDF.
 */
export default async function AdmissionMovesPage({
  searchParams,
}: {
  searchParams: Promise<{ box?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('admissions.application.view')) notFound();
  const box = TABS.some(([v]) => v === sp.box) ? (sp.box as string) : 'incoming';
  const r = await apiFetch<{
    data: AdmissionMove[];
    waiting: { incoming: number; outgoing: number };
  }>(`/admissions/moves?box=${box}`);
  const canMove = me.permissions.includes('admissions.application.move');
  return (
    <>
      <PageHeader
        kicker="Admissions"
        title="Moves between schools"
        description="A registration made in the wrong school of the group moves to the other: that school accepts it into its session and class (a fresh registration with the form, documents and the family's login), the old one is cancelled, and the fees paid go with it as credit, no cash."
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href="/api/admission-moves/register/xlsx"
            >
              Excel
            </a>
            <ViewDownload href="/api/admission-moves/register/pdf" what="the register of moves" />
          </span>
        }
      />
      <Notice params={sp} />
      <nav className="ep-tabs-links" aria-label="Moves" style={{ marginBottom: 'var(--sp-3)' }}>
        {TABS.map(([value, label]) => (
          <a
            key={value}
            href={`/admissions/moves?box=${value}`}
            aria-current={box === value ? 'page' : undefined}
          >
            {label}
            {value === 'incoming' && r.waiting.incoming
              ? ` · ${String(r.waiting.incoming)} waiting`
              : ''}
            {value === 'outgoing' && r.waiting.outgoing
              ? ` · ${String(r.waiting.outgoing)} waiting`
              : ''}
          </a>
        ))}
      </nav>
      <Card elevated>
        {r.data.length ? (
          <div className="ep-table-wrap">
            <table className="ep-table">
              <caption className="ep-sr-only">Moves between schools</caption>
              <thead>
                <tr>
                  <th scope="col">Asked on</th>
                  <th scope="col">Candidate</th>
                  <th scope="col">Class</th>
                  <th scope="col">From → to</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Paid
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="ep-sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.data.map((m) => (
                  <tr key={m.id}>
                    <td>{dmy(m.requestedAt)}</td>
                    <td>
                      {m.candidate ?? '-'}
                      <span className="ep-kicker" style={{ display: 'block' }}>
                        {m.number ?? ''}
                        {m.to?.number ? ` → ${m.to.number}` : ''}
                      </span>
                    </td>
                    <td>
                      {m.className}
                      {m.to && m.to.className !== m.className ? ` → ${m.to.className}` : ''}
                    </td>
                    <td>
                      {m.fromSchool} → {m.toSchool}
                    </td>
                    <td style={{ textAlign: 'right' }}>{rupees(m.money.paid)}</td>
                    <td>
                      <Badge tone={MOVE_TONE[m.status]}>{m.statusLabel}</Badge>
                    </td>
                    <td>
                      <a
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        href={`/admissions/moves/${m.id}`}
                        style={{ whiteSpace: 'nowrap' }}
                      >
                        {m.status === 'requested' && m.direction === 'incoming' && canMove
                          ? 'Accept or refuse'
                          : 'Open'}
                        <span className="ep-sr-only">
                          {' '}
                          the move of {m.candidate ?? 'the candidate'}
                        </span>
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ margin: 0 }}>
            {box === 'incoming'
              ? 'No registration has been sent here from another school.'
              : box === 'outgoing'
                ? 'No registration has been sent from here. Open a registration and use Move to another school.'
                : 'No moves yet.'}
          </p>
        )}
      </Card>
    </>
  );
}
