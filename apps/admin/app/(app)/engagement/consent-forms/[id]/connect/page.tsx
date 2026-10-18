import { Badge, Breadcrumbs, Card, PageHeader } from '@edupro/ui';
import { cookies } from 'next/headers';
import { ConfirmAction } from '@/components/ConfirmAction';
import { Notice } from '@/components/Notice';
import { Icon } from '@/components/nav-icons';
import type { ConsentForm } from '@/components/consents/types';
import {
  addConsentKey,
  addConsentWebhook,
  consentWebhookAction,
  revokeConsentKey,
  updateConsentWebhook,
} from '@/lib/consent-actions';
import { apiFetch, getMe } from '@/lib/api';

interface Overview {
  webhooks: Array<{
    id: string;
    url: string;
    events: string[];
    active: boolean;
    failed: number;
    pending: number;
    createdAt: string;
    createdBy: string | null;
  }>;
  deliveries: Array<{
    id: string;
    webhookId: string;
    event: string;
    status: 'pending' | 'delivered' | 'failed';
    attempts: number;
    lastStatus: number | null;
    lastError: string | null;
    createdAt: string;
    deliveredAt: string | null;
    nextAt: string;
    number: string | null;
  }>;
  keys: Array<{
    id: string;
    name: string;
    prefix: string;
    scope: 'read' | 'read_approve';
    expiresAt: string | null;
    lastUsedAt: string | null;
    uses: number;
    revokedAt: string | null;
    createdAt: string;
    createdBy: string | null;
  }>;
}
const EVENTS: Array<[string, string]> = [
  ['submitted', 'Answer submitted'],
  ['changed', 'Answer changed'],
  ['approved', 'Approved'],
  ['rejected', 'Not approved'],
  ['paid', 'Fee paid online'],
];
const OK: Record<string, string> = {
  webhook: 'The webhook is added. Copy its signing secret now: it is not shown again.',
  key: 'The API key is made. Copy it now: it is not shown again.',
  secret: 'A new signing secret is made: the old one is no longer used. Copy it now.',
  test: 'A test message is queued; it goes out within a minute.',
  retry: 'The message will be sent again within a minute.',
  remove: 'The webhook is removed.',
  revoked: 'The key is revoked: it stops working at once.',
  saved: 'Saved.',
};
const when = (s: string | null) =>
  s ? new Date(s).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—';

/**
 * Connecting a consent form to other systems (docs/design/28-consent-forms.md part 4; school admin):
 * webhooks with their deliveries, and API keys. A secret or key is shown once, right after it is made.
 */
