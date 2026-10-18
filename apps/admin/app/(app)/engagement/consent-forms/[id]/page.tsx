import { Badge, Breadcrumbs, Card, KpiTile, PageHeader } from '@edupro/ui';
import { ConfirmAction } from '@/components/ConfirmAction';
import { Notice } from '@/components/Notice';
import { Icon } from '@/components/nav-icons';
import { Pager } from '@/components/RegisterTools';
import {
  STATUS_LABEL,
  STATUS_TONE,
  WHO,
  dt,
  type ConsentAnswered,
  type ConsentForm,
  type ConsentPending,
} from '@/components/consents/types';
import {
  copyConsentForm,
  deleteConsentForm,
  notifyConsentPending,
  rotateConsentLink,
  setConsentStatus,
} from '@/lib/consent-actions';
import { apiFetch, getMe } from '@/lib/api';

const OK: Record<string, string> = {
  saved: 'The form is saved.',
  published: 'The form is published.',
  closed: 'The form is closed: no more answers.',
  draft: 'The form is a draft again.',
  archived: 'The form is archived.',
  notified: 'Those who have not answered were told again in the app.',
  link: 'A new public link is made: the old link and QR no longer work.',
};
const BY = { family: 'Family', staff: 'Staff', office: 'Office', public: 'Public link' } as const;

/**
 * One consent form: what it asks and of whom, its state with the actions, and the register of who
 * has answered and who has not, with filters and Excel / PDF.
 */
