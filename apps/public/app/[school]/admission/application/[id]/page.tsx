import { Badge, Card, PageHeader } from '@edupro/ui';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { PublicApiError } from '@/lib/api';
import {
  ADMISSION_COOKIE,
  STATUS_TEXT,
  admissionFetch,
  dmy,
  rupees,
  whenIst,
  type PortalApplication,
} from '@/lib/admission';
import { AdmissionApplicationForm } from '@/components/AdmissionApplicationForm';
import { ViewDownload } from '@/components/ViewDownload';
import { withdrawRegistration } from '../../actions';

/**
 * One registration in the admission portal (docs/design/39, part 3): the form while it is a draft or sent
 * back for correction; afterwards the status, the registration fee with the gateway choice, the receipts
 * and the submitted form as PDF, and the answers read-only.
 */
export default async function AdmissionApplicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ school: string; id: string }>;
  searchParams: Promise<{ error?: string; paid?: string }>;
}) {
  const { school, id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  if (!(await cookies()).get(ADMISSION_COOKIE)?.value) redirect(`/${school}/admission#sign-in`);
  const app = await admissionFetch<PortalApplication>(`/me/applications/${id}`).catch(
    (error: unknown) => {
      if (error instanceof PublicApiError && error.status === 401)
        redirect(`/${school}/admission#sign-in`);
      if (error instanceof PublicApiError && error.status === 404) notFound();
      throw error;
    },
  );
  const gateways =
    app.feeDue > 0
      ? await admissionFetch<Array<{ id: string; label: string }>>('/me/gateways')
          .then((r) =>
            Array.isArray(r)
              ? r
              : ((r as { data?: Array<{ id: string; label: string }> }).data ?? []),
          )
          .catch(() => [])
      : [];
  const st = STATUS_TEXT[app.status] ?? { label: app.status, tone: 'neutral' as const };
  const editing = app.status === 'draft' || app.status === 'sent_back';

  return (
    <>
      <PageHeader
        kicker={`${app.session.name} · ${app.session.academicYear}`}
        title={
          app.candidate
            ? `${app.candidate}: ${app.class.name}`
            : `Registration for ${app.class.name}`
        }
        description={
          app.number
            ? `Registration no. ${app.number}`
            : 'The registration number is given once the registration fee is paid.'
        }
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/${school}/admission`}>
            My registrations
          </a>
        }
      />
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          {sp.error}
        </div>
      ) : null}

      <div
        className="ep-adm-status"
        style={{ display: 'grid', gap: 'var(--sp-4)', marginBottom: 'var(--sp-4)' }}
      >
        <Card elevated title="Status">
          <p style={{ margin: 0 }}>
            <Badge tone={st.tone}>{st.label}</Badge>
            {app.category ? <span className="ep-kicker"> · Category {app.category}</span> : null}
          </p>
          {app.status === 'sent_back' ? (
            <div className="ep-alert ep-alert--warning" role="status">
              The school asked you to correct the answers marked below
              {app.correction?.dueOn ? ` by ${dmy(app.correction.dueOn)}` : ''}.
              {app.correction ? <> Remark: {app.correction.remark}</> : null} Correct them and
              submit again.
            </div>
          ) : null}
          {app.steps.length ? (
            <ol className="ep-rs" aria-label="Admission steps" style={{ margin: 'var(--sp-3) 0' }}>
              {app.steps.map((s, i) => (
                <li key={s.name} className="ep-rs__step" data-state={s.state}>
                  <span className="ep-rs__dot" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span>
                    <span className="ep-rs__name">{s.name}</span>{' '}
                    <span className="ep-kicker">
                      {s.state === 'done'
                        ? 'done'
                        : s.state === 'current'
                          ? 'in progress'
                          : s.state === 'rejected'
                            ? 'closed'
                            : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
          {app.slot ? (
            <div className="ep-alert ep-alert--info" role="status">
              <strong>{app.slot.stage}</strong>: {whenIst(app.slot.startsAt)} at {app.slot.venue}{' '}
              (roll no. {app.slot.rollNo}, {app.slot.minutes} minutes). Bring the admit card.{' '}
              <ViewDownload href={`/api/admission/admit/${app.id}`} what="the admit card" />
            </div>
          ) : null}
          {app.offer ? (
            <div className="ep-alert ep-alert--success" role="status">
              {app.candidate ?? 'Your ward'} is offered admission. Pay the admission fee of{' '}
              <strong>{rupees(app.offer.admissionFee)}</strong>
              {app.offer.expiresAt ? ` by ${dmy(app.offer.expiresAt)}` : ''} at the school office or
              here when online payment opens.
            </div>
          ) : null}
          {app.status === 'waitlisted' && app.waitRank ? (
            <p>
              On the waiting list at number {app.waitRank}. We will write when a seat is offered.
            </p>
          ) : null}
          {app.status === 'draft' ? (
            <p>{app.progress}% of the form is filled. Each tab is saved when you press Next.</p>
          ) : null}
          {app.status === 'registered' ? (
            <p>
              Registered on {dmy(app.registeredAt)}. The school will write to you by email about the
              next steps; the form and the receipt were mailed to you.
            </p>
          ) : null}
          {app.feeDue > 0 ? (
            <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
              <p style={{ margin: 0 }}>
                The form is submitted. Pay the registration fee of{' '}
                <strong>{rupees(app.feeDue)}</strong> to get your registration number. You can also
                pay at the school office.
              </p>
              <form
                action="/api/admission/pay"
                method="post"
                style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'end' }}
              >
                <input type="hidden" name="school" value={school} />
                <input type="hidden" name="id" value={app.id} />
                {gateways.length > 1 ? (
                  <label className="ep-field">
                    <span className="ep-field__label">Pay through</span>
                    <select className="ep-select" name="gatewayId" defaultValue={gateways[0]!.id}>
                      {gateways.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <button className="ep-btn ep-btn--primary" type="submit">
                  Pay {rupees(app.feeDue)}
                </button>
              </form>
            </div>
          ) : null}
          {app.status === 'draft' || (app.status === 'submitted' && !app.number) ? (
            <form action={withdrawRegistration} style={{ marginTop: 'var(--sp-3)' }}>
              <input type="hidden" name="school" value={school} />
              <input type="hidden" name="id" value={app.id} />
              <button className="ep-btn ep-btn--ghost ep-btn--sm" type="submit">
                {app.status === 'draft' ? 'Delete this draft' : 'Withdraw this registration'}
              </button>
            </form>
          ) : null}
        </Card>

        {app.hasPdf || app.receipts.length ? (
          <Card elevated title="Documents">
            <div className="ep-table-wrap">
              <table className="ep-table">
                <caption className="ep-sr-only">Documents of this registration</caption>
                <thead>
                  <tr>
                    <th scope="col">Document</th>
                    <th scope="col">Date</th>
                    <th scope="col">Amount</th>
                    <th scope="col">
                      <span className="ep-sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {app.hasPdf ? (
                    <tr>
                      <td>Registration form</td>
                      <td>{dmy(app.submittedAt)}</td>
                      <td>-</td>
                      <td>
                        <ViewDownload
                          href={`/api/admission/pdf/${app.id}`}
                          what="the registration form"
                        />
                      </td>
                    </tr>
                  ) : null}
                  {app.receipts.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {r.head} receipt {r.receiptNo}
                        {r.status !== 'active' ? <Badge tone="neutral"> {r.status}</Badge> : null}
                      </td>
                      <td>{dmy(r.date)}</td>
                      <td>{rupees(r.amount)}</td>
                      <td>
                        <ViewDownload
                          href={`/api/admission/receipt/${app.id}/${r.id}`}
                          what={`receipt ${r.receiptNo}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}
      </div>

      <Card elevated title={editing ? 'Registration form' : 'Your answers'}>
        {editing ? (
          <AdmissionApplicationForm
            id={app.id}
            def={app.def}
            options={app.options}
            answers={app.answers}
            files={app.files}
            onlyFields={app.onlyFields}
            submitLabel={app.status === 'sent_back' ? 'Submit the corrections' : 'Submit the form'}
          />
        ) : (
          <AdmissionApplicationForm
            id={app.id}
            def={app.def}
            options={app.options}
            answers={app.answers}
            files={app.files}
            onlyFields={null}
            readOnly
          />
        )}
      </Card>
    </>
  );
}