export default async function ConsentConnectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await getMe();
  const may = me.permissions.includes('engagement.consent_form.integrate');
  const [f, o] = await Promise.all([
    apiFetch<ConsentForm>(`/engagement/consent-forms/${id}`),
    may
      ? apiFetch<Overview>(`/engagement/consent-forms/${id}/integrations`)
      : Promise.resolve(null),
  ]);
  // a secret or key just made is in a one-minute HttpOnly cookie (never in the address)
  const raw = sp.ok ? (await cookies()).get('cf_once')?.value : undefined;
  const shown = raw ? (JSON.parse(raw) as { label: string; value: string }) : null;
  const apiBase = `${process.env.API_PUBLIC_URL ?? process.env.API_BASE_URL ?? 'http://localhost:4000'}/api/v1/consent-api/v1`;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Consent forms', href: '/engagement/consent-forms' },
          { label: f.title, href: `/engagement/consent-forms/${id}` },
          { label: 'Connect' },
        ]}
      />
      <PageHeader
        kicker="Connect to other systems"
        title={f.title}
        description="Send each answer to another system as it happens (webhook), or let a system read the answers with an API key. Only the answers go out: no files, no other details of the pupil."
      />
      <Notice params={{ ...sp, detail: sp.ok ? (OK[sp.ok] ?? 'Done.') : sp.detail }} />
      {!may || !o ? (
        <Card>Only the school admin connects forms to other systems.</Card>
      ) : (
        <>
          {shown ? (
            <Card title={shown.label} style={{ marginBottom: 'var(--sp-4)' }}>
              <label className="ep-field" htmlFor="once">
                <span className="ep-field__label">Copy it now; it will not be shown again</span>
                <input id="once" className="ep-input" readOnly value={shown.value} />
              </label>
            </Card>
          ) : null}

          <Card title="Webhooks" style={{ marginBottom: 'var(--sp-4)' }}>
            {o.webhooks.length === 0 ? (
              <p className="ep-field__help" style={{ marginTop: 0 }}>
                No webhook yet.
              </p>
            ) : (
              <div className="ep-cf-list" style={{ marginBottom: 'var(--sp-4)' }}>
                {o.webhooks.map((w) => (
                  <article key={w.id} className="ep-cf-item">
                    <div className="ep-cf-item__top">
                      <strong style={{ wordBreak: 'break-all' }}>{w.url}</strong>
                      <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
                        <Badge tone={w.active ? 'success' : 'neutral'}>
                          {w.active ? 'On' : 'Off'}
                        </Badge>
                        {w.failed ? <Badge tone="danger">{w.failed} failed</Badge> : null}
                        {w.pending ? <Badge tone="warning">{w.pending} waiting</Badge> : null}
                      </span>
                    </div>
                    <p className="ep-field__help" style={{ margin: 0 }}>
                      {w.events.map((e) => EVENTS.find((x) => x[0] === e)?.[1] ?? e).join(', ')}
                      {w.createdBy ? ` · added by ${w.createdBy}` : ''}
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
                      <form action={updateConsentWebhook}>
                        <input type="hidden" name="id" value={id} />
                        <input type="hidden" name="hookId" value={w.id} />
                        <input type="hidden" name="active" value={w.active ? 'false' : 'true'} />
                        <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                          <Icon name={w.active ? 'lock' : 'unlock'} size={16} />{' '}
                          {w.active ? 'Switch off' : 'Switch on'}
                        </button>
                      </form>
                      <form action={consentWebhookAction}>
                        <input type="hidden" name="id" value={id} />
                        <input type="hidden" name="hookId" value={w.id} />
                        <input type="hidden" name="what" value="test" />
                        <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                          <Icon name="send" size={16} /> Send a test
                        </button>
                      </form>
                      <ConfirmAction
                        action={consentWebhookAction}
                        fields={{ id, hookId: w.id, what: 'secret' }}
                        label="New signing secret"
                        title="Make a new signing secret?"
                        confirmLabel="Make a new secret"
                      >
                        The old secret stops being used at once: give the new one to the other
                        system.
                      </ConfirmAction>
                      <ConfirmAction
                        action={consentWebhookAction}
                        fields={{ id, hookId: w.id, what: 'remove' }}
                        label="Remove"
                        title="Remove this webhook?"
                        confirmLabel="Remove"
                        variant="danger"
                        confirmVariant="danger"
                      >
                        No more messages go to this address. Messages waiting are dropped.
                      </ConfirmAction>
                    </div>
                  </article>
                ))}
              </div>
            )}
            <form action={addConsentWebhook} className="ep-cfb">
              <input type="hidden" name="id" value={id} />
              <label className="ep-field" htmlFor="wh-url">
                <span className="ep-field__label">Address (https)</span>
                <input
                  id="wh-url"
                  name="url"
                  type="url"
                  className="ep-input"
                  required
                  maxLength={500}
                  placeholder="https://example.com/edupro-consents"
                />
              </label>
              <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="ep-field__label">Send when</legend>
                <div className="ep-cf__options">
                  {EVENTS.map(([v, l]) => (
                    <label key={v} className="ep-check">
                      <input
                        type="checkbox"
                        className="ep-check__input"
                        name="events"
                        value={v}
                        defaultChecked
                      />
                      <span className="ep-check__box" aria-hidden="true" />
                      <span className="ep-check__text">{l}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div>
                <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                  <Icon name="plus" size={16} /> Add webhook
                </button>
              </div>
            </form>
          </Card>

          {o.deliveries.length ? (
            <Card title="Messages sent (last 50)" style={{ marginBottom: 'var(--sp-4)' }}>
              <div className="ep-table-wrap">
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">Webhook messages</caption>
                  <thead>
                    <tr>
                      <th scope="col">Event</th>
                      <th scope="col">Answer</th>
                      <th scope="col">Status</th>
                      <th scope="col">Tries</th>
                      <th scope="col">Last answer</th>
                      <th scope="col">Queued</th>
                      <th scope="col">Again</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.deliveries.map((d) => (
                      <tr key={d.id}>
                        <td>{EVENTS.find((x) => x[0] === d.event)?.[1] ?? d.event}</td>
                        <td>{d.number ?? '—'}</td>
                        <td>
                          <Badge
                            tone={
                              d.status === 'delivered'
                                ? 'success'
                                : d.status === 'failed'
                                  ? 'danger'
                                  : 'warning'
                            }
                          >
                            {d.status === 'delivered'
                              ? 'Delivered'
                              : d.status === 'failed'
                                ? 'Failed'
                                : `Waiting (next ${when(d.nextAt)})`}
                          </Badge>
                        </td>
                        <td>{d.attempts}</td>
                        <td>{d.lastError ?? (d.lastStatus ? `HTTP ${d.lastStatus}` : '—')}</td>
                        <td>{when(d.createdAt)}</td>
                        <td>
                          {d.status !== 'delivered' ? (
                            <form action={consentWebhookAction}>
                              <input type="hidden" name="id" value={id} />
                              <input type="hidden" name="deliveryId" value={d.id} />
                              <input type="hidden" name="what" value="retry" />
                              <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                                <Icon name="refresh" size={16} /> Send again
                              </button>
                            </form>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}

          <Card title="API keys" style={{ marginBottom: 'var(--sp-4)' }}>
            {o.keys.length ? (
              <div className="ep-table-wrap" style={{ marginBottom: 'var(--sp-4)' }}>
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">API keys</caption>
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Key</th>
                      <th scope="col">May</th>
                      <th scope="col">Until</th>
                      <th scope="col">Last used</th>
                      <th scope="col">Calls</th>
                      <th scope="col">Revoke</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.keys.map((k) => (
                      <tr key={k.id}>
                        <td>{k.name}</td>
                        <td>
                          <code>{k.prefix}…</code>
                        </td>
                        <td>{k.scope === 'read' ? 'Read' : 'Read and approve'}</td>
                        <td>{k.expiresAt ? when(k.expiresAt) : 'No end'}</td>
                        <td>{when(k.lastUsedAt)}</td>
                        <td>{k.uses}</td>
                        <td>
                          {k.revokedAt ? (
                            <Badge tone="neutral">Revoked</Badge>
                          ) : (
                            <ConfirmAction
                              action={revokeConsentKey}
                              fields={{ id, keyId: k.id }}
                              label="Revoke"
                              title={`Revoke the key of ${k.name}?`}
                              confirmLabel="Revoke"
                              variant="danger"
                              confirmVariant="danger"
                            >
                              The key stops working at once. This cannot be undone; make a new key
                              if needed.
                            </ConfirmAction>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <form action={addConsentKey} className="ep-filter-band">
              <input type="hidden" name="id" value={id} />
              <label className="ep-field" htmlFor="key-name">
                <span className="ep-field__label">Who uses it</span>
                <input
                  id="key-name"
                  name="name"
                  className="ep-input"
                  required
                  minLength={2}
                  maxLength={80}
                />
              </label>
              <label className="ep-field" htmlFor="key-scope">
                <span className="ep-field__label">May</span>
                <select id="key-scope" name="scope" className="ep-select" defaultValue="read">
                  <option value="read">Read the answers</option>
                  <option value="read_approve">Read, approve and reject</option>
                </select>
              </label>
              <label className="ep-field" htmlFor="key-until">
                <span className="ep-field__label">Valid until (optional)</span>
                <input id="key-until" name="expiresOn" type="date" className="ep-input" />
              </label>
              <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                <Icon name="key" size={16} /> Make a key
              </button>
            </form>
          </Card>

          <Card title="For the developers of the other system">
            <p style={{ marginTop: 0 }}>
              <strong>Webhook</strong>: a POST of JSON (the event, the form, the answer) with the
              headers <code>X-EduPro-Event</code>, <code>X-EduPro-Delivery</code>,{' '}
              <code>X-EduPro-Timestamp</code> and <code>X-EduPro-Signature</code> ={' '}
              <code>sha256=</code>HMAC-SHA256 of <code>timestamp + &quot;.&quot; + body</code> with
              the signing secret. Answer 2xx within ten seconds; otherwise it is tried again after
              1, 5, 30 and 120 minutes.
            </p>
            <p style={{ marginBottom: 0 }}>
              <strong>API</strong> (header <code>Authorization: Bearer cfk_…</code>, 60 calls a
              minute): <code>GET {apiBase}/responses?since=&amp;page=</code>,{' '}
              <code>GET …/responses/&lt;number&gt;</code>,{' '}
              <code>POST …/responses/&lt;number&gt;/decision</code> with{' '}
              <code>{'{"decision":"approved"|"rejected","note":"…"}'}</code> (keys that may
              approve).
            </p>
          </Card>
        </>
      )}
    </>
  );
}
