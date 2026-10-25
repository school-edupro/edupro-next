import { Badge, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { EnquiryFields } from '@/components/admissions/EnquiryFields';
import { Notice } from '@/components/Notice';
import { REG_STATUS, dmy } from '@/lib/admission-desk';
import {
  ENQUIRY_STATUS,
  MODE_LABEL,
  type EnquiryDetail,
  type EnquiryMeta,
} from '@/lib/admission-enquiry';
import {
  addFollowUp,
  inviteEnquiry,
  replyEnquiry,
  updateEnquiry,
} from '@/lib/admission-enquiry-actions';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { whenIst } from '@/lib/admission-process';

/** One enquiry: follow-ups, the invitation to register, its details (docs/design/39, part 8). */
export default async function EnquiryPage({
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
  if (!me.permissions.includes('admissions.enquiry.manage')) notFound();
  const [e, meta] = await Promise.all([
    apiFetch<EnquiryDetail>(`/admissions/enquiries/${id}`).catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 404) notFound();
      throw err;
    }),
    apiFetch<EnquiryMeta>('/admissions/enquiries/meta'),
  ]);
  const st = ENQUIRY_STATUS[e.status] ?? { label: e.status, tone: 'neutral' as const };
  const open = ['new', 'follow_up', 'interested'].includes(e.status);
  const tomorrow = new Date(Date.now() + 86400000 + 330 * 60_000).toISOString().slice(0, 10);
  return (
    <>
      <PageHeader
        kicker={`Admissions · Enquiry${e.number ? ` ${e.number}` : ''}`}
        title={e.parentName}
        description={[e.childName, e.mobile, e.email].filter(Boolean).join(' · ')}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/admissions/enquiries">
            Enquiries
          </a>
        }
      />
      <Notice params={sp} />
      <div className="ep-rp">
        <Card elevated title="Follow-up">
          <p style={{ marginTop: 0 }}>
            <Badge tone={st.tone}>{st.label}</Badge>
            {e.nextFollowUpOn && open ? (
              <span className="ep-kicker"> · next on {dmy(e.nextFollowUpOn)}</span>
            ) : null}
            {e.fromWebsite ? <span className="ep-kicker"> · from the website</span> : null}
          </p>
          {e.application ? (
            <p>
              Registered:{' '}
              <a href={`/admissions/registrations/${e.application.id}`}>
                {e.application.number ?? 'form started'}
              </a>{' '}
              ({REG_STATUS[e.application.status]?.label ?? e.application.status})
            </p>
          ) : null}
          <form action={addFollowUp} className="ep-rp__act">
            <input type="hidden" name="id" value={e.id} />
            <div className="ep-rp__row">
              <label className="ep-field">
                <span className="ep-field__label">How</span>
                <select className="ep-select" name="mode" defaultValue="call">
                  <option value="call">Call</option>
                  <option value="visit">Visit</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="sms">SMS</option>
                  <option value="email">Email</option>
                  <option value="note">Note</option>
                </select>
              </label>
              <label className="ep-field">
                <span className="ep-field__label">Status after</span>
                <select className="ep-select" name="status" defaultValue="">
                  <option value="">Keep</option>
                  <option value="follow_up">Following up</option>
                  <option value="interested">Interested</option>
                  <option value="not_interested">Not interested</option>
                  <option value="closed">Close</option>
                </select>
              </label>
              <label className="ep-field">
                <span className="ep-field__label">Next follow-up</span>
                <input className="ep-input" type="date" name="nextOn" defaultValue={tomorrow} />
              </label>
            </div>
            <label className="ep-field">
              <span className="ep-field__label">What happened</span>
              <textarea
                className="ep-input"
                name="outcome"
                rows={2}
                required
                minLength={2}
                maxLength={1000}
              />
            </label>
            <div className="ep-form-actions">
              <button className="ep-btn ep-btn--primary" type="submit">
                Save the follow-up
              </button>
            </div>
          </form>
        </Card>
        <Card elevated title="Reply to family">
          <form action={replyEnquiry} className="ep-rp__act">
            <input type="hidden" name="id" value={e.id} />
            <label className="ep-field">
              <span className="ep-field__label">Message *</span>
              <textarea
                className="ep-input"
                name="message"
                rows={4}
                minLength={2}
                maxLength={1000}
                required
              />
              <span className="ep-field__help">
                Goes with the enquiry number{e.number ? ` ${e.number}` : ''}; it is kept in the
                history below.
              </span>
            </label>
            <fieldset className="ep-cl">
              <legend className="ep-field__label">Send by</legend>
              <label className="ep-check">
                <input
                  type="checkbox"
                  name="byEmail"
                  defaultChecked={Boolean(e.email)}
                  disabled={!e.email}
                />{' '}
                Email{e.email ? ` (${e.email})` : ': no email given'}
              </label>
              <label className="ep-check">
                <input
                  type="checkbox"
                  name="byMobile"
                  defaultChecked={Boolean(e.mobile)}
                  disabled={!e.mobile}
                />{' '}
                SMS / WhatsApp{e.mobile ? ` (${e.mobile})` : ': no mobile given'}
              </label>
            </fieldset>
            <div className="ep-form-actions">
              <button className="ep-btn ep-btn--primary" type="submit">
                Send the reply
              </button>
            </div>
          </form>
        </Card>
      </div>
      <div className="ep-rp">
        <Card elevated title="Invite to register">
          {e.application ? (
            <p style={{ margin: 0 }}>The family has registered.</p>
          ) : (
            <form action={inviteEnquiry} className="ep-rp__act">
              <input type="hidden" name="id" value={e.id} />
              <p style={{ margin: 0 }}>
                Sends a link to {[e.mobile, e.email].filter(Boolean).join(' and ')} (email, and SMS
                / WhatsApp where the school has the templates). The form starts with the
                child&apos;s name and date of birth; the registration counts for this enquiry.
                {e.invitedAt ? ` Last invited ${dmy(e.invitedAt)}.` : ''}
              </p>
              <label className="ep-field">
                <span className="ep-field__label">Session</span>
                <select className="ep-select" name="cycleId" defaultValue={e.cycleId ?? ''}>
                  <option value="">The open one</option>
                  {meta.cycles
                    .filter((c) => c.status === 'open')
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="ep-field">
                <span className="ep-field__label">
                  Own message (the link is added in the email)
                </span>
                <textarea className="ep-input" name="message" rows={2} maxLength={500} />
              </label>
              <div className="ep-form-actions">
                <button className="ep-btn ep-btn--secondary" type="submit">
                  {e.invitedAt ? 'Invite again' : 'Send the invitation'}
                </button>
              </div>
            </form>
          )}
        </Card>
      </div>
      <div className="ep-rp">
        <Card elevated title="History">
          {e.followups.length === 0 ? <p style={{ margin: 0 }}>No follow-up yet.</p> : null}
          <ul className="ep-rp__events">
            {e.followups.map((f) => (
              <li key={f.id}>
                <strong>{MODE_LABEL[f.mode] ?? f.mode}:</strong> {f.outcome}
                {f.statusAfter ? ` (${ENQUIRY_STATUS[f.statusAfter]?.label ?? f.statusAfter})` : ''}
                <div className="ep-kicker">
                  {f.by ?? 'System'} · {whenIst(f.at)}
                  {f.nextOn ? ` · next ${dmy(f.nextOn)}` : ''}
                </div>
              </li>
            ))}
            <li>
              Enquiry received
              <div className="ep-kicker">
                {e.createdBy ?? (e.fromWebsite ? 'Website' : '')} · {whenIst(e.createdAt)}
              </div>
            </li>
          </ul>
        </Card>
      </div>
      <div className="ep-rp">
        <Card elevated title="Details">
          <form action={updateEnquiry} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            <input type="hidden" name="id" value={e.id} />
            <EnquiryFields meta={meta} value={e} />
            <div className="ep-form-actions">
              <button className="ep-btn ep-btn--secondary" type="submit">
                Save the details
              </button>
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}