export default async function ConsentFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    tab?: string;
    sectionId?: string;
    q?: string;
    page?: string;
    ok?: string;
    told?: string;
    msg?: string;
    msgn?: string;
    msgerr?: string;
    status?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = sp.tab === 'pending' ? 'pending' : 'answered';
  const page = Math.max(1, Number(sp.page) || 1);
  const qs = new URLSearchParams({ tab, page: String(page), size: '50' });
  if (sp.sectionId && /^\d+$/.test(sp.sectionId)) qs.set('sectionId', sp.sectionId);
  if (sp.q) qs.set('q', sp.q.slice(0, 80));
  const status = ['waiting', 'approved', 'rejected'].includes(sp.status ?? '')
    ? sp.status
    : undefined;
  if (status && tab === 'answered') qs.set('status', status);
  const [f, reg, lists, templates] = await Promise.all([
    apiFetch<ConsentForm>(`/engagement/consent-forms/${id}`),
    apiFetch<{ total: number; data: Array<ConsentAnswered | ConsentPending> }>(
      `/engagement/consent-forms/${id}/register?${qs}`,
    ),
    apiFetch<{ sections: Array<{ id: string; name: string }> }>('/engagement/consent-forms/lists'),
    // the school's message templates (none shown without the permission to see them)
    apiFetch<{
      data: Array<{
        id: string;
        name: string;
        channel: string;
        code: string;
        dltTemplateId: string | null;
        waTemplateName: string | null;
      }>;
    }>('/comms/templates?status=active')
      .then((r) => r.data)
      .catch(
        () =>
          [] as Array<{
            id: string;
            name: string;
            channel: string;
            code: string;
            dltTemplateId: string | null;
            waTemplateName: string | null;
          }>,
      ),
  ]);
  const approval = Boolean(f.settings.approval?.on);
  const canConnect = (await getMe()).permissions.includes('engagement.consent_form.integrate');
  // the public link (and its QR) when switched on
  const publicUrl = f.publicToken
    ? await apiFetch<{ url: string }>(`/engagement/consent-forms/${id}/qr`)
        .then((r) => r.url)
        .catch(() => null)
    : null;
  const hasFee = (f.settings.fee?.mode ?? 'none') !== 'none';
  const asked = f.asked ?? 0;
  const pending = Math.max(0, asked - f.answered);
  const rate = asked ? Math.round((f.answered / asked) * 100) : 0;
  const questions = f.fields.filter((x) => !['heading', 'pagebreak'].includes(x.type));
  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const all = { tab, sectionId: sp.sectionId, q: sp.q, status, ...patch };
    for (const [k, v] of Object.entries(all)) if (v) p.set(k, v);
    return `/engagement/consent-forms/${id}?${p.toString()}`;
  };
  const fileQs = new URLSearchParams({ kind: 'register', id, tab });
  if (status && tab === 'answered') fileQs.set('status', status);
  if (sp.sectionId) fileQs.set('sectionId', sp.sectionId);
  if (sp.q) fileQs.set('q', sp.q);
  const okText = sp.ok
    ? `${OK[sp.ok] ?? 'Done.'}${sp.told && Number(sp.told) > 0 ? ` ${sp.told} people were told in the app.` : ''}${sp.msg ? ` Messages: ${sp.msg}.` : ''}`
    : undefined;
  // the consent templates are chosen by default: publish and remind send by every channel
  const channelPicks = (code: string) =>
    templates.length ? (
      <div className="ep-cfb__grid">
        {(
          [
            ['sms', 'SMS'],
            ['whatsapp', 'WhatsApp'],
            ['email', 'Email'],
          ] as const
        ).map(([ch, label]) => {
          // one-time codes and decisions are sent by the system, never picked here
          const list = templates.filter(
            (t) => t.channel === ch && !/_otp$|^consent_decision$/.test(t.code ?? ''),
          );
          return list.length ? (
            <label key={ch} className="ep-field" htmlFor={`tpl-${ch}`}>
              <span className="ep-field__label">{label} template</span>
              <select
                id={`tpl-${ch}`}
                name={`tpl_${ch}`}
                className="ep-select"
                defaultValue={list.find((t) => t.code === code)?.id ?? ''}
              >
                <option value="">Not by {label}</option>
                {list.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null;
        })}
      </div>
    ) : (
      <p className="ep-field__help" style={{ margin: 0 }}>
        No active SMS, WhatsApp or email templates: the app notification only.
      </p>
    );
  // a chosen SMS template needs a DLT id and a WhatsApp one an approved name, else nothing is sent
  const notReady = (code: string) =>
    templates.filter(
      (t) =>
        t.code === code &&
        ((t.channel === 'sms' && !t.dltTemplateId) ||
          (t.channel === 'whatsapp' && !t.waTemplateName)),
    );
  const readiness = (code: string) =>
    notReady(code).length ? (
      <p className="ep-alert ep-alert--warning" role="status" style={{ margin: 0 }}>
        {notReady(code).map((t, i) => (
          <span key={t.id}>
            {i ? ' ' : ''}
            {t.channel === 'sms' ? 'SMS' : 'WhatsApp'} will not be sent: the template{' '}
            <a href={`/comms/templates/${t.id}`} style={{ textDecoration: 'underline' }}>
              {t.name}
            </a>{' '}
            has no {t.channel === 'sms' ? 'DLT template id' : 'approved WhatsApp template name'}.
          </span>
        ))}
      </p>
    ) : null;
  const statusForm = (status: string, label: string, variant: string, push?: boolean) => (
    <form action={setConsentStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      {push === false ? <input type="hidden" name="push" value="no" /> : null}
      <button type="submit" className={`ep-btn ep-btn--${variant} ep-btn--sm`}>
        {label}
      </button>
    </form>
  );

  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Consent forms', href: '/engagement/consent-forms' }, { label: f.title }]}
      />
      <PageHeader
        kicker="Consent form"
        title={f.title}
        description={`${WHO[f.respondents]} · ${questions.length} questions · ${f.settings.repeat === 'many' ? 'several answers allowed' : 'one answer each'}${f.settings.cap ? ` · closes at ${f.settings.cap} answers` : ''}`}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <Badge tone={STATUS_TONE[f.status]}>{STATUS_LABEL[f.status]}</Badge>
            {f.status === 'published' && !f.open ? (
              <Badge tone="warning">{f.closedWhy ?? 'Not open'}</Badge>
            ) : null}
          </span>
        }
      />
      <Notice params={{ ...sp, detail: okText ?? sp.detail }} />

      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        {/* one row of actions: secondary buttons with an icon; a step that cannot be undone asks first */}
        <div
          style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)', alignItems: 'center' }}
        >
          {f.status !== 'archived' ? (
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/engagement/consent-forms/${id}/edit`}
            >
              <Icon name="pencil" size={16} /> Change
            </a>
          ) : null}
          {f.open && f.settings.officeFill !== false ? (
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/engagement/consent-forms/${id}/fill`}
            >
              <Icon name="clipboard" size={16} /> Fill on behalf
            </a>
          ) : null}
          {f.status !== 'draft' ? (
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/engagement/consent-forms/${id}/analytics`}
            >
              <Icon name="chart" size={16} /> Analytics
            </a>
          ) : null}
          {canConnect ? (
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/engagement/consent-forms/${id}/connect`}
            >
              <Icon name="plug" size={16} /> Connect
            </a>
          ) : null}
          <form action={copyConsentForm}>
            <input type="hidden" name="id" value={id} />
            <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
              <Icon name="copy" size={16} /> Copy as new
            </button>
          </form>
          {f.status === 'published' ? (
            <ConfirmAction
              action={setConsentStatus}
              fields={{ id, status: 'closed' }}
              label="Close"
              title="Close the form?"
              confirmLabel="Close the form"
            >
              Families and staff can no longer answer. Answers already given stay; you can reopen
              it.
            </ConfirmAction>
          ) : null}
          {f.status === 'closed' ? statusForm('published', 'Reopen', 'secondary', false) : null}
          {f.status === 'closed' ? (
            <ConfirmAction
              action={setConsentStatus}
              fields={{ id, status: 'archived' }}
              label="Archive"
              title="Archive the form?"
              confirmLabel="Archive"
            >
              The form leaves the list; its answers and register stay. An archived form cannot
              change.
            </ConfirmAction>
          ) : null}
          {f.status === 'draft' && f.responses === 0 ? (
            <ConfirmAction
              action={deleteConsentForm}
              fields={{ id }}
              label="Delete draft"
              title="Delete this draft?"
              confirmLabel="Delete"
              variant="danger"
              confirmVariant="danger"
            >
              The draft and its questions are removed. This cannot be undone.
            </ConfirmAction>
          ) : null}
        </div>
        <p className="ep-field__help" style={{ margin: 'var(--sp-3) 0 0' }}>
          {f.settings.opensAt ? `Opens ${dt(f.settings.opensAt)}. ` : ''}
          {f.settings.closesAt ? `Closes ${dt(f.settings.closesAt)}. ` : 'No closing date. '}
          {f.settings.editUntil ? `Answers may be changed until ${dt(f.settings.editUntil)}. ` : ''}
          {hasFee
            ? `Fee: ${f.settings.fee?.mode === 'fixed' ? `₹${f.settings.fee.amount ?? 0}` : 'worked out from the answers'}${approval ? ', raised after approval' : ''}. `
            : ''}
          {approval
            ? `Approval: ${(f.settings.approval?.levels ?? []).map((l) => l.name).join(' → ')}.`
            : ''}
        </p>
      </Card>

      {publicUrl ? (
        <Card title="Public link and QR" style={{ marginBottom: 'var(--sp-4)' }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--sp-4)',
              alignItems: 'flex-start',
            }}
          >
            <img
              src={`/api/consent-forms/file?kind=qr&id=${id}`}
              alt={`QR code of the public link of ${f.title}`}
              className="ep-cf__qr"
            />
            <div style={{ flex: '1 1 18rem', display: 'grid', gap: 'var(--sp-2)' }}>
              <label className="ep-field" htmlFor="cf-link">
                <span className="ep-field__label">Link</span>
                <input id="cf-link" className="ep-input" readOnly value={publicUrl} />
              </label>
              <p className="ep-field__help" style={{ margin: 0 }}>
                {[
                  f.settings.publicLink?.families ? 'families without the app (admission no.)' : '',
                  f.settings.publicLink?.outsiders ? 'outsiders (mobile or email)' : '',
                ]
                  .filter(Boolean)
                  .join(' and ')}
                {f.status === 'draft' ? ' · works once the form is published.' : '.'}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
                <a
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  href={`/api/consent-forms/file?kind=qr&id=${id}&save=1`}
                >
                  <Icon name="download" size={16} /> Download QR
                </a>
                <ConfirmAction
                  action={rotateConsentLink}
                  fields={{ id }}
                  label="Make a new link"
                  title="Make a new public link?"
                  confirmLabel="Make a new link"
                >
                  The old link and the printed QR stop working at once. Share the new one.
                </ConfirmAction>
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {f.status === 'draft' ? (
        <Card title="Publish" style={{ marginBottom: 'var(--sp-4)' }}>
          <form action={setConsentStatus} className="ep-cfb">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="status" value="published" />
            <input type="hidden" name="pushForm" value="1" />
            <label className="ep-check">
              <input type="checkbox" className="ep-check__input" name="pushOn" defaultChecked />
              <span className="ep-check__box" aria-hidden="true" />
              <span className="ep-check__text">
                Tell them in the app (notification and home screen)
              </span>
            </label>
            {channelPicks('consent_form_new')}
            {readiness('consent_form_new')}
            <p className="ep-field__help" style={{ margin: 0 }}>
              SMS, WhatsApp and email go at once to the parents of each pupil and to the staff asked
              (publishing is the approval); email is a letter on the school's letterhead.
            </p>
            <div>
              <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                Publish
              </button>
            </div>
          </form>
        </Card>
      ) : f.open && pending > 0 ? (
        <Card title="Remind those not yet answered" style={{ marginBottom: 'var(--sp-4)' }}>
          <form action={notifyConsentPending} className="ep-cfb">
            <input type="hidden" name="id" value={id} />
            {channelPicks('consent_form_reminder')}
            {readiness('consent_form_reminder')}
            <div>
              <button type="submit" className="ep-btn ep-btn--primary">
                <Icon name="send" size={16} />
                Remind {pending} (app{templates.length ? ' and the chosen channels' : ''})
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      {f.status !== 'draft' ? (
        <div className="ep-cf-stats">
          <KpiTile label="Asked" value={asked} />
          <KpiTile label="Answered" value={f.answered} hint={`${rate}%`} />
          <KpiTile label="Not yet answered" value={pending} />
          <KpiTile label="Responses" value={f.responses} />
        </div>
      ) : (
        <Card title="Questions" style={{ marginBottom: 'var(--sp-4)' }}>
          <ol style={{ margin: 0, paddingLeft: 'var(--sp-5)' }}>
            {questions.map((x) => (
              <li key={x.key}>
                {x.label}
                {x.required ? ' *' : ''}
                {x.rule ? (
                  <span className="ep-field__help"> (depends on another answer)</span>
                ) : null}
              </li>
            ))}
          </ol>
        </Card>
      )}

      {f.status !== 'draft' ? (
        <Card>
          <nav
            className="ep-tabs-links"
            aria-label="Register"
            style={{ marginBottom: 'var(--sp-3)' }}
          >
            <a
              href={link({ tab: 'answered' })}
              aria-current={tab === 'answered' ? 'page' : undefined}
            >
              Answered ({f.answered})
            </a>
            <a
              href={link({ tab: 'pending' })}
              aria-current={tab === 'pending' ? 'page' : undefined}
            >
              Not yet answered ({pending})
            </a>
          </nav>
          <form method="get" className="ep-filter-band" style={{ marginBottom: 'var(--sp-3)' }}>
            <input type="hidden" name="tab" value={tab} />
            {f.respondents !== 'staff' ? (
              <label className="ep-field" htmlFor="reg-sec">
                <span className="ep-field__label">Section</span>
                <select
                  id="reg-sec"
                  name="sectionId"
                  className="ep-select"
                  defaultValue={sp.sectionId ?? ''}
                >
                  <option value="">All</option>
                  {lists.sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {approval && tab === 'answered' ? (
              <label className="ep-field" htmlFor="reg-status">
                <span className="ep-field__label">Approval</span>
                <select
                  id="reg-status"
                  name="status"
                  className="ep-select"
                  defaultValue={status ?? ''}
                >
                  <option value="">All</option>
                  <option value="waiting">Waiting</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Not approved</option>
                </select>
              </label>
            ) : null}
            <label className="ep-field" htmlFor="reg-q">
              <span className="ep-field__label">Name, admission no. or number</span>
              <input
                id="reg-q"
                name="q"
                className="ep-input"
                defaultValue={sp.q ?? ''}
                maxLength={80}
              />
            </label>
            <button type="submit" className="ep-btn ep-btn--primary">
              <Icon name="search" size={16} />
              Show
            </button>
            <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', marginLeft: 'auto' }}>
              <a
                className="ep-btn ep-btn--secondary"
                href={`/api/consent-forms/file?${fileQs}&format=xlsx`}
              >
                <Icon name="download" size={16} />
                Excel
              </a>
              <a
                className="ep-btn ep-btn--secondary"
                href={`/api/consent-forms/file?${fileQs}&format=pdf`}
              >
                <Icon name="download" size={16} />
                PDF
              </a>
            </span>
          </form>
          {reg.data.length === 0 ? (
            <p className="ep-field__help">Nobody here.</p>
          ) : tab === 'answered' ? (
            <div className="ep-table-wrap">
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">Answered</caption>
                <thead>
                  <tr>
                    <th scope="col">Number</th>
                    <th scope="col">Pupil / staff</th>
                    <th scope="col">Class</th>
                    <th scope="col">Answered by</th>
                    <th scope="col">On</th>
                    {approval ? <th scope="col">Approval</th> : null}
                    {hasFee ? <th scope="col">Fee</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {(reg.data as ConsentAnswered[]).map((r) => (
                    <tr key={r.id}>
                      <td>
                        <a
                          href={`/engagement/consent-forms/${id}/responses/${r.id}`}
                          style={{ textDecoration: 'underline' }}
                        >
                          {r.number}
                        </a>
                      </td>
                      <td>
                        {r.student ?? r.employee ?? r.publicName}{' '}
                        {r.viaLink ? <Badge tone="neutral">Link</Badge> : null}{' '}
                        <span className="ep-field__help">
                          {r.admissionNo ?? r.employeeCode ?? r.publicMobile ?? r.publicEmail}
                        </span>
                      </td>
                      <td>{r.section ?? '—'}</td>
                      <td>
                        {r.byUser ?? r.signedName ?? '—'}{' '}
                        <Badge tone="neutral">{BY[r.respondent]}</Badge>
                      </td>
                      <td>
                        {new Date(r.signedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                      </td>
                      {approval ? (
                        <td>
                          {r.waitingWith ? (
                            <Badge tone="warning">Waiting: {r.waitingWith}</Badge>
                          ) : r.status === 'approved' ? (
                            <Badge tone="success">Approved</Badge>
                          ) : r.status === 'rejected' ? (
                            <Badge tone="danger">Not approved</Badge>
                          ) : (
                            '—'
                          )}
                        </td>
                      ) : null}
                      {hasFee ? (
                        <td>
                          {Number(r.fee ?? 0) > 0
                            ? `₹${Number(r.fee).toLocaleString('en-IN')}${r.paid !== null && r.paid !== undefined ? ` · paid ₹${Number(r.paid).toLocaleString('en-IN')}` : r.status === 'submitted' && approval ? ' · after approval' : ''}`
                            : '—'}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="ep-table-wrap">
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">Not yet answered</caption>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Adm. / code</th>
                    <th scope="col">Class / department</th>
                    <th scope="col">Contact</th>
                    {f.open && f.settings.officeFill !== false ? (
                      <th scope="col">Paper form</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {(reg.data as ConsentPending[]).map((r) => (
                    <tr key={`${r.kind}${r.id}`}>
                      <td>{r.name}</td>
                      <td>{r.code ?? '—'}</td>
                      <td>{r.section ?? '—'}</td>
                      <td>{r.contact ?? '—'}</td>
                      {f.open && f.settings.officeFill !== false ? (
                        <td>
                          <a
                            href={`/engagement/consent-forms/${id}/fill?who=${r.kind}:${r.id}`}
                            style={{ textDecoration: 'underline' }}
                          >
                            Fill for {r.name}
                          </a>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pager
            page={page}
            pages={Math.ceil(reg.total / 50)}
            hrefFor={(p) => link({ page: String(p) })}
          />
        </Card>
      ) : null}
    </>
  );
}
