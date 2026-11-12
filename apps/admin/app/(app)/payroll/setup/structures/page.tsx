import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { Pager, PerPage, pageSizeOf } from '@/components/Pager';
import { DialogButton } from '@/components/leave/DialogButton';
import { StructureImport } from '@/components/payroll/StructureImport';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { money, type PayrollCan, type ProfileList, type StructureView } from '@/lib/payroll';
import { deletePayrollTemplate, savePayrollTemplate } from '@/lib/payroll-actions';

type Template = StructureView['templates'][number];
const TABS = [
  { id: 'staff', label: 'Staff' },
  { id: 'import', label: 'From Excel' },
  { id: 'templates', label: 'Templates' },
] as const;

function TemplateForm({ t }: { t: Template | null }) {
  const id = t ? `tp-${t.id}` : 'tp-new';
  return (
    <form action={savePayrollTemplate.bind(null, t?.id ?? null)} className="ep-form-section__body">
      <div className="ep-profile__grid">
        <label className="ep-field" htmlFor={`${id}-name`}>
          <span className="ep-field__label">Name</span>
          <input
            id={`${id}-name`}
            name="name"
            className="ep-input"
            required
            maxLength={80}
            defaultValue={t?.name ?? ''}
          />
        </label>
        <label className="ep-field" htmlFor={`${id}-types`}>
          <span className="ep-field__label">For staff types</span>
          <input
            id={`${id}-types`}
            name="staffTypes"
            className="ep-input"
            maxLength={300}
            defaultValue={t?.staffTypes.join(', ') ?? ''}
          />
          <span className="ep-field__help">With commas; empty: any</span>
        </label>
      </div>
      <label className="ep-field" htmlFor={`${id}-desc`}>
        <span className="ep-field__label">About it</span>
        <input
          id={`${id}-desc`}
          name="description"
          className="ep-input"
          maxLength={255}
          defaultValue={t?.description ?? ''}
        />
      </label>
      <label className="ep-field" htmlFor={`${id}-lines`}>
        <span className="ep-field__label">Amounts</span>
        <textarea
          id={`${id}-lines`}
          name="lines"
          className="ep-input"
          rows={5}
          required
          defaultValue={
            t
              ? Object.entries(t.lines)
                  .map(([k, v]) => `${k}=${v}`)
                  .join('\n')
              : ''
          }
          placeholder={'BASIC=25000\nTA_BASE=1800'}
        />
        <span className="ep-field__help">
          One a line: HEAD CODE=amount a month, for the fixed heads; formula heads work themselves
          out
        </span>
      </label>
      <p>
        <button type="submit" className="ep-btn ep-btn--primary">
          Save the template
        </button>
      </p>
    </form>
  );
}

