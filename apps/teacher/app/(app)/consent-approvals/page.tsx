import { Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { decideConsent } from '../consents/actions';

interface Item {
  stepId: string;
  level: string;
  form: string;
  number: string;
  about: string;
  admissionNo: string | null;
  section: string | null;
  byUser: string | null;
  signedAt: string;
  fee: string;
  answers: Array<{ label: string; value: string }>;
}

/**
 * Consent form answers waiting for my decision (docs/design/28-consent-forms.md): the class teacher of
 * the pupil, or the role or person named on the form's level. The last level raises the fee and tells the
 * family.
 */
export default async function ConsentApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  let data: Item[];
  try {
    data = (await bff.api.fetch<{ data: Item[] }>('/engagement/mine/consent-approvals')).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    throw error;
  }
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: '52rem', margin: '0 auto' }}>
      <p style={{ margin: '0 0 var(--sp-2)' }}>
        <a href="/" style={{ textDecoration: 'underline' }}>
          ← Home
        </a>
      </p>
      <PageHeader
        kicker="EduPro staff"
        title="Answers to approve"
        description="Consent form answers from families (and staff) waiting for your decision."
      />
      {sp.ok ? (
        <p className="ep-alert ep-alert--success" role="status">
          {sp.ok === 'rejected' ? 'Not approved: the family is told.' : 'Approved.'}
        </p>
      ) : null}
      {sp.error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {sp.detail || 'That did not work. Please try again.'}
        </p>
      ) : null}
      {data.length === 0 ? (
        <Card>Nothing waits for you.</Card>
      ) : (
        <div className="ep-cf-list">
          {data.map((x) => (
            <article key={x.stepId} className="ep-cf-item">
              <div className="ep-cf-item__top">
                <h2 className="ep-cf-item__title">{x.form}</h2>
                <span className="ep-field__help">
                  {x.number} · {x.level}
                </span>
              </div>
              <p style={{ margin: 0 }}>
                <strong>{x.about}</strong>
                {x.admissionNo ? ` (${x.admissionNo})` : ''}
                {x.section ? ` · ${x.section}` : ''}
                {x.byUser ? ` · answered by ${x.byUser}` : ''}
                {Number(x.fee) > 0 ? ` · fee ₹${Number(x.fee).toLocaleString('en-IN')}` : ''}
              </p>
              <dl className="ep-cf__answers">
                {x.answers.map((a, i) => (
                  <div key={i} style={{ display: 'contents' }}>
                    <dt>{a.label}</dt>
                    <dd>{a.value || '—'}</dd>
                  </div>
                ))}
              </dl>
              <div className="ep-cf-item__who">
                <form
                  action={decideConsent}
                  style={{
                    display: 'flex',
                    gap: 'var(--sp-2)',
                    alignItems: 'end',
                    flexWrap: 'wrap',
                  }}
                >
                  <input type="hidden" name="stepId" value={x.stepId} />
                  <input type="hidden" name="decision" value="approved" />
                  <label className="ep-field" htmlFor={`note-${x.stepId}`}>
                    <span className="ep-field__label">Note to the family (optional)</span>
                    <input
                      id={`note-${x.stepId}`}
                      name="note"
                      className="ep-input"
                      maxLength={500}
                    />
                  </label>
                  <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                    Approve
                  </button>
                </form>
                <form
                  action={decideConsent}
                  style={{
                    display: 'flex',
                    gap: 'var(--sp-2)',
                    alignItems: 'end',
                    flexWrap: 'wrap',
                  }}
                >
                  <input type="hidden" name="stepId" value={x.stepId} />
                  <input type="hidden" name="decision" value="rejected" />
                  <label className="ep-field" htmlFor={`why-${x.stepId}`}>
                    <span className="ep-field__label">Why not</span>
                    <input
                      id={`why-${x.stepId}`}
                      name="note"
                      className="ep-input"
                      maxLength={500}
                      required
                    />
                  </label>
                  <button type="submit" className="ep-btn ep-btn--danger ep-btn--sm">
                    Do not approve
                  </button>
                </form>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
