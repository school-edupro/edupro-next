import { Badge, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { DeskForm } from '@/components/admissions/DeskForm';
import { ViewDownload } from '@/components/admissions/ViewDownload';
import { Notice } from '@/components/Notice';
import { REG_STATUS, dmy, rupees, type RegistrationForm } from '@/lib/admission-desk';
import { ApiError, apiFetch, getMe } from '@/lib/api';

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
            // only Accounts take money, at Fees → Cashier (docs/design/55)
            <p className="ep-alert ep-alert--info" style={{ margin: 0 }}>
              Registration fee due: <strong>{rupees(app.feeDue)}</strong>. Send the family to the
              fee counter: Accounts collect it at Fees → Cashier → Admission fees, and the
              registration number comes with the receipt.
            </p>
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
          canAllowDuplicate={me.permissions.includes('admissions.setup.manage')}
        />
      </Card>
    </>
  );
}
