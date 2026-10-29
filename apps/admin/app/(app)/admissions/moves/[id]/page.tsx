import { Badge, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { MoveDecide } from '@/components/admissions/MoveDecide';
import { Notice } from '@/components/Notice';
import { dmy, REG_STATUS, rupees } from '@/lib/admission-desk';
import { MOVE_TONE, type AdmissionMove } from '@/lib/admission-moves';
import { ApiError, apiFetch, getMe } from '@/lib/api';

/**
 * One registration moved between the schools of the group (docs/design/64): what the first school sent
 * (the candidate, the form's copy, the fees paid there) and the decision: accept into a session and class
 * here, refuse, or (the first school) withdraw.
 */
export default async function AdmissionMovePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('admissions.application.view')) notFound();
  const m = await apiFetch<AdmissionMove>(`/admissions/moves/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const canMove = me.permissions.includes('admissions.application.move');
  const deciding = m.status === 'requested' && canMove;
  const options =
    deciding && m.direction === 'incoming'
      ? await apiFetch<{
          cycles: Array<{
            id: string;
            name: string;
            open: boolean;
            classes: Array<{ id: string; name: string }>;
          }>;
          suggested: { cycleId: string; classId: string } | null;
        }>(`/admissions/moves/${id}/options`).catch(() => ({ cycles: [], suggested: null }))
      : null;
  const fromStatus = REG_STATUS[m.fromStatus]?.label ?? m.fromStatus;
  return (
    <>
      <PageHeader
        kicker={`Moves between schools · ${m.fromSchool} → ${m.toSchool}`}
        title={m.candidate ?? `Move ${m.id}`}
        description={`Registration ${m.number ?? '-'} · ${m.className} · ${m.session}`}
        actions={
          <a
            className="ep-btn ep-btn--ghost ep-btn--sm"
            href={`/admissions/moves?box=${m.direction}`}
          >
            Moves between schools
          </a>
        }
      />
      <Notice params={sp} />
      <div className="ep-rp">
        <Card elevated title="Sent">
          <p style={{ marginTop: 0 }}>
            <Badge tone={MOVE_TONE[m.status]}>{m.statusLabel}</Badge>
            <span className="ep-kicker">
              {' '}
              · {fromStatus} in {m.fromSchool}
            </span>
          </p>
          <dl className="ep-dl">
            <dt>Reason</dt>
            <dd>{m.reason}</dd>
            <dt>Asked</dt>
            <dd>
              {dmy(m.requestedAt)}
              {m.requestedBy ? ` by ${m.requestedBy}` : ''}
            </dd>
            {m.details ? (
              <>
                <dt>Date of birth</dt>
                <dd>{dmy(m.details.dob)}</dd>
                <dt>Mobile</dt>
                <dd>{m.details.mobile ?? '-'}</dd>
                <dt>Email</dt>
                <dd>{m.details.email ?? '-'}</dd>
                {m.details.points !== null ? (
                  <>
                    <dt>Merit points there</dt>
                    <dd>{m.details.points} (worked out again by this school&rsquo;s rules)</dd>
                  </>
                ) : null}
              </>
            ) : null}
            <dt>Comes with</dt>
            <dd>
              {m.carries.answers} answers; {m.carries.files} file
              {m.carries.files === 1 ? '' : 's'} (documents and photos)
              {m.carries.login ? '; the family’s portal login (same mobile number)' : ''}
            </dd>
            {m.decidedAt ? (
              <>
                <dt>
                  {m.status === 'accepted'
                    ? 'Accepted'
                    : m.status === 'refused'
                      ? 'Refused'
                      : 'Withdrawn'}
                </dt>
                <dd>
                  {dmy(m.decidedAt)}
                  {m.decidedBy ? ` by ${m.decidedBy}` : ''}
                  {m.decisionNote ? `: ${m.decisionNote}` : ''}
                </dd>
              </>
            ) : null}
            {m.to ? (
              <>
                <dt>Now</dt>
                <dd>
                  {m.to.className} ({m.to.session}),{' '}
                  {m.to.number
                    ? `registration ${m.to.number}`
                    : 'the registration waits for the fee difference'}
                  {m.direction === 'incoming' && m.applicationId ? (
                    <>
                      {' '}
                      <a
                        href={`/admissions/registrations/${m.applicationId}`}
                        style={{ textDecoration: 'underline' }}
                      >
                        Open
                      </a>
                    </>
                  ) : null}
                </dd>
              </>
            ) : null}
            {m.missing.length ? (
              <>
                <dt>Asked of the family</dt>
                <dd>{m.missing.length} answer(s) this school&rsquo;s form needs</dd>
              </>
            ) : null}
          </dl>
          {m.direction === 'outgoing' && m.applicationId ? (
            <p style={{ marginBottom: 0 }}>
              <a
                href={`/admissions/registrations/${m.applicationId}`}
                style={{ textDecoration: 'underline' }}
              >
                Open the registration here
              </a>
            </p>
          ) : null}
        </Card>
        <Card elevated title="Fees paid there">
          {m.money.receipts.length ? (
            <div className="ep-table-wrap">
              <table className="ep-table">
                <caption className="ep-sr-only">Receipts carried over</caption>
                <thead>
                  <tr>
                    <th scope="col">Receipt</th>
                    <th scope="col">Fee</th>
                    <th scope="col">Date</th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {m.money.receipts.map((x) => (
                    <tr key={x.receiptNo}>
                      <td>{x.receiptNo}</td>
                      <td>{x.head === 'admission' ? 'Admission fee' : 'Registration fee'}</td>
                      <td>{dmy(x.on)}</td>
                      <td style={{ textAlign: 'right' }}>{rupees(x.amount)}</td>
                    </tr>
                  ))}
                  <tr>
                    <th scope="row" colSpan={3}>
                      Carried over (no cash)
                    </th>
                    <td style={{ textAlign: 'right' }}>
                      <strong>{rupees(m.money.paid)}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ marginTop: 0 }}>No fee was paid there.</p>
          )}
          {m.status === 'accepted' ? (
            <p style={{ marginBottom: 0 }}>
              {rupees(m.money.toRegistration ?? 0)} to the registration fee in {m.toSchool}
              {m.money.differenceDue
                ? `; ${rupees(m.money.differenceDue)} for the family to pay`
                : ''}
              {m.money.credit ? `; credit ${rupees(m.money.credit)} for the admission fee` : ''}.
            </p>
          ) : null}
        </Card>
      </div>
      {deciding ? (
        <Card
          elevated
          title={m.direction === 'incoming' ? 'Accept or refuse' : 'Waiting for the other school'}
          style={{ marginTop: 'var(--sp-4)' }}
        >
          {m.direction === 'outgoing' ? (
            <p style={{ marginTop: 0 }}>
              {m.toSchool} accepts or refuses it. Until then the registration stays here as it is.
            </p>
          ) : null}
          <MoveDecide
            id={m.id}
            side={m.direction}
            cycles={options?.cycles ?? []}
            suggested={options?.suggested ?? null}
            fromSchool={m.fromSchool}
          />
        </Card>
      ) : null}
    </>
  );
}
