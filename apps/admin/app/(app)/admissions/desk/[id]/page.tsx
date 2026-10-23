import { Badge, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { DeskForm } from '@/components/admissions/DeskForm';
import { Notice } from '@/components/Notice';
import { collectRegistrationFee } from '@/lib/admission-desk-actions';
import { REG_STATUS, dmy, rupees, type RegistrationForm } from '@/lib/admission-desk';
import { ApiError, apiFetch, getMe } from '@/lib/api';

const ICON = {
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  down: 'M12 4v11m0 0-4-4m4 4 4-4M5 20h14',
};
const Svg = ({ d }: { d: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d={d}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const ViewDownload = ({ href, what }: { href: string; what: string }) => (
  <span style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}>
    <a
      className="ep-btn ep-btn--ghost ep-btn--sm"
      href={href}
      target="_blank"
      rel="noopener"
      aria-label={`View ${what}`}
      title="View"
    >
      <Svg d={ICON.eye} />
    </a>
    <a
      className="ep-btn ep-btn--ghost ep-btn--sm"
      href={`${href}?save=1`}
      aria-label={`Download ${what}`}
      title="Download"
    >
      <Svg d={ICON.down} />
    </a>
  </span>
);

/** One registration at the desk (docs/design/39, part 3): the form, the counter fee, the PDFs. */
export default async function DeskRegistrationPage({
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
  const app = await apiFetch<RegistrationForm>(`/admissions/applications/${id}/form`).catch(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    },
  );
  const st = REG_STATUS[app.status] ?? { label: app.status, tone: 'neutral' as const };
  const editing = app.status === 'draft' || (app.status === 'submitted' && !app.number);
  const canCollect = me.permissions.includes('admissions.fee.collect');
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
            : 'No registration number yet: it is given when the registration fee is paid.'
        }
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/admissions/desk">
              Admission desk
            </a>
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={`/admissions/applications/${app.id}`}
            >
              Application
            </a>
          </span>
        }
      />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
          gap: 'var(--sp-4)',
          marginBottom: 'var(--sp-4)',
        }}
      >
        <Card elevated title="Status">
          <p style={{ marginTop: 0 }}>
            <Badge tone={st.tone}>{st.label}</Badge>
            {app.category ? <span className="ep-kicker"> · Category {app.category}</span> : null}
            {app.enteredByOffice ? <span className="ep-kicker"> · Filled at the desk</span> : null}
          </p>
          {app.status === 'draft' ? (
            <p>{app.progress}% of the form is filled; each tab is saved on Next.</p>
          ) : null}
          {app.feeDue > 0 ? (
            canCollect ? (
              <form action={collectRegistrationFee} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
                <input type="hidden" name="id" value={app.id} />
                <p style={{ margin: 0 }}>
                  Registration fee due: <strong>{rupees(app.feeDue)}</strong>
                </p>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
                    gap: 'var(--sp-3)',
                  }}
                >
                  <label className="ep-field">
                    <span className="ep-field__label">Mode</span>
                    <select className="ep-select" name="mode" defaultValue="cash">
                      <option value="cash">Cash</option>
                      <option value="upi">UPI</option>
                      <option value="card">Card</option>
                      <option value="cheque">Cheque</option>
                      <option value="dd">Demand draft</option>
                      <option value="bank">Bank transfer</option>
                    </select>
                  </label>
                  <label className="ep-field">
                    <span className="ep-field__label">Reference (UPI / card / transfer)</span>
                    <input className="ep-input" name="reference" maxLength={80} />
                  </label>
                  <label className="ep-field">
                    <span className="ep-field__label">Cheque / DD no.</span>
                    <input className="ep-input" name="instrumentNo" maxLength={40} />
                  </label>
                  <label className="ep-field">
                    <span className="ep-field__label">Bank</span>
                    <input className="ep-input" name="bankName" maxLength={80} />
                  </label>
                </div>
                <div>
                  <button className="ep-btn ep-btn--primary" type="submit">
                    Take {rupees(app.feeDue)} and register
                  </button>
                </div>
              </form>
            ) : (
              <p>Registration fee due: {rupees(app.feeDue)}. The fee counter takes it.</p>
            )
          ) : null}
        </Card>
        <Card elevated title="Documents">
          {!app.hasPdf && app.receipts.length === 0 ? (
            <p style={{ margin: 0 }}>
              The form PDF and the receipts show here once the form is submitted.
            </p>
          ) : (
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
                          href={`/api/admission-desk/form/${app.id}`}
                          what="the registration form"
                        />
                      </td>
                    </tr>
                  ) : null}
                  {app.receipts.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {r.head} {r.receiptNo}
                        <div className="ep-kicker">{r.mode}</div>
                      </td>
                      <td>{dmy(r.date)}</td>
                      <td>{rupees(r.amount)}</td>
                      <td>
                        <ViewDownload
                          href={`/api/admission-desk/receipt/${r.id}`}
                          what={`receipt ${r.receiptNo}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      <Card elevated title={editing ? 'Registration form' : 'Answers'}>
        <DeskForm
          id={app.id}
          def={app.def}
          options={app.options}
          answers={app.answers}
          files={app.files}
          readOnly={!editing || !me.permissions.includes('admissions.application.enter')}
        />
      </Card>
    </>
  );
}
