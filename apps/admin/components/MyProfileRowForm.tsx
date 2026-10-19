import { Button } from '@edupro/ui';
import type { MyList, MyListRow } from '@/lib/my-profile';

/**
 * Add or change one row of a list on My profile (0187). Field names: `r.<key>` for the row, `bool`
 * markers for tick boxes, `num` markers for years, `doc.file` for a new document, `proof.<typeId>` for
 * the proof the school asks for. The server action turns these into one row change.
 */
export function MyProfileRowForm({
  list,
  row,
  action,
  backHref,
}: {
  list: MyList;
  row: MyListRow | null;
  action: (fd: FormData) => Promise<void>;
  backHref: string;
}) {
  const v = row?.values ?? {};
  const str = (k: string) => {
    const x = v[k];
    return x === null || x === undefined ? '' : String(x);
  };
  return (
    <form action={action} className="ep-card ep-acr-card">
      <input type="hidden" name="kind" value={list.id} />
      <input type="hidden" name="op" value={row ? 'edit' : 'add'} />
      {row ? <input type="hidden" name="rowId" value={row.id} /> : null}
      {list.columns.map((c) => {
        const id = `r-${c.key}`;
        if (c.type === 'file')
          return (
            <label key={c.key} className="ep-field" htmlFor="doc-file">
              <span className="ep-field__label">{c.label} (PDF or photo, up to 5 MB)</span>
              <input
                id="doc-file"
                name="doc.file"
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                required
              />
            </label>
          );
        if (c.type === 'boolean')
          return (
            <label key={c.key} className="ep-check" htmlFor={id}>
              <input type="hidden" name="bool" value={c.key} />
              <input
                id={id}
                className="ep-check__input"
                type="checkbox"
                name={`r.${c.key}`}
                defaultChecked={v[c.key] === true}
              />{' '}
              {c.label}
            </label>
          );
        if (c.type === 'doctype' || c.type === 'select')
          return (
            <label key={c.key} className="ep-field" htmlFor={id}>
              <span className="ep-field__label">
                {c.label}
                {c.required ? ' *' : ''}
              </span>
              <select
                id={id}
                name={`r.${c.key}`}
                className="ep-select"
                defaultValue={str(c.key)}
                required={c.required}
              >
                <option value="">—</option>
                {c.type === 'doctype'
                  ? (
                      c.options as Array<{ id: string; name: string; hasExpiry: boolean }> | null
                    )?.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                        {o.hasExpiry ? ' (needs valid-till date)' : ''}
                      </option>
                    ))
                  : (c.options as string[] | null)?.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                {str(c.key) &&
                !(c.options as Array<string | { id: string }> | null)?.some((o) =>
                  typeof o === 'string' ? o === str(c.key) : o.id === str(c.key),
                ) ? (
                  <option value={str(c.key)}>{str(c.key)}</option>
                ) : null}
              </select>
            </label>
          );
        return (
          <label key={c.key} className="ep-field" htmlFor={id}>
            <span className="ep-field__label">
              {c.label}
              {c.required ? ' *' : ''}
            </span>
            {c.type === 'year' ? <input type="hidden" name="num" value={c.key} /> : null}
            <input
              id={id}
              name={`r.${c.key}`}
              className="ep-input"
              type={c.type === 'date' ? 'date' : c.type === 'year' ? 'number' : 'text'}
              min={c.type === 'year' ? 1940 : undefined}
              max={c.type === 'year' ? 2100 : undefined}
              defaultValue={str(c.key)}
              maxLength={c.max ?? 200}
              required={c.required}
            />
          </label>
        );
      })}
      {list.proof ? (
        <label className="ep-field" htmlFor={`proof-${list.proof.typeId}`}>
          <span className="ep-field__label">
            Attach {list.proof.name} (PDF or photo, up to 5 MB)
          </span>
          <input
            id={`proof-${list.proof.typeId}`}
            name={`proof.${list.proof.typeId}`}
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            required
          />
        </label>
      ) : null}
      <label className="ep-field" htmlFor="reason">
        <span className="ep-field__label">Why (optional)</span>
        <input id="reason" name="reason" className="ep-input" maxLength={500} />
      </label>
      <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
        <Button type="submit">{row ? 'Send the change' : 'Add'}</Button>
        <a className="ep-btn ep-btn--ghost" href={backHref}>
          Cancel
        </a>
      </div>
    </form>
  );
}
