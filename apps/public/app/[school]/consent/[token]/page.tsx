import { Badge, Card, ConsentFill, PageHeader } from '@edupro/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ConsentSignIn } from '@/components/ConsentSignIn';
import { editOnLink, respondOnLink } from './actions';
import { PublicApiError } from '@/lib/api';
import { consentFetch, SCHOOL_RE, TOKEN_RE, type ConsentInfo, type ConsentMe } from '@/lib/consent';

export const metadata: Metadata = { title: 'Consent form', robots: { index: false } };
const dt = (s: string) => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)} ${s.slice(11, 16)}`;

/**
 * A consent form on its public link or QR (docs/design/28-consent-forms.md, part 3): sign in with a
 * one-time code (a family by admission number, an outsider by mobile or email), then answer, see,
 * change (until the edit date), print and, for a family, pay the fee.
 */
export default async function PublicConsentPage({
  params,
  searchParams,
}: {
  params: Promise<{ school: string; token: string }>;
  searchParams: Promise<{
    done?: string;
    msg?: string;
    waiting?: string;
    fee?: string;
    changed?: string;
    paid?: string;
    edit?: string;
    error?: string;
  }>;
}) {
  const { school, token } = await params;
  const sp = await searchParams;
  if (!SCHOOL_RE.test(school) || !TOKEN_RE.test(token)) notFound();
  let info: ConsentInfo;
  try {
    info = await consentFetch<ConsentInfo>(school, token, '', {}, null);
  } catch (error) {
    if (error instanceof PublicApiError && error.status === 404)
      return (
        <Card title="This link is not valid">
          The form may have been closed, or the school has made a new link. Please ask the school.
        </Card>
      );
    throw error;
  }
  let me: ConsentMe | null = null;
  try {
    me = await consentFetch<ConsentMe>(school, token, '/me');
  } catch (error) {
    if (!(error instanceof PublicApiError)) throw error;
  }
  const editing =
    me && sp.edit && /^\d+$/.test(sp.edit)
      ? await consentFetch<{
          id: string;
          number: string;
          answers: Record<string, string | number | boolean | string[] | null>;
          signedName: string | null;
          signed: string[] | null;
        }>(school, token, `/responses/${sp.edit}`).catch(() => null)
      : null;
  const self = `/${school}/consent/${token}`;
  const hidden = { school, token };
  return (
    <>
      <PageHeader kicker={info.school} title={info.title} />
      {info.description ? (
        <p style={{ whiteSpace: 'pre-wrap', marginTop: 0 }}>{info.description}</p>
      ) : null}
      {info.closesAt && info.open ? (
        <p className="ep-field__help">Open until {dt(info.closesAt)}.</p>
      ) : null}
      {sp.error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {sp.error}
        </p>
      ) : null}
      {sp.done ? (
        <p className="ep-alert ep-alert--success" role="status">
          Thank you. Your answer is saved as {sp.done}.{sp.msg ? ` ${sp.msg}` : ''}
          {sp.waiting ? ' The school will approve it and tell you.' : ''}
          {sp.fee && !sp.waiting ? ` A fee of ₹${sp.fee} is now due: pay it below.` : ''}
        </p>
      ) : null}
      {sp.changed ? (
        <p className="ep-alert ep-alert--success" role="status">
          Your answer {sp.changed} is changed.
        </p>
      ) : null}
      {sp.paid === '1' ? (
        <p className="ep-alert ep-alert--success" role="status">
          Payment received. Thank you.
        </p>
      ) : sp.paid ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          The payment did not go through ({sp.paid}). You can try again.
        </p>
      ) : null}

      {!me ? (
        info.open || info.families || info.outsiders ? (
          <Card title={info.open ? 'Answer the form' : 'See your answer'}>
            {!info.open ? (
              <p style={{ marginTop: 0 }}>
                The form is {info.closedWhy ?? 'closed'}; sign in to see what you answered.
              </p>
            ) : null}
            <ConsentSignIn
              school={school}
              token={token}
              families={info.families}
              outsiders={info.outsiders}
            />
          </Card>
        ) : null
      ) : (
        <>
          <Card style={{ marginBottom: 'var(--sp-4)' }}>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                gap: 'var(--sp-2)',
              }}
            >
              <span>
                <strong>{me.about.name}</strong>
                {me.about.section ? ` · ${me.about.section}` : ''}
                <span className="ep-field__help"> · signed in with {me.address}</span>
              </span>
              <form method="post" action={`/api/consent/logout?to=${encodeURIComponent(self)}`}>
                <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                  Sign out
                </button>
              </form>
            </div>
            {me.responses.map((r) => {
              const due = r.lineId ? Number(r.lineAmount ?? 0) - Number(r.paid ?? 0) : 0;
              return (
                <div
                  key={r.id}
                  className="ep-cf-item__who"
                  style={{ marginTop: 'var(--sp-3)', justifyContent: 'flex-start' }}
                >
                  <span>{r.number}</span>
                  {r.waiting ? (
                    <Badge tone="warning">Waiting for approval</Badge>
                  ) : r.status === 'approved' ? (
                    <Badge tone="success">Approved</Badge>
                  ) : r.status === 'rejected' ? (
                    <Badge tone="danger">Not approved</Badge>
                  ) : (
                    <Badge tone="info">Answered</Badge>
                  )}
                  {r.decidedNote ? <span className="ep-field__help">{r.decidedNote}</span> : null}
                  {Number(r.fee) > 0 ? (
                    <span className="ep-field__help">
                      Fee ₹{Number(r.fee).toLocaleString('en-IN')}
                      {r.lineId
                        ? due > 0
                          ? ''
                          : ' · paid'
                        : r.status === 'rejected'
                          ? ''
                          : ' · after approval'}
                    </span>
                  ) : null}
                  <a
                    href={`/api/consent/pdf?school=${school}&token=${token}&rid=${r.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ textDecoration: 'underline' }}
                  >
                    Print / PDF
                  </a>
                  {r.canEdit ? (
                    <a href={`${self}?edit=${r.id}`} style={{ textDecoration: 'underline' }}>
                      Change my answer
                    </a>
                  ) : null}
                  {r.lineId && due > 0 ? (
                    <form method="post" action="/api/consent/pay">
                      <input type="hidden" name="school" value={school} />
                      <input type="hidden" name="token" value={token} />
                      <input type="hidden" name="rid" value={r.id} />
                      {info.gateways.length > 1 ? (
                        <select className="ep-select" name="gatewayId" aria-label="Pay through">
                          {info.gateways.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.label}
                            </option>
                          ))}
                        </select>
                      ) : null}
                      <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                        Pay ₹{due.toLocaleString('en-IN')}
                      </button>
                    </form>
                  ) : null}
                </div>
              );
            })}
          </Card>
          {editing ? (
            <Card title={`Change your answer ${editing.number}`}>
              <ConsentFill
                fields={info.fields}
                lists={info.lists}
                action={editOnLink}
                hidden={{ ...hidden, responseId: editing.id }}
                initial={Object.fromEntries(
                  Object.entries(editing.answers).filter(
                    ([k]) =>
                      !['signature', 'file'].includes(
                        info.fields.find((x) => x.key === k)?.type ?? '',
                      ),
                  ),
                )}
                keep={{
                  signatures: editing.signed ?? [],
                  files: info.fields
                    .filter((x) => x.type === 'file' && Array.isArray(editing.answers[x.key]))
                    .map((x) => x.key),
                }}
                fee={me.mode === 'family' ? info.fee : undefined}
                askName={{ label: 'Your name', defaultValue: editing.signedName ?? '' }}
                submitLabel="Save the change"
              />
            </Card>
          ) : me.canAnswer ? (
            <Card title={me.responses.length ? 'Answer again' : 'Your answer'}>
              <ConsentFill
                fields={info.fields}
                lists={info.lists}
                action={respondOnLink}
                hidden={hidden}
                fee={me.mode === 'family' ? info.fee : undefined}
                feeNote={info.approval ? 'to pay after the school approves' : 'due once you submit'}
                askName={{
                  label: me.mode === 'family' ? 'Your name (as the parent signing)' : 'Your name',
                  defaultValue: me.mode === 'outsider' ? me.about.name : '',
                }}
              />
            </Card>
          ) : !me.responses.length ? (
            <Card>The form is {info.closedWhy ?? 'closed'}.</Card>
          ) : null}
        </>
      )}
    </>
  );
}
