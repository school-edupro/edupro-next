import { Badge, Card } from '@edupro/ui';
import { ConfirmAction } from '@/components/ConfirmAction';
import { Icon } from '@/components/nav-icons';
import type { BookSetup } from '@/lib/library-books';
import { applyBooksUpdate, uploadBooksUpdate } from '@/lib/library-books-actions';

export interface UpdateFields {
  sections: Array<{ id: string; title: string }>;
  fields: Array<{ key: string; label: string; section: string; level: 'title' | 'copy' }>;
}
export interface UpdateCheck {
  id: string;
  fileName: string | null;
  status: 'validated' | 'committed';
  totalRows: number;
  readyRows: number;
  unchangedRows: number;
  rejectedRows: number;
  applied: number;
  problems: Array<{ row: number; accessionNo?: string; column: string; message: string }>;
  changes: Array<{
    row: number;
    accessionNo: string;
    title: string;
    changes: Array<{
      field: string;
      label: string;
      level: 'title' | 'copy';
      from: string;
      to: string;
    }>;
  }>;
  createdAt: string;
  committedAt: string | null;
}
export interface UpdateListRow {
  id: string;
  fileName: string | null;
  status: string;
  totalRows: number;
  readyRows: number;
  rejectedRows: number;
  applied: number;
  at: string;
  by: string | null;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Update existing books from Excel by accession no. (docs/design/36-library.md, "Library round 3", part
 * 2), as the employees' bulk upload: the template filled with the copies chosen and the columns ticked;
 * the filled file checked (old → new, the problems by row); applied all together; the files so far.
 */
export function BooksUpdate({
  fields,
  setup,
  check,
  list,
}: {
  fields: UpdateFields;
  setup: BookSetup | null;
  check: UpdateCheck | null;
  list: UpdateListRow[];
}) {
  const notes = check?.problems.filter((p) => p.row === 0) ?? [];
  const problems = check?.problems.filter((p) => p.row !== 0) ?? [];
  return (
    <>
      <div className="ep-grid-cards">
        <Card title="1. Download the template">
          <form
            method="get"
            action="/api/library-import/update-template"
            style={{ display: 'grid', gap: 'var(--sp-3)' }}
          >
            <p className="ep-field__help" style={{ margin: 0 }}>
              The copies come filled with what they have now, one row per accession no. Narrow them
              down if the library is large (up to 5,000 rows a file).
            </p>
            <div className="ep-dlog__filters">
              {(
                [
                  ['libraryId', 'Library', 'Every library', setup?.libraries ?? []],
                  [
                    'shelfId',
                    'Shelf',
                    'Every shelf',
                    (setup?.shelves ?? []).map((x) => ({
                      id: x.id,
                      name: `${x.code}${setup?.libraries.length && setup.libraries.length > 1 ? ` · ${setup.libraries.find((l) => l.id === x.libraryId)?.name ?? ''}` : ''}`,
                    })),
                  ],
                  ['materialTypeId', 'Material type', 'Every type', setup?.materialTypes ?? []],
                ] as Array<[string, string, string, Array<{ id: string; name: string }>]>
              ).map(([name, label, all, options]) => (
                <label key={name} className="ep-field" htmlFor={`bu-${name}`} style={{ margin: 0 }}>
                  <span className="ep-field__label">{label}</span>
                  <select id={`bu-${name}`} name={name} className="ep-select" defaultValue="">
                    <option value="">{all}</option>
                    {options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
              <legend className="ep-field__label">Columns</legend>
              <p className="ep-field__help" style={{ marginTop: 0 }}>
                Tick only what you want to change; leave everything unticked to include every field.
                The book fields belong to the title: a change there reaches every copy of it.
              </p>
              {fields.sections.map((s) => {
                const mine = fields.fields.filter((x) => x.section === s.id);
                if (!mine.length) return null;
                return (
                  <details key={s.id} style={{ marginBottom: 'var(--sp-2)' }}>
                    <summary>
                      {s.title} <span className="ep-field__help">({mine.length})</span>
                    </summary>
                    <div className="ep-profile__grid" style={{ marginTop: 'var(--sp-2)' }}>
                      {mine.map((x) => (
                        <label key={x.key} className="ep-check">
                          <input
                            type="checkbox"
                            className="ep-check__input"
                            name="field"
                            value={x.key}
                          />
                          <span className="ep-check__box" aria-hidden="true" />
                          <span className="ep-check__text">{x.label}</span>
                        </label>
                      ))}
                    </div>
                  </details>
                );
              })}
            </fieldset>
            <div>
              <button type="submit" className="ep-btn ep-btn--primary">
                <Icon name="download" size={16} /> Download template
              </button>
            </div>
          </form>
        </Card>
        <Card title="2. Upload the filled file">
          <form action={uploadBooksUpdate} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            <label className="ep-field" htmlFor="bu-file">
              <span className="ep-field__label">Excel or CSV file</span>
              <input
                id="bu-file"
                name="file"
                type="file"
                className="ep-input"
                accept=".xlsx,.csv"
                required
              />
              <span className="ep-field__help">
                Accession No. finds the copy. A blank cell means no change; type CLEAR to empty a
                field. Status and accession numbers keep their own screens. Up to 5,000 rows.
              </span>
            </label>
            <div>
              <button type="submit" className="ep-btn ep-btn--primary">
                Check the file
              </button>
            </div>
          </form>
        </Card>
      </div>

      {check ? (
        <Card
          title={`3. Check: ${check.fileName ?? 'upload'}`}
          style={{ marginTop: 'var(--sp-5)' }}
        >
          <div className="ep-desk__actions" style={{ marginTop: 0, marginBottom: 'var(--sp-3)' }}>
            <Badge tone="info">{check.totalRows} rows in the file</Badge>
            <Badge tone="success">{check.readyRows} ready</Badge>
            <Badge tone="neutral">{check.unchangedRows} unchanged</Badge>
            <Badge tone={check.rejectedRows ? 'danger' : 'neutral'}>
              {check.rejectedRows} with errors
            </Badge>
            {check.status === 'committed' ? (
              <Badge tone="success">{check.applied} applied</Badge>
            ) : null}
          </div>
          {notes.length ? (
            <ul className="ep-alert ep-alert--warning" style={{ paddingLeft: 'var(--sp-5)' }}>
              {notes.map((n) => (
                <li key={n.message}>{n.message}</li>
              ))}
            </ul>
          ) : null}
          {check.status === 'validated' && check.readyRows > 0 ? (
            <div className="ep-desk__actions" style={{ marginBottom: 'var(--sp-4)' }}>
              <ConfirmAction
                action={applyBooksUpdate}
                fields={{ id: check.id }}
                label={`Apply ${String(check.readyRows)} row${check.readyRows === 1 ? '' : 's'}`}
                variant="primary"
                title={`Apply ${String(check.readyRows)} row${check.readyRows === 1 ? '' : 's'}?`}
                confirmLabel="Apply"
              >
                <p>
                  The changes listed below are saved to the books, in each copy&apos;s history and
                  the audit log; a book field reaches every copy of its title. Rows with errors are
                  skipped; fix them and upload again.
                </p>
              </ConfirmAction>
              <span className="ep-field__help">Rows with errors are not applied.</span>
            </div>
          ) : null}
          {check.status === 'committed' && check.committedAt ? (
            <p className="ep-field__help">Applied on {when(check.committedAt)}.</p>
          ) : null}
          {problems.length ? (
            <>
              <h3 className="ep-card__title">Errors ({problems.length})</h3>
              <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Errors">
                <table className="ep-table ep-table--dense">
                  <thead>
                    <tr>
                      <th scope="col">Row</th>
                      <th scope="col">Accession no.</th>
                      <th scope="col">Column</th>
                      <th scope="col">Problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {problems.map((p, i) => (
                      <tr key={`${String(p.row)}-${p.column}-${String(i)}`}>
                        <td>{p.row}</td>
                        <td>{p.accessionNo ?? '—'}</td>
                        <td>{p.column || '—'}</td>
                        <td>{p.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
          {check.changes.length ? (
            <>
              <h3 className="ep-card__title" style={{ marginTop: 'var(--sp-4)' }}>
                Changes ({check.readyRows})
              </h3>
              <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Changes">
                <table className="ep-table ep-table--dense">
                  <thead>
                    <tr>
                      <th scope="col">Row</th>
                      <th scope="col">Accession no.</th>
                      <th scope="col">Book</th>
                      <th scope="col">Old → new</th>
                    </tr>
                  </thead>
                  <tbody>
                    {check.changes.map((c) => (
                      <tr key={c.row}>
                        <td>{c.row}</td>
                        <td>{c.accessionNo}</td>
                        <td>{c.title}</td>
                        <td>
                          {c.changes.map((x) => (
                            <div key={x.field}>
                              <strong>{x.label}</strong>
                              {x.level === 'title' ? (
                                <span className="ep-field__help"> (every copy)</span>
                              ) : null}
                              : {x.from || '—'} → {x.to || '(emptied)'}
                            </div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </Card>
      ) : null}

      <h2 className="ep-card__title" style={{ marginTop: 'var(--sp-5)' }}>
        Update files
      </h2>
      {list.length ? (
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Update files">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col">State</th>
                <th scope="col" className="is-numeric">
                  Rows
                </th>
                <th scope="col" className="is-numeric">
                  Ready
                </th>
                <th scope="col" className="is-numeric">
                  With errors
                </th>
                <th scope="col" className="is-numeric">
                  Applied
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.id}>
                  <td>
                    <a href={`/library/import?mode=update&check=${x.id}`}>
                      {x.fileName ?? 'upload'}
                    </a>
                    <div className="ep-field__help">
                      {when(x.at)}
                      {x.by ? ` · ${x.by}` : ''}
                    </div>
                  </td>
                  <td>
                    <Badge tone={x.status === 'committed' ? 'success' : 'info'}>
                      {x.status === 'committed' ? 'Applied' : 'Checked'}
                    </Badge>
                  </td>
                  <td className="is-numeric">{x.totalRows}</td>
                  <td className="is-numeric">{x.readyRows}</td>
                  <td className="is-numeric">{x.rejectedRows}</td>
                  <td className="is-numeric">{x.applied}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="ep-field__help">No update file yet.</p>
      )}
    </>
  );
}
