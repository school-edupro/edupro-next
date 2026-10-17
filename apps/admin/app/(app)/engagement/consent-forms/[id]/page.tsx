import { Badge, Breadcrumbs, Card, KpiTile, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
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
  setConsentStatus,
} from '@/lib/consent-actions';
import { apiFetch } from '@/lib/api';

const OK: Record<string, string> = {
  saved: 'The form is saved.',
  published: 'The form is published.',
  closed: 'The form is closed: no more answers.',
  draft: 'The form is a draft again.',
  archived: 'The form is archived.',
  notified: 'Those who have not answered were told again in the app.',
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
  const [f, reg, lists] = await Promise.all([
    apiFetch<ConsentForm>(`/engagement/consent-forms/${id}`),
    apiFetch<{ total: number; data: Array<ConsentAnswered | ConsentPending> }>(
      `/engagement/consent-forms/${id}/register?${qs}`,
    ),
    apiFetch<{ sections: Array<{ id: string; name: string }> }>('/engagement/consent-forms/lists'),
  ]);
  const asked = f.asked ?? 0;
  const pending = Math.max(0, asked - f.answered);
  const rate = asked ? Math.round((f.answered / asked) * 100) : 0;
  const questions = f.fields.filter((x) => !['heading', 'pagebreak'].includes(x.type));
  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const all = { tab, sectionId: sp.sectionId, q: sp.q, ...patch };
    for (const [k, v] of Object.entries(all)) if (v) p.set(k, v);
    return `/engagement/consent-forms/${id}?${p.toString()}`;
  };
  const fileQs = new URLSearchParams({ kind: 'register', id, tab });
  if (sp.sectionId) fileQs.set('sectionId', sp.sectionId);
  if (sp.q) fileQs.set('q', sp.q);
  const okText = sp.ok
    ? `${OK[sp.ok] ?? 'Done.'}${sp.told && Number(sp.told) > 0 ? ` ${sp.told} people were told in the app.` : ''}`
    : undefined;
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
        <div
          style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)', alignItems: 'center' }}
        >
          {f.status !== 'archived' ? (
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/engagement/consent-forms/${id}/edit`}
            >
              Change
            </a>
          ) : null}
          {f.status === 'draft' ? (
            <>
              {statusForm('published', 'Publish and tell them in the app', 'primary')}
              {statusForm('published', 'Publish quietly', 'secondary', false)}
            </>
          ) : null}
          {f.status === 'published' ? statusForm('closed', 'Close', 'secondary') : null}
          {f.status === 'closed' ? statusForm('published', 'Reopen', 'secondary', false) : null}
          {f.status === 'closed' ? statusForm('archived', 'Archive', 'ghost') : null}
          {f.open && f.settings.officeFill !== false ? (
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/engagement/consent-forms/${id}/fill`}
            >
              Fill on behalf
            </a>
          ) : null}
          {f.open && pending > 0 ? (
            <form action={notifyConsentPending}>
              <input type="hidden" name="id" value={id} />
              <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                Remind those pending (app)
              </button>
            </form>
          ) : null}
          <form action={copyConsentForm}>
            <input type="hidden" name="id" value={id} />
            <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
              Copy as new
            </button>
          </form>
          {f.status === 'draft' && f.responses === 0 ? (
            <form action={deleteConsentForm}>
              <input type="hidden" name="id" value={id} />
              <button type="submit" className="ep-btn ep-btn--danger ep-btn--sm">
                Delete draft
              </button>
            </form>
          ) : null}
        </div>
        <p className="ep-field__help" style={{ margin: 'var(--sp-3) 0 0' }}>
          {f.settings.opensAt ? `Opens ${dt(f.settings.opensAt)}. ` : ''}
          {f.settings.closesAt ? `Closes ${dt(f.settings.closesAt)}. ` : 'No closing date. '}
          To send an SMS, WhatsApp or email about it, use{' '}
          <a href="/comms/compose" style={{ textDecoration: 'underline' }}>
            Communication → Compose
          </a>{' '}
          with the school&apos;s templates.
        </p>
      </Card>

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
            <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
              Show
            </button>
            <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', marginLeft: 'auto' }}>
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/api/consent-forms/file?${fileQs}&format=xlsx`}
              >
                Excel
              </a>
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/api/consent-forms/file?${fileQs}&format=pdf`}
              >
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
                        {r.student ?? r.employee}{' '}
                        <span className="ep-field__help">{r.admissionNo ?? r.employeeCode}</span>
                      </td>
                      <td>{r.section ?? '—'}</td>
                      <td>
                        {r.byUser ?? r.signedName ?? '—'}{' '}
                        <Badge tone="neutral">{BY[r.respondent]}</Badge>
                      </td>
                      <td>
                        {new Date(r.signedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                      </td>
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
