import { Badge, Button } from '@edupro/ui';
import { listEditable, type MyList, type MyRowData } from '@/lib/my-profile';

const dmy = (v: unknown) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
    ? `${v.slice(8, 10)}-${v.slice(5, 7)}-${v.slice(0, 4)}`
    : v === null || v === undefined || v === ''
      ? '—'
      : String(v);

/** The cells of one row: documents show the type, number, dates, file and the HR check; others their columns. */
function cells(l: MyList, values: MyRowData): Array<[string, string]> {
  if (l.id === 'documents')
    return [
      ['Document', String(values.typeName ?? '—')],
      ['Number', dmy(values.number)],
      ['Issued on', dmy(values.issuedOn)],
      ['Valid till', dmy(values.expiresOn)],
      ['File', String(values.fileName ?? '—')],
      ['Checked by HR', values.verified ? 'Yes' : 'Not yet'],
    ];
  return l.columns.map((c) => [
    c.label,
    c.type === 'boolean'
      ? values[c.key]
        ? 'Yes'
        : 'No'
      : c.type === 'date'
        ? dmy(values[c.key])
        : values[c.key] === null || values[c.key] === undefined || values[c.key] === ''
          ? '—'
          : String(values[c.key]),
  ]);
}

/**
 * The row lists of My profile (0187): education, languages, work experience and documents as tables with
 * Add, Change and Remove (routed for approval like other changes), rows waiting for a decision marked.
 */
export function MyProfileLists({
  lists,
  canEdit,
  editBase,
  removeAction,
}: {
  lists: MyList[];
  canEdit: boolean;
  /** e.g. /me/profile/edit or /profile/edit */
  editBase: string;
  removeAction: (fd: FormData) => Promise<void>;
}) {
  return (
    <>
      {lists.map((l) => {
        const canChange = canEdit && listEditable(l);
        const headers = l.rows[0]
          ? cells(l, l.rows[0].values).map(([h]) => h)
          : l.id === 'documents'
            ? ['Document', 'Number', 'Issued on', 'Valid till', 'File', 'Checked by HR']
            : l.columns.map((c) => c.label);
        return (
          <section
            key={l.id}
            className="ep-card ep-acr-card"
            aria-labelledby={`list-${l.id}`}
            style={{ marginBottom: 'var(--sp-3)' }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 'var(--sp-2)',
                alignItems: 'center',
              }}
            >
              <h2 id={`list-${l.id}`} className="ep-card__title" style={{ margin: 0 }}>
                {l.title}
                <span className="ep-field__help" style={{ marginLeft: 'var(--sp-2)' }}>
                  {l.level === 'edit_direct'
                    ? 'changes save at once'
                    : l.level === 'edit_approval'
                      ? 'changes need approval'
                      : 'shown only'}
                  {l.proof ? ` · attach ${l.proof.name}` : ''}
                </span>
              </h2>
              {canChange ? (
                <a
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  href={`${editBase}?section=${l.id}&add=1`}
                >
                  Add
                </a>
              ) : null}
            </div>
            {l.rows.length ? (
              <div className="ep-table-wrap">
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">{l.title}</caption>
                  <thead>
                    <tr>
                      {headers.map((h) => (
                        <th key={h} scope="col">
                          {h}
                        </th>
                      ))}
                      <th scope="col">
                        <span className="ep-sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {l.rows.map((r) => (
                      <tr key={r.id}>
                        {cells(l, r.values).map(([h, v], i) => (
                          <td key={h}>{i === 0 ? <strong>{v}</strong> : v}</td>
                        ))}
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {r.pending ? (
                            <Badge tone="warning">
                              Waiting for approval:{' '}
                              {r.pending.op === 'remove' ? 'removal' : 'change'}
                            </Badge>
                          ) : canChange ? (
                            <span style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}>
                              {l.id !== 'documents' ? (
                                <a
                                  className="ep-btn ep-btn--ghost ep-btn--sm"
                                  href={`${editBase}?section=${l.id}&row=${r.id}`}
                                >
                                  Change
                                </a>
                              ) : null}
                              <form action={removeAction}>
                                <input type="hidden" name="kind" value={l.id} />
                                <input type="hidden" name="rowId" value={r.id} />
                                <Button type="submit" variant="ghost" size="sm">
                                  Remove
                                </Button>
                              </form>
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="ep-field__help">Nothing on file yet.</p>
            )}
            {l.pendingAdds.length ? (
              <ul className="ep-acr-events" style={{ marginTop: 'var(--sp-2)' }}>
                {l.pendingAdds.map((a) => (
                  <li key={a.key}>
                    <Badge tone="warning">Waiting for approval: new</Badge> {a.summary}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}
    </>
  );
}
