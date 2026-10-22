'use client';
import { useMemo, useState, useTransition } from 'react';
import { RefDatalist } from '@/components/RefDatalist';
import { deskClassLoans, deskReturnMany } from '@/lib/library-desk-actions';
import { dmy, holdNote, rupees, type DeskClass, type DeskClassRow } from '@/lib/library-desk';

const ALL = 'All sections';

/**
 * Return by class: the books the pupils of a class (or one section) hold, filtered by book no.,
 * admission no. or name, returned by ticks or all at once (in good condition); the late fines go to
 * the fees counter as misc fees.
 */
export function ClassReturns({ classes }: { classes: DeskClass[] }) {
  const [klass, setKlass] = useState('');
  const [section, setSection] = useState(ALL);
  const [rows, setRows] = useState<DeskClassRow[] | null>(null);
  const [filter, setFilter] = useState('');
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const chosen = classes.find((c) => c.name.toLowerCase() === klass.trim().toLowerCase()) ?? null;
  const sectionId =
    chosen && section !== ALL
      ? chosen.sections.find((s) => s.name.toLowerCase() === section.trim().toLowerCase())?.id
      : undefined;
  const load = () =>
    start(async () => {
      if (!chosen) return setError('Pick the class from the list');
      if (section !== ALL && section.trim() && !sectionId)
        return setError('Pick the section from the list');
      const r = await deskClassLoans(chosen.id, sectionId);
      if (!r.ok) return setError(r.error);
      setError(null);
      setMessage(null);
      setRows(r.data.rows);
      setTicked(new Set());
    });
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (rows ?? []).filter(
      (r) =>
        !f ||
        r.accessionNo.toLowerCase().includes(f) ||
        r.admissionNo.toLowerCase().includes(f) ||
        r.student.toLowerCase().includes(f) ||
        r.title.toLowerCase().includes(f),
    );
  }, [rows, filter]);
  const giveBack = (list: DeskClassRow[]) =>
    start(async () => {
      if (!list.length) return;
      const r = await deskReturnMany(list.map((x) => x.accessionNo));
      if (!r.ok) return setError(r.error);
      setError(null);
      const back = new Set(list.map((x) => x.loanId));
      setRows((x) => (x ?? []).filter((y) => !back.has(y.loanId)));
      setTicked(new Set());
      const kept = r.data.loans.map(holdNote).filter(Boolean);
      setMessage(
        `${String(r.data.loans.length)} book${r.data.loans.length === 1 ? '' : 's'} returned${r.data.fines ? `; late fines of ${rupees(r.data.fines)} are sent to the fees counter as misc fees` : ''}${kept.length ? `. ${kept.join('. ')}` : ''}`,
      );
    });
  const toggle = (id: string) =>
    setTicked((t) => {
      const n = new Set(t);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allShownTicked = shown.length > 0 && shown.every((r) => ticked.has(r.loanId));

  return (
    <section className="ep-card" aria-labelledby="ds-cl-h">
      <h2 id="ds-cl-h" className="ep-card__title">
        Books held by a class
      </h2>
      <form
        className="ep-desk__scan"
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <RefDatalist
          id="ds-cl-class"
          label="Class"
          required
          options={classes.map((c) => ({ value: c.name }))}
          onValue={(v) => {
            setKlass(v);
            setSection(ALL);
          }}
        />
        <RefDatalist
          key={chosen?.id ?? 'none'}
          id="ds-cl-section"
          label="Section"
          defaultValue={ALL}
          options={[{ value: ALL }, ...(chosen?.sections ?? []).map((s) => ({ value: s.name }))]}
          onValue={(v) => setSection(v || ALL)}
        />
        <button type="submit" className="ep-btn ep-btn--primary" disabled={pending}>
          {pending ? 'Loading…' : 'Show the books'}
        </button>
      </form>
      {error ? (
        <p className="ep-alert ep-alert--danger" role="alert" style={{ marginTop: 'var(--sp-2)' }}>
          {error}
        </p>
      ) : null}
      {message ? (
        <p
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginTop: 'var(--sp-2)' }}
        >
          {message} · <a href="/library/fines">Late fines</a>
        </p>
      ) : null}
      {rows ? (
        rows.length === 0 ? (
          <p className="ep-field__help" style={{ marginTop: 'var(--sp-3)' }}>
            No book is out with this class.
          </p>
        ) : (
          <>
            <div className="ep-desk__actions" style={{ justifyContent: 'space-between' }}>
              <label
                className="ep-field"
                htmlFor="ds-cl-filter"
                style={{ margin: 0, flex: '1 1 16rem' }}
              >
                <span className="ep-field__label">Filter the list</span>
                <input
                  id="ds-cl-filter"
                  className="ep-input"
                  type="search"
                  value={filter}
                  placeholder="Book no., admission no., name or title"
                  onChange={(e) => setFilter(e.target.value)}
                />
              </label>
              <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
                <button
                  type="button"
                  className="ep-btn ep-btn--secondary"
                  disabled={pending || ticked.size === 0}
                  onClick={() => giveBack((rows ?? []).filter((r) => ticked.has(r.loanId)))}
                >
                  Return ticked ({ticked.size})
                </button>
                <button
                  type="button"
                  className="ep-btn ep-btn--primary"
                  disabled={pending || shown.length === 0}
                  onClick={() => giveBack(shown)}
                >
                  Return all shown ({shown.length})
                </button>
              </span>
            </div>
            <div
              className="ep-table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Books held by the class"
              style={{ marginTop: 'var(--sp-3)' }}
            >
              <table className="ep-table ep-table--dense">
                <thead>
                  <tr>
                    <th scope="col">
                      <input
                        type="checkbox"
                        aria-label="Tick every book shown"
                        checked={allShownTicked}
                        onChange={() =>
                          setTicked(
                            allShownTicked ? new Set() : new Set(shown.map((r) => r.loanId)),
                          )
                        }
                      />
                    </th>
                    <th scope="col">#</th>
                    <th scope="col">Pupil</th>
                    <th scope="col">Book</th>
                    <th scope="col">Dates</th>
                    <th scope="col">
                      <span className="ep-sr-only">Return</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r, i) => (
                    <tr key={r.loanId}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Tick ${r.accessionNo} of ${r.student}`}
                          checked={ticked.has(r.loanId)}
                          onChange={() => toggle(r.loanId)}
                        />
                      </td>
                      <td>{i + 1}</td>
                      <td>
                        <strong>{r.student}</strong>
                        <div className="ep-field__help">
                          {r.admissionNo} · {r.place}
                          {r.rollNo !== null ? ` · roll ${String(r.rollNo)}` : ''}
                        </div>
                      </td>
                      <td>
                        {r.title}
                        <div className="ep-field__help">
                          {r.accessionNo}
                          {r.barcode ? ` · barcode ${r.barcode}` : ''}
                        </div>
                      </td>
                      <td>
                        Issued {dmy(r.issuedOn)}
                        <div className="ep-field__help">
                          Due {dmy(r.dueOn)}
                          {r.daysOverdue > 0 ? ` · ${String(r.daysOverdue)} days late` : ''}
                        </div>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                          disabled={pending}
                          aria-label={`Return ${r.accessionNo} of ${r.student}`}
                          onClick={() => giveBack([r])}
                        >
                          Return
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : null}
    </section>
  );
}
