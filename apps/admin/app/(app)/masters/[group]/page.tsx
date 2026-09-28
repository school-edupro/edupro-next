import { Badge, Button, Card, FormRow, InputField, PageHeader, SelectField } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { Icon } from '@/components/nav-icons';
import {
  masterBulk,
  masterClone,
  masterExport,
  masterSave,
  masterStatus,
  masterUploadCommit,
  masterUploadValidate,
} from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import {
  MASTER_GROUP_IDS,
  masterRegistry,
  type MasterField,
  type MasterImport,
  type MasterMeta,
  type MasterRow,
} from '@/lib/masters';
import type { Page } from '@/lib/types';

const SIZES = ['10', '25', '50', '100', '200'];

type Search = {
  tab?: string;
  page?: string;
  size?: string;
  q?: string;
  status?: string;
  filter?: string;
  add?: string;
  edit?: string;
  bulk?: string;
  clone?: string;
  upload?: string;
  import?: string;
  export?: string;
  ok?: string;
  error?: string;
  detail?: string;
};

/**
 * One page per master group: tabs for its masters; each master gets the same grid — records per
 * page, add / edit, clone, bulk update, filter, Excel / PDF export, Excel upload — under the school
 * and year of the header.
 */
export default async function MasterGroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ group: string }>;
  searchParams: Promise<Search>;
}) {
  const { group } = await params;
  if (!(MASTER_GROUP_IDS as readonly string[]).includes(group)) notFound();
  const sp = await searchParams;
  const [t, c, me, registry] = await Promise.all([
    getTranslations('masters'),
    getTranslations('common'),
    getMe(),
    masterRegistry(),
  ]);
  const masters = registry.filter((m) => m.group === group);
  if (masters.length === 0) notFound();
  const master = masters.find((m) => m.id === sp.tab) ?? masters[0]!;
  const page = Math.max(1, Number(sp.page) || 1);
  const size = SIZES.includes(sp.size ?? '') ? Number(sp.size) : 50;
  const q = (sp.q ?? '').trim();
  const status = sp.status === 'active' || sp.status === 'inactive' ? sp.status : '';
  const query = new URLSearchParams({ page: String(page), size: String(size) });
  if (q) query.set('q', q);
  if (status) query.set('status', status);
  const base = `/masters/${group}?tab=${master.id}&size=${size}${q ? `&q=${encodeURIComponent(q)}` : ''}${status ? `&status=${status}` : ''}`;
  const pageUrl = (n: number) => `${base}&page=${n}`;
  const back = `${base}&page=${page}`;
  const [rows, imports, editRow, exportRow] = await Promise.all([
    apiFetch<Page<MasterRow>>(`/masters/${master.id}/rows?${query.toString()}`),
    sp.upload
      ? apiFetch<{ data: MasterImport[] }>(`/masters/${master.id}/imports`).then((r) => r.data)
      : Promise.resolve([] as MasterImport[]),
    sp.edit && /^\d+$/.test(sp.edit)
      ? apiFetch<Page<MasterRow>>(`/masters/${master.id}/rows?size=500&page=1`).then(
          (r) => r.data.find((x) => x.id === sp.edit) ?? null,
        )
      : Promise.resolve(null),
    sp.export && /^\d+$/.test(sp.export)
      ? apiFetch<{
          export: { id: string; status: string; format: string };
          download: { url: string } | null;
        }>(`/reports/exports/${sp.export}`).catch(() => null)
      : Promise.resolve(null),
  ]);
  const total = rows.page.total;
  const pages = Math.max(1, Math.ceil(total / size));
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(total, page * size);
  const canManage = master.canManage;
  const years = (me.academicYears ?? []).filter((y) => y.status !== 'closed');
  const currentYear = me.academicYear?.code ?? '';
  const importRow = imports.find((i) => i.id === sp.import) ?? null;
  const groupKey = group as (typeof MASTER_GROUP_IDS)[number];
  const cell = (r: MasterRow, f: MasterMeta['columns'][number]) => {
    const v = r[f.key];
    if (v === null || v === undefined) return '';
    if (v === 'true') return t('yes');
    if (v === 'false') return t('no');
    return v;
  };

  return (
    <>
      <PageHeader
        kicker={t(`kicker.${groupKey}`)}
        title={t(`title.${groupKey}`)}
        description={t('description')}
      />
      <Notice params={sp} />
      {exportRow ? (
        <div
          className="ep-alert ep-alert--info"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {t('exportQueued')} · {exportRow.export.format.toUpperCase()} ·{' '}
          {exportRow.download ? (
            <a href={`/reports/exports/${exportRow.export.id}/download`}>{t('exportReady')}</a>
          ) : (
            <span>{t('exportPending')}</span>
          )}
        </div>
      ) : null}

      <div className="ep-tabs">
        <div role="tablist" aria-label={t(`title.${groupKey}`)} className="ep-tabs__list">
          {masters.map((m) => (
            <a
              key={m.id}
              role="tab"
              aria-selected={m.id === master.id}
              className="ep-tabs__tab"
              href={`/masters/${group}?tab=${m.id}`}
            >
              {m.title}
            </a>
          ))}
        </div>
      </div>

      <Card>
        {/* ---- toolbar ---- */}
        <div className="ep-master__toolbar">
          <form method="get" className="ep-master__perpage">
            <input type="hidden" name="tab" value={master.id} />
            {q ? <input type="hidden" name="q" value={q} /> : null}
            {status ? <input type="hidden" name="status" value={status} /> : null}
            <SelectField
              id="size"
              name="size"
              label={t('perPage')}
              defaultValue={String(size)}
              options={SIZES.map((s) => ({ value: s, label: s }))}
            />
            <Button type="submit" variant="ghost" size="sm">
              {t('apply')}
            </Button>
          </form>
          <div className="ep-master__actions">
            {canManage ? (
              <a className="ep-btn ep-btn--primary ep-btn--sm" href={`${back}&add=1`}>
                ＋ {t('add')}
              </a>
            ) : null}
            {master.canClone ? (
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href={`${back}&clone=1`}>
                {t('clone')}
              </a>
            ) : null}
            {canManage && master.fields.some((f) => f.bulk) ? (
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href={`${back}&bulk=1`}>
                {t('bulk')}
              </a>
            ) : null}
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`${back}&filter=1`}>
              {t('filter')}
            </a>
            <form action={masterExport}>
              <input type="hidden" name="master" value={master.id} />
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="format" value="xlsx" />
              <Button type="submit" variant="secondary" size="sm">
                {t('excel')}
              </Button>
            </form>
            <form action={masterExport}>
              <input type="hidden" name="master" value={master.id} />
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="format" value="pdf" />
              <Button type="submit" variant="secondary" size="sm">
                {t('pdf')}
              </Button>
            </form>
            {canManage ? (
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href={`${back}&upload=1`}>
                {t('upload')}
              </a>
            ) : null}
          </div>
        </div>
        {master.yearScoped ? (
          <p className="ep-field__help">{t('yearHint', { year: currentYear })}</p>
        ) : null}

        {/* ---- filter row ---- */}
        {sp.filter || q || status ? (
          <form method="get" className="ep-master__filter">
            <input type="hidden" name="tab" value={master.id} />
            <input type="hidden" name="size" value={String(size)} />
            <InputField
              id="q"
              name="q"
              label={t('search')}
              defaultValue={q}
              placeholder={t('searchPlaceholder')}
              maxLength={80}
            />
            {master.status ? (
              <SelectField
                id="status"
                name="status"
                label={t('status')}
                defaultValue={status}
                options={[
                  { value: '', label: t('allStatus') },
                  ...master.status.values.map((v) => ({ value: v, label: c(v) })),
                ]}
              />
            ) : null}
            <Button type="submit" variant="secondary" size="sm">
              {t('apply')}
            </Button>
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={`/masters/${group}?tab=${master.id}&size=${size}`}
            >
              {t('clear')}
            </a>
          </form>
        ) : null}

        {/* ---- add / edit ---- */}
        {canManage && (sp.add || editRow) ? (
          <RowForm master={master} row={editRow} back={back} t={t} />
        ) : null}

        {/* ---- clone ---- */}
        {master.canClone && sp.clone ? (
          <section
            className="ep-master__panel"
            aria-label={t('cloneTitle', { master: master.title })}
          >
            <h3 className="ep-master__panel-title">{t('cloneTitle', { master: master.title })}</h3>
            <form action={masterClone}>
              <input type="hidden" name="master" value={master.id} />
              <input type="hidden" name="back" value={back} />
              <FormRow columns={3}>
                <SelectField
                  id="fromYearId"
                  name="fromYearId"
                  label={t('cloneFrom')}
                  defaultValue={me.academicYear?.id ?? ''}
                  options={(me.academicYears ?? []).map((y) => ({ value: y.id, label: y.code }))}
                />
                <SelectField
                  id="toYearId"
                  name="toYearId"
                  label={t('cloneTo')}
                  defaultValue={years.find((y) => y.id !== me.academicYear?.id)?.id ?? ''}
                  options={years.map((y) => ({ value: y.id, label: y.code }))}
                />
                <div style={{ alignSelf: 'end' }}>
                  <Button type="submit">{t('cloneApply')}</Button>
                </div>
              </FormRow>
              <p className="ep-field__help">{t('cloneHelp')}</p>
            </form>
          </section>
        ) : null}

        {/* ---- upload ---- */}
        {canManage && sp.upload ? (
          <section
            className="ep-master__panel"
            aria-label={t('uploadTitle', { master: master.title })}
          >
            <h3 className="ep-master__panel-title">{t('uploadTitle', { master: master.title })}</h3>
            <form action={masterUploadValidate}>
              <input type="hidden" name="master" value={master.id} />
              <input type="hidden" name="back" value={back} />
              <div className="ep-master__filter">
                <label className="ep-field">
                  <span className="ep-field__label">{t('uploadFile')}</span>
                  <input
                    className="ep-input"
                    type="file"
                    name="file"
                    accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                    required
                  />
                </label>
                <Button type="submit" variant="secondary" size="sm">
                  {t('uploadValidate')}
                </Button>
                <a
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  href={`/api/masters/${master.id}/template`}
                >
                  {t('template')}
                </a>
              </div>
              <p className="ep-field__help">
                {t('uploadHelp', { key: master.naturalKey.join(' + ') })}
                {master.uploadHelp ? ` ${master.uploadHelp}` : ''}
              </p>
            </form>
            {importRow ? (
              <div className="ep-master__report">
                <strong>{t('uploadReport')}</strong> · {importRow.fileName} ·{' '}
                {t('uploadRows', {
                  ok: importRow.okRows,
                  total: importRow.totalRows,
                  rejected: importRow.rejectedRows,
                })}
                {importRow.status === 'validated' ? (
                  <form action={masterUploadCommit} style={{ marginTop: 'var(--sp-2)' }}>
                    <input type="hidden" name="master" value={master.id} />
                    <input type="hidden" name="importId" value={importRow.id} />
                    <input type="hidden" name="back" value={back} />
                    <Button type="submit">{t('uploadCommit', { ok: importRow.okRows })}</Button>
                  </form>
                ) : null}
                {importRow.status === 'committed' ? (
                  <div>
                    <Badge tone="success">
                      {t('uploadCommitted', {
                        inserted: importRow.insertedRows,
                        updated: importRow.updatedRows,
                      })}
                    </Badge>
                  </div>
                ) : null}
                {importRow.status === 'failed' ? (
                  <>
                    <p className="ep-field__help">{t('uploadFailed')}</p>
                    <table className="ep-table ep-table--dense">
                      <thead>
                        <tr>
                          <th>{t('row')}</th>
                          <th>{t('column')}</th>
                          <th>{t('message')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importRow.report.map((r, i) => (
                          <tr key={i}>
                            <td>{r.row}</td>
                            <td>{r.column}</td>
                            <td>{r.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                ) : null}
              </div>
            ) : null}
            {imports.length ? (
              <details style={{ marginTop: 'var(--sp-3)' }}>
                <summary className="ep-kicker">{t('recentUploads')}</summary>
                <table className="ep-table ep-table--dense">
                  <tbody>
                    {imports.slice(0, 8).map((i) => (
                      <tr key={i.id}>
                        <td>{i.createdAt.slice(0, 16).replace('T', ' ')}</td>
                        <td>{i.fileName}</td>
                        <td>
                          <Badge
                            tone={
                              i.status === 'committed'
                                ? 'success'
                                : i.status === 'failed'
                                  ? 'danger'
                                  : 'warning'
                            }
                          >
                            {i.status}
                          </Badge>
                        </td>
                        <td>
                          {t('uploadRows', {
                            ok: i.okRows,
                            total: i.totalRows,
                            rejected: i.rejectedRows,
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            ) : null}
          </section>
        ) : null}

        {/* ---- bulk update: its own form; the row ticks in the grid point at it through form="bulk" ---- */}
        {canManage && sp.bulk ? (
          <form action={masterBulk} id="bulk">
            <input type="hidden" name="master" value={master.id} />
            <input type="hidden" name="back" value={back} />
            <section className="ep-master__panel" aria-label={t('bulkTitle')}>
              <h3 className="ep-master__panel-title">{t('bulkTitle')}</h3>
              <div className="ep-master__filter">
                <SelectField
                  id="bulkField"
                  name="field"
                  label={t('bulkField')}
                  options={master.fields
                    .filter((f) => f.bulk)
                    .map((f) => ({ value: f.key, label: f.header }))}
                />
                <InputField
                  id="bulkValue"
                  name="value"
                  label={t('bulkValue')}
                  required
                  maxLength={120}
                />
                <Button type="submit" variant="secondary" size="sm">
                  {t('bulkApply')}
                </Button>
              </div>
              <p className="ep-field__help">{t('bulkHelp')}</p>
            </section>
          </form>
        ) : null}
        <div>
          <div className="ep-master__count">{t('showing', { from, to, total, page, pages })}</div>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={master.title}>
            <table className="ep-table ep-table--dense ep-master__table">
              <caption className="ep-sr-only">{master.title}</caption>
              <thead>
                <tr>
                  {canManage && sp.bulk ? <th scope="col" /> : null}
                  <th scope="col">{t('sno')}</th>
                  {canManage ? <th scope="col">{t('action')}</th> : null}
                  {master.columns.map((col) => (
                    <th
                      key={col.key}
                      scope="col"
                      className={col.type === 'number' ? 'num' : undefined}
                    >
                      {col.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.data.length === 0 ? (
                  <tr>
                    <td colSpan={master.columns.length + 3} className="ep-field__help">
                      {t('noRows')}
                    </td>
                  </tr>
                ) : null}
                {rows.data.map((r, i) => (
                  <tr key={r.id}>
                    {canManage && sp.bulk ? (
                      <td>
                        <input
                          type="checkbox"
                          name="ids"
                          value={r.id}
                          aria-label={`${t('bulk')} · ${r.id}`}
                        />
                      </td>
                    ) : null}
                    <td>{from + i}</td>
                    {canManage ? (
                      <td className="ep-master__rowactions">
                        <a
                          className="ep-master__iconbtn"
                          href={`${back}&edit=${r.id}`}
                          aria-label={`${t('edit')} ${r[master.naturalKey[0]!] ?? r.id}`}
                          title={t('edit')}
                        >
                          <Icon name="file" size={16} />
                        </a>
                        {master.status ? (
                          <form action={masterStatus} style={{ display: 'inline' }}>
                            <input type="hidden" name="master" value={master.id} />
                            <input type="hidden" name="back" value={back} />
                            <input
                              type="hidden"
                              name="toggle"
                              value={`${r.id}:${r[master.status.column] === 'active' ? 'inactive' : 'active'}`}
                            />
                            <button
                              type="submit"
                              className="ep-master__iconbtn"
                              aria-label={
                                r[master.status.column] === 'active'
                                  ? t('deactivate')
                                  : t('activate')
                              }
                              title={
                                r[master.status.column] === 'active'
                                  ? t('deactivate')
                                  : t('activate')
                              }
                            >
                              <Icon
                                name={r[master.status.column] === 'active' ? 'check' : 'grid'}
                                size={16}
                              />
                            </button>
                          </form>
                        ) : null}
                      </td>
                    ) : null}
                    {master.columns.map((col) =>
                      master.status && col.key === master.status.column ? (
                        <td key={col.key}>
                          <Badge tone={r[col.key] === 'active' ? 'success' : 'neutral'}>
                            {c(r[col.key] ?? '')}
                          </Badge>
                        </td>
                      ) : (
                        <td key={col.key} className={col.type === 'number' ? 'num' : undefined}>
                          {cell(r, col)}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <nav className="ep-master__pager" aria-label="Pagination">
          {page > 1 ? (
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={pageUrl(page - 1)}>
              ‹ {t('prev')}
            </a>
          ) : (
            <span />
          )}
          <span className="ep-field__help">
            {page} / {pages}
          </span>
          {page < pages ? (
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={pageUrl(page + 1)}>
              {t('next')} ›
            </a>
          ) : (
            <span />
          )}
        </nav>
      </Card>
    </>
  );
}

/** Generic add / edit form built from the field specification. */
function RowForm({
  master,
  row,
  back,
  t,
}: {
  master: MasterMeta;
  row: MasterRow | null;
  back: string;
  t: Awaited<ReturnType<typeof getTranslations<'masters'>>>;
}) {
  const fields = master.fields.filter((f) => !f.readOnly);
  return (
    <section
      className="ep-master__panel"
      aria-label={
        row ? t('editTitle', { master: master.title }) : t('addTitle', { master: master.title })
      }
    >
      <h3 className="ep-master__panel-title">
        {row ? t('editTitle', { master: master.title }) : t('addTitle', { master: master.title })}
      </h3>
      <form action={masterSave}>
        <input type="hidden" name="master" value={master.id} />
        <input type="hidden" name="back" value={back} />
        {row ? <input type="hidden" name="id" value={row.id} /> : null}
        {fields.map((f) => (
          <input key={f.key} type="hidden" name="fields" value={f.key} />
        ))}
        <FormRow columns={3}>
          {fields.map((f) => (
            <FieldInput
              key={f.key}
              f={f}
              value={row ? (row[f.key] ?? '') : ''}
              locked={Boolean(row && f.identity)}
              lockedHelp={t('identityLocked')}
              yes={t('yes')}
              no={t('no')}
            />
          ))}
        </FormRow>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' }}>
          <a className="ep-btn ep-btn--ghost" href={back}>
            {t('cancel')}
          </a>
          <Button type="submit">{t('save')}</Button>
        </div>
      </form>
    </section>
  );
}

function FieldInput({
  f,
  value,
  locked,
  lockedHelp,
  yes,
  no,
}: {
  f: MasterField;
  value: string;
  locked: boolean;
  lockedHelp: string;
  yes: string;
  no: string;
}) {
  const id = `f-${f.key}`;
  const name = `f:${f.key}`;
  const help = locked ? lockedHelp : f.help;
  if (locked) {
    return (
      <div>
        <InputField
          id={id}
          name={name}
          label={f.header}
          defaultValue={value}
          readOnly
          help={help}
        />
      </div>
    );
  }
  if (f.type === 'select' && f.options)
    return (
      <SelectField
        id={id}
        name={name}
        label={f.header}
        required={f.required}
        defaultValue={value}
        help={help}
        options={[
          ...(f.required ? [] : [{ value: '', label: '—' }]),
          ...f.options.map((o) => ({ value: o, label: o })),
        ]}
      />
    );
  if (f.type === 'boolean')
    return (
      <SelectField
        id={id}
        name={name}
        label={f.header}
        defaultValue={value === 'true' ? 'yes' : value === 'false' ? 'no' : ''}
        help={help}
        options={[
          { value: '', label: '—' },
          { value: 'yes', label: yes },
          { value: 'no', label: no },
        ]}
      />
    );
  if (f.type === 'number')
    return (
      <InputField
        id={id}
        name={name}
        label={f.header}
        type="number"
        required={f.required}
        defaultValue={value}
        min={f.min}
        max={f.max}
        step={f.scale ? 1 / 10 ** f.scale : 1}
        help={help}
      />
    );
  if (f.type === 'date')
    return (
      <InputField
        id={id}
        name={name}
        label={f.header}
        type="date"
        required={f.required}
        defaultValue={value}
        help={help}
      />
    );
  return (
    <InputField
      id={id}
      name={name}
      label={f.header}
      required={f.required}
      defaultValue={value}
      maxLength={f.maxLength}
      help={
        help ??
        (f.type === 'ref' && f.lookup ? `${f.lookup.column} of ${f.lookup.table}` : undefined)
      }
    />
  );
}
