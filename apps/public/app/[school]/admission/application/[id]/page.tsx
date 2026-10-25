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
import { t } from '@/lib/i18n';
import { currentLang } from '@/lib/lang';
import { startRegistration, usePasscode, withdrawRegistration } from '../../actions';

const TABS = [
  ['overview', 'Overview'],
  ['form', 'Form'],
  ['documents', 'Documents'],
  ['payments', 'Payments'],
] as const;

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
  searchParams: Promise<{ error?: string; paid?: string; resumed?: string; tab?: string }>;
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
    app.feeDue > 0 || app.admissionFeeDue > 0
      ? await admissionFetch<Array<{ id: string; label: string }>>('/me/gateways')
          .then((r) =>
            Array.isArray(r)
              ? r
              : ((r as { data?: Array<{ id: string; label: string }> }).data ?? []),
          )
          .catch(() => [])
      : [];
  const st = STATUS_TEXT[app.status] ?? { label: app.status, tone: 'neutral' as const };
  // closed for this family (no passcode): the form is read-only and the registration fee waits
  const editing = (app.status === 'draft' && !app.locked) || app.status === 'sent_back';
  const lang = await currentLang();
  const w = (en: string) => t(lang, en);
  // the tabs (docs/design/42, part 3): a form being filled opens on Form, the rest on Overview
  const tab = (TABS.map((x) => x[0]) as string[]).includes(sp.tab ?? '')
    ? (sp.tab as (typeof TABS)[number][0])
    : editing
      ? 'form'
      : 'overview';
  // the family's uploads (answers of file and photo questions), each with View and Download
  const uploads = app.def.fields
    .filter((f) => f.type === 'file' || f.type === 'photo')
    .flatMap((f) => {
      const ids = Array.isArray(app.answers[f.key]) ? (app.answers[f.key] as string[]) : [];
      return ids.map((fileId) => ({ fileId, label: f.label }));
    });

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
          <a
            className="ep-btn ep-btn--ghost ep-btn--sm"
            href={`/${school}/admission/registrations`}
          >
            {w('My registrations')}
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
      {app.locked ? (
        <div className="ep-alert ep-alert--warning ep-adm-resumed" role="status">
          <span>
            Registrations for {app.class.name} closed
            {app.locked.closedOn ? ` on ${app.locked.closedOn}` : ''}: this form can no longer be
            changed, submitted or paid. If the school gave you a passcode, enter it here.
          </span>
          <form action={usePasscode} className="ep-adm-pass">
            <input type="hidden" name="school" value={school} />
            <label className="ep-field">
              <span className="ep-sr-only">Passcode from the school</span>
              <input
                className="ep-input ep-adm-pass__code"
                name="code"
                required
                minLength={8}
                maxLength={20}
                autoComplete="off"
                placeholder="ABCD-EFGH"
              />
            </label>
            <button className="ep-btn ep-btn--secondary ep-btn--sm" type="submit">
              Use passcode
            </button>
          </form>
        </div>
      ) : app.passUntil ? (
        <div
          className="ep-alert ep-alert--info"
          role="status"
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          Registrations are closed, and the school has opened this class for you until{' '}
          {dmy(app.passUntil)}: fill the form and pay the fee before then.
        </div>
      ) : null}
      {sp.resumed && app.status === 'draft' ? (
        <div className="ep-alert ep-alert--info ep-adm-resumed" role="status">
          <span>
            You already started this form for {app.class.name} on {dmy(app.createdAt)}: carry on
            here. Registering a different child?
          </span>
          <form action={startRegistration}>
            <input type="hidden" name="school" value={school} />
            <input type="hidden" name="cycleId" value={app.session.id} />
            <input type="hidden" name="classId" value={app.class.id} />
            <input type="hidden" name="another" value="1" />
            <button className="ep-btn ep-btn--secondary ep-btn--sm" type="submit">
              Register another child
            </button>
          </form>
        </div>
      ) : null}

      <nav className="ep-fb__views ep-adm-tabs" aria-label={w('Registration')}>
        {TABS.map(([k, label]) => (
          <a
            key={k}
            className="ep-fb__view"
            href={`/${school}/admission/application/${app.id}?tab=${k}`}
            aria-current={tab === k ? 'page' : undefined}
          >
            {w(label)}
            {k === 'payments' && app.feeDue + app.admissionFeeDue > 0 ? (
              <span className="ep-adm-tabs__due">
                {' '}
                · {rupees(app.feeDue + app.admissionFeeDue)}
              </span>
            ) : null}
          </a>
        ))}
      </nav>

      <div
        className="ep-adm-status"
        style={{ display: 'grid', gap: 'var(--sp-4)', marginBottom: 'var(--sp-4)' }}
      >
        {tab === 'overview' ? (
          <Card elevated title={w('Status')}>
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
              <ol
                className="ep-rs"
                aria-label="Admission steps"
                style={{ margin: 'var(--sp-3) 0' }}
              >
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
            {app.points ? (
              <div className="ep-adm-points">
                <p style={{ margin: 0 }}>
                  <strong>Merit points from the form: {app.points.total}</strong>{' '}
                  <span className="ep-kicker">
                    {app.points.confirmed
                      ? 'checked by the school'
                      : 'to be checked with the documents'}
                  </span>
                </p>
                {app.points.lines.length ? (
                  <ul className="ep-adm-points__lines">
                    {app.points.lines.map((l) => (
                      <li key={l.name}>
                        {l.name}: {l.points}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="ep-kicker">No criterion of this class gave points.</p>
                )}
              </div>
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
                {app.candidate ?? 'Your ward'} is offered admission.{' '}
                {app.offer.admissionFee > 0 ? (
                  <>
                    Pay the admission fee of <strong>{rupees(app.offer.admissionFee)}</strong>
                    {app.offer.expiresAt ? ` by ${dmy(app.offer.expiresAt)}` : ''}, here or at the
                    school office.
                  </>
                ) : (
                  'The school office will confirm the admission.'
                )}
              </div>
            ) : null}
            {app.admissionNo && ['fee_paid', 'admitted'].includes(app.status) ? (
              <p>
                Admission no. <strong>{app.admissionNo}</strong>.{' '}
                {app.status === 'admitted'
                  ? 'Use the parent app from now on: sign in with your mobile number or email.'
                  : 'The school will tell you the class-section before the session starts.'}
              </p>
            ) : null}
            {app.status === 'cancelled' ? (
              <p>
                Cancelled on {dmy(app.cancelledAt)}
                {app.cancelReason ? `: ${app.cancelReason}` : ''}.
              </p>
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
                Registered on {dmy(app.registeredAt)}. The school will write to you by email about
                the next steps; the form and the receipt were mailed to you.
              </p>
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
        ) : null}

        {tab === 'documents' ? (
          <Card elevated title={w('Documents')}>
            <div className="ep-table-wrap">
              <table className="ep-table">
                <caption className="ep-sr-only">Documents of this registration</caption>
                <thead>
                  <tr>
                    <th scope="col">{w('Document')}</th>
                    <th scope="col">{w('Date')}</th>
                    <th scope="col">
                      <span className="ep-sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {app.hasPdf ? (
                    <tr>
                      <td>{w('Registration form')}</td>
                      <td>{dmy(app.submittedAt)}</td>
                      <td>
                        <ViewDownload
                          href={`/api/admission/pdf/${app.id}`}
                          what="the registration form"
                        />
                      </td>
                    </tr>
                  ) : null}
                  {app.hasAdmissionForm ? (
                    <tr>
                      <td>
                        {w('Admission form')} ({app.admissionNo})
                      </td>
                      <td>-</td>
                      <td>
                        <ViewDownload
                          href={`/api/admission/admform/${app.id}`}
                          what="the admission form"
                        />
                      </td>
                    </tr>
                  ) : null}
                  {uploads.map((u) => (
                    <tr key={u.fileId}>
                      <td>{u.label}</td>
                      <td>-</td>
                      <td>
                        <ViewDownload href={`/api/admission/file/${u.fileId}`} what={u.label} />
                      </td>
                    </tr>
                  ))}
                  {!app.hasPdf && !app.hasAdmissionForm && !uploads.length ? (
                    <tr>
                      <td colSpan={3}>{w('No documents yet.')}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}
      </div>

      {tab === 'form' ? (
        <Card elevated title={editing ? w('Registration form') : w('Your answers')}>
          {editing ? (
            <AdmissionApplicationForm
              key={app.status}
              id={app.id}
              def={app.def}
              options={app.options}
              answers={app.answers}
              files={app.files}
              onlyFields={app.onlyFields}
              submitLabel={
                app.status === 'sent_back' ? 'Submit the corrections' : 'Submit the form'
              }
            />
          ) : (
            <AdmissionApplicationForm
              key={app.status}
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
      ) : null}

      {tab === 'payments' ? (
        <div className="ep-adm-status" style={{ display: 'grid', gap: 'var(--sp-4)' }}>
          <Card elevated title={w('What is due')}>
            {app.feeDue <= 0 && app.admissionFeeDue <= 0 ? (
              <p style={{ margin: 0 }}>{w('Nothing is due now.')}</p>
            ) : null}
            {app.locked && app.feeDue > 0 ? (
              <p style={{ margin: 0 }}>
                {w(
                  'Registrations are closed: the fee can be paid with a passcode from the school.',
                )}
              </p>
            ) : null}
            {app.feeDue > 0 && !app.locked ? (
              <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
                <p style={{ margin: 0 }}>
                  The form is submitted. Pay the registration fee of{' '}
                  <strong>{rupees(app.feeDue)}</strong> to get your registration number. You can
                  also pay at the school office.
                </p>
                <form
                  action="/api/admission/pay"
                  method="post"
                  style={{
                    display: 'flex',
                    gap: 'var(--sp-2)',
                    flexWrap: 'wrap',
                    alignItems: 'end',
                  }}
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
            {app.admissionFeeDue > 0 ? (
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
                  Pay the admission fee {rupees(app.admissionFeeDue)}
                </button>
              </form>
            ) : null}
          </Card>
          <Card elevated title={w('Receipts')}>
            {app.receipts.length ? (
              <div className="ep-table-wrap">
                <table className="ep-table">
                  <caption className="ep-sr-only">{w('Receipts')}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{w('Receipt')}</th>
                      <th scope="col">{w('Date')}</th>
                      <th scope="col">{w('Amount')}</th>
                      <th scope="col">
                        <span className="ep-sr-only">{w('Open')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {app.receipts.map((r) => (
                      <tr key={r.id}>
                        <td>
                          {r.head} receipt {r.receiptNo}
                          {r.status === 'reversed' ? <Badge tone="neutral"> reversed</Badge> : null}
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
            ) : (
              <p style={{ margin: 0 }}>{w('No payment yet.')}</p>
            )}
          </Card>
        </div>
      ) : null}
    </>
  );
}