/** Salary structures (legacy Salary Structure): the amount of each fixed head for each employee, from a date. */
export default async function PayrollStructuresPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('payroll.setup.view')) notFound();
  const tab = TABS.find((t) => t.id === sp.tab)?.id ?? 'staff';
  const q = (sp.q ?? '').trim().slice(0, 60);
  const size = Number(pageSizeOf(sp.size));
  const page = Math.max(1, Number(sp.page) || 1);
  const qs = (p: number) => {
    const u = new URLSearchParams({ size: String(size), page: String(p) });
    if (q) u.set('q', q);
    return u.toString();
  };
  let list: ProfileList | null = null;
  let templates: { templates: Template[]; can: PayrollCan } | null = null;
  try {
    if (tab === 'staff') list = await apiFetch<ProfileList>(`/payroll/profiles?${qs(page)}`);
    if (tab === 'templates')
      templates = await apiFetch<{ templates: Template[]; can: PayrollCan }>('/payroll/templates');
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const can = list?.can ?? templates?.can;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Payroll set-up', href: '/payroll/setup' },
          { label: 'Salary structures' },
        ]}
      />
      <PageHeader
        kicker="Payroll set-up"
        title="Salary structures"
        description="The monthly amount of each fixed head for each employee, from a date. A change is saved as drafts from its date; when a checker approves, the amounts before it end the day before and earlier months keep them."
      />
      <Notice params={sp} />
      <nav className="ep-tabs" aria-label="Salary structures">
        {TABS.map((t) => (
          <a
            key={t.id}
            className="ep-tabs__tab"
            href={`/payroll/setup/structures?tab=${t.id}`}
            aria-current={t.id === tab ? 'page' : undefined}
          >
            {t.label}
          </a>
        ))}
      </nav>
      {tab === 'staff' && list ? (
        <section className="ep-card" aria-labelledby="st-list">
          <h2 id="st-list" className="ep-card__title">
            Staff
          </h2>
          <form method="get" className="ep-pfilter ep-grid__toolbar">
            <input type="hidden" name="tab" value="staff" />
            <label className="ep-field" htmlFor="st-q">
              <span className="ep-field__label">Name or code</span>
              <input id="st-q" name="q" className="ep-input" defaultValue={q} maxLength={60} />
            </label>
            <PerPage id="st-size" value={String(size)} />
            <button type="submit" className="ep-btn ep-btn--ghost">
              Show
            </button>
          </form>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="st-list">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  <th scope="col">Department</th>
                  <th scope="col">Staff type</th>
                  <th scope="col">Level · cell</th>
                  <th scope="col">Structure</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.length ? (
                  list.rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <a href={`/payroll/setup/structures/${r.id}`}>{r.name}</a>
                        <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
                          {r.code}
                        </span>
                      </td>
                      <td>{r.department ?? ''}</td>
                      <td>{r.staffType ?? ''}</td>
                      <td>{r.payLevel ? `${r.payLevel} · ${String(r.payCell ?? '')}` : ''}</td>
                      <td>
                        {r.structured ? (
                          <Badge tone="success">In force</Badge>
                        ) : (
                          <Badge tone="neutral">None</Badge>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5}>No staff match.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pager
            page={list.page}
            size={list.size}
            total={list.total}
            href={(p) => `/payroll/setup/structures?tab=staff&${qs(p)}`}
            noun="staff"
          />
        </section>
      ) : null}
      {tab === 'import' ? (
        <section className="ep-card" aria-labelledby="st-import">
          <h2 id="st-import" className="ep-card__title">
            Structures from Excel
          </h2>
          {me.permissions.includes('payroll.setup.manage') ? (
            <StructureImport />
          ) : (
            <p>Only a payroll maker uploads structures.</p>
          )}
        </section>
      ) : null}
      {tab === 'templates' && templates ? (
        <section className="ep-card" aria-labelledby="st-tpl">
          <div className="ep-grid__toolbar">
            <h2 id="st-tpl" className="ep-card__title">
              Templates
            </h2>
            <span className="ep-grid__spacer" />
            {can?.admin ? (
              <DialogButton id="tp-add" label="＋ New template" title="A structure template">
                <TemplateForm t={null} />
              </DialogButton>
            ) : null}
          </div>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            A starting set of amounts for a kind of post. Applying one on an employee’s structure
            fills the form; nothing is saved until the maker saves it.
          </p>
          {templates.templates.length ? (
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="st-tpl">
              <table className="ep-table ep-table--dense">
                <thead>
                  <tr>
                    <th scope="col">Template</th>
                    <th scope="col">For</th>
                    <th scope="col">Amounts (₹ a month)</th>
                    <th scope="col">
                      <span className="ep-sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {templates.templates.map((t) => (
                    <tr key={t.id}>
                      <td>
                        {t.name}
                        {t.description ? (
                          <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
                            {t.description}
                          </span>
                        ) : null}
                      </td>
                      <td>{t.staffTypes.length ? t.staffTypes.join(', ') : 'Any'}</td>
                      <td>
                        {Object.entries(t.lines)
                          .map(([k, v]) => `${k} ${money(v)}`)
                          .join(' · ')}
                      </td>
                      <td>
                        {can?.admin ? (
                          <div className="ep-grid__toolbar">
                            <DialogButton
                              id={`tp-e-${t.id}`}
                              label="Change"
                              title={`Change ${t.name}`}
                              className="ep-btn ep-btn--ghost ep-btn--sm"
                            >
                              <TemplateForm t={t} />
                            </DialogButton>
                            <form action={deletePayrollTemplate.bind(null, t.id)}>
                              <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                                Delete
                              </button>
                            </form>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No templates yet.</p>
          )}
        </section>
      ) : null}
    </>
  );
}
