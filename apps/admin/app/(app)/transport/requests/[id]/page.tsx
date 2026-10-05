import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { RecordSheet } from '@/components/RecordSheet';
import { PeriodTable } from '@/components/transport/PeriodTable';
import { TransportNav } from '@/components/transport/TransportNav';
import { apiFetch, getMe } from '@/lib/api';
import { when } from '@/lib/appointments';
import { decideTransport } from '@/lib/transport-desk-actions';
import {
  APPROVAL_LABEL,
  APPROVAL_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  monthLabel,
  rupees,
  type TransportRequestDetail,
} from '@/lib/transport-desk';

/**
 * One transport request with everything on it: who and what, the approval levels, the next step for
 * whoever opens it, what happened to the fees, and the pupil's transport history.
 */
export default async function TransportRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [me, r] = await Promise.all([
    getMe(),
    apiFetch<TransportRequestDetail>(`/transport/requests/${id}`),
  ]);
  const here = `/transport/requests/${r.id}`;
  const leave = r.kind === 'leave';
  const school =
    me.memberships.find((m) => m.schoolId === me.school?.id)?.schoolName ??
    me.memberships[0]?.schoolName ??
    '';
  const feesDone = Boolean(r.feeNote?.startsWith('Fees updated') && !r.feeNote.includes('except'));
  return (
    <>
      <PageHeader
        kicker="Transport request"
        title={`${r.student} · ${r.number}`}
        description={r.what}
        actions={
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/transport/requests">
            All requests
          </a>
        }
      />
      <TransportNav current="" permissions={me.permissions} ok={sp.ok} />
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      {r.canDecide ? (
        <Card title="Your approval" style={{ marginBottom: 'var(--sp-4)' }}>
          <form action={decideTransport} className="ep-hd__form">
            <input type="hidden" name="id" value={r.id} />
            <input type="hidden" name="returnTo" value={here} />
            <label className="ep-field" htmlFor="tr-note">
              <span className="ep-field__label">Note (needed to reject)</span>
              <input id="tr-note" name="note" className="ep-input" maxLength={300} />
            </label>
            <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
              <Button type="submit" name="outcome" value="approved">
                Approve
              </Button>
              <Button type="submit" name="outcome" value="rejected" variant="secondary">
                Reject
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
      <RecordSheet
        school={school}
        doc={`Transport request · ${r.number}`}
        name={r.student}
        badge={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <Badge tone="info">{r.kindLabel}</Badge>
            <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
          </span>
        }
        facts={[
          ['Class', r.section],
          ['Admission no.', r.admissionNo],
          ['Made by', r.source === 'office' ? 'Transport office' : 'Family (portal)'],
          ['Asked by', r.requestedBy],
          ['Asked on', when(r.requestedAt)],
        ]}
        sections={[
          {
            title: leave ? 'Withdrawal' : 'What is asked',
            rows: [
              ['Service', leave ? null : r.serviceLabel],
              [
                'Pick',
                !leave && r.service !== 'drop' && r.pickStop
                  ? `${r.pickStop}\n${r.pickRoute ?? ''}${r.pickTime ? ` · ${r.pickTime}` : ''}`
                  : null,
              ],
              [
                'Drop',
                !leave && r.service !== 'pick' && r.dropStop
                  ? `${r.dropStop}\n${r.dropRoute ?? ''}${r.dropTime ? ` · ${r.dropTime}` : ''}`
                  : null,
              ],
              [leave ? 'No transport from' : 'From month', monthLabel(r.fromMonth)],
              ['To month', leave ? null : monthLabel(r.toMonth)],
            ],
          },
          {
            title: 'Charge and fees',
            rows: [
              ['Slab', leave ? null : r.slab],
              ['Monthly charge', leave ? null : rupees(r.monthlyAmount)],
              [
                'Fees',
                r.feeNote
                  ? `${r.feeNote}.`
                  : r.status === 'pending'
                    ? 'Updated on the last approval'
                    : null,
              ],
            ],
          },
          {
            title: 'Decision',
            rows: [
              ['Decided on', r.decidedAt ? when(r.decidedAt) : null],
              ['Decision note', r.decisionNote],
            ],
          },
        ]}
        remarksTitle={
          r.source === 'office' ? 'Note of the transport office' : 'Note from the family'
        }
        remarks={r.note}
        attention={Boolean(r.feeNote) && !feesDone}
      >
        <section className="ep-sheet__sec" aria-label="Approval">
          <h3>
            Approval · {r.approvedLevels} of {r.levels}
          </h3>
          <ol className="ep-steps">
            {r.approvals.map((a) => (
              <li key={a.seq} data-state={a.status}>
                <div className="ep-steps__head">
                  <strong>{a.label}</strong>
                  <Badge tone={APPROVAL_TONE[a.status]}>{APPROVAL_LABEL[a.status]}</Badge>
                </div>
                <div className="ep-field__help">
                  {a.actedBy
                    ? `${a.actedBy}${a.actedAt ? ` · ${when(a.actedAt)}` : ''}`
                    : a.status === 'skipped'
                      ? (a.note ?? 'Skipped')
                      : `With ${a.approvers ?? 'nobody'}`}
                </div>
                {a.actedBy && a.note ? <div>{a.note}</div> : null}
              </li>
            ))}
          </ol>
        </section>
      </RecordSheet>
      <Card
        title="Transport history of the student"
        actions={
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href={`/transport/history?when=all&studentId=${r.studentId}`}
          >
            Open history
          </a>
        }
      >
        {r.periods.length ? (
          <PeriodTable periods={r.periods} caption={`Transport history of ${r.student}`} />
        ) : (
          <p className="ep-field__help" style={{ margin: 0 }}>
            No transport period yet this session.
          </p>
        )}
      </Card>
    </>
  );
}
