'use client';
import { Badge } from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { PaperItem, PaperItemsView } from '@/lib/admission-papers';
import { importPaperSubjects, savePaperItems } from '@/lib/admission-papers-actions';

type Row = {
  key: string;
  id?: string;
  name: string;
  kind: PaperItem['kind'];
  maxMarks: string;
  status: PaperItem['status'];
  used: number;
  usedIn: PaperItem['usedIn'];
};
let seq = 0;
const rowOf = (x?: PaperItem): Row => ({
  key: `i${String(++seq)}`,
  ...(x ? { id: x.id } : {}),
  name: x?.name ?? '',
  kind: x?.kind ?? 'test',
  maxMarks: x?.maxMarks != null ? String(x.maxMarks) : '',
  status: x?.status ?? 'active',
  used: x?.used ?? 0,
  usedIn: x?.usedIn ?? [],
});
const KIND: Record<PaperItem['kind'], string> = {
  test: 'Written test',
  interview: 'Interview',
  both: 'Both',
};

/**
 * The school's test subjects and interview parameters (docs/design/57, follow-up): the list a class's
 * paper picks its parts from. An entry is for the written test, the interview or both, with an
 * optional usual maximum; a rename reaches the papers using it; an entry in use is switched off,
 * never deleted. The school's scholastic subjects can be added in one go.
 */
export function PaperItemsEditor({
  initial,
  canEdit,
}: {
  initial: PaperItemsView;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<Row[]>(() => initial.items.map(rowOf));
  const [subjects, setSubjects] = useState(initial.subjects);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const set = (i: number, patch: Partial<Row>) =>
    setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const problem = (): string | null => {
    const names = new Set<string>();
    for (const r of rows) {
      const n = r.name.trim();
      if (!n) return 'Give every entry a name.';
      if (names.has(n.toLowerCase())) return `${n} is on the list twice.`;
      names.add(n.toLowerCase());
      if (r.maxMarks !== '' && !(Number(r.maxMarks) > 0 && Number(r.maxMarks) <= 1000))
        return `${n}: the usual maximum is from 1 to 1000.`;
      const misfit = r.usedIn.find((st) => r.kind !== 'both' && r.kind !== st);
      if (misfit)
        return `${n} is on ${misfit === 'test' ? 'a written test' : 'an interview'} paper: keep it for ${KIND[misfit].toLowerCase()} or both.`;
    }
    return null;
  };
  const save = () => {
    const p = problem();
    if (p) return setMsg({ tone: 'danger', text: p });
    start(async () => {
      setMsg(null);
      const r = await savePaperItems(
        rows.map((x) => ({
          ...(x.id ? { id: x.id } : {}),
          name: x.name.trim(),
          kind: x.kind,
          maxMarks: x.maxMarks === '' ? null : Number(x.maxMarks),
          status: x.status,
        })),
      );
      if (!r.ok) return setMsg({ tone: 'danger', text: r.error });
      setRows(r.data.items.map(rowOf));
      setSubjects(r.data.subjects);
      setMsg({ tone: 'success', text: 'Saved. The papers show the new names.' });
      router.refresh();
    });
  };
  const addSubjects = () =>
    start(async () => {
      setMsg(null);
      const r = await importPaperSubjects();
      if (!r.ok) return setMsg({ tone: 'danger', text: r.error });
      setRows(r.data.items.map(rowOf));
      setSubjects(r.data.subjects);
      setMsg({
        tone: 'success',
        text: `${String(r.data.added)} subject${r.data.added === 1 ? '' : 's'} added for the written test.`,
      });
      router.refresh();
    });

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
      <p className="ep-field__help" style={{ margin: 0 }}>
        A class&apos;s paper picks its subjects and parameters from this list. The usual maximum
        fills the Maximum box when the entry is picked; each paper may still change it. Renaming an
        entry renames it on every paper; marks already entered keep the old name.
      </p>
      {canEdit && subjects.length ? (
        <p className="ep-alert ep-alert--info" role="status" style={{ margin: 0 }}>
          <span>
            {subjects.length} of the school&apos;s subjects {subjects.length === 1 ? 'is' : 'are'}{' '}
            not on the list: {subjects.slice(0, 8).join(', ')}
            {subjects.length > 8 ? ` and ${String(subjects.length - 8)} more` : ''}.{' '}
            <button
              type="button"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              disabled={pending}
              onClick={addSubjects}
            >
              Add {subjects.length === 1 ? 'it' : 'them'} for the written test
            </button>
          </span>
        </p>
      ) : null}
      <div
        className="ep-table-wrap"
        tabIndex={0}
        role="region"
        aria-label="Subjects and parameters (scrolls sideways)"
      >
        <table className="ep-table ep-table--dense">
          <caption className="ep-sr-only">Subjects and parameters</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Used for</th>
              <th scope="col">Usual maximum</th>
              <th scope="col">On the papers</th>
              <th scope="col">
                <span className="ep-sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} data-off={r.status === 'inactive' || undefined}>
                <td>
                  <input
                    className="ep-input"
                    aria-label="Name"
                    maxLength={60}
                    value={r.name}
                    disabled={!canEdit}
                    onChange={(e) => set(i, { name: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    className="ep-select"
                    aria-label={`What ${r.name || 'the entry'} is used for`}
                    value={r.kind}
                    disabled={!canEdit}
                    onChange={(e) => set(i, { kind: e.target.value as Row['kind'] })}
                  >
                    {(Object.keys(KIND) as Array<Row['kind']>).map((k) => (
                      <option key={k} value={k}>
                        {KIND[k]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    className="ep-input"
                    type="number"
                    min={1}
                    max={1000}
                    step="0.5"
                    placeholder="None"
                    aria-label={`Usual maximum of ${r.name || 'the entry'}`}
                    style={{ width: '7rem' }}
                    value={r.maxMarks}
                    disabled={!canEdit}
                    onChange={(e) => set(i, { maxMarks: e.target.value })}
                  />
                </td>
                <td>
                  {r.used ? `${String(r.used)} paper${r.used === 1 ? '' : 's'}` : '-'}{' '}
                  {r.status === 'inactive' ? <Badge tone="neutral">Off</Badge> : null}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {canEdit && r.used ? (
                    <button
                      type="button"
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      onClick={() =>
                        set(i, { status: r.status === 'active' ? 'inactive' : 'active' })
                      }
                    >
                      {r.status === 'active' ? 'Switch off' : 'Switch on'}
                      <span className="ep-sr-only"> {r.name}</span>
                    </button>
                  ) : null}
                  {canEdit && !r.used ? (
                    <button
                      type="button"
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      onClick={() => setRows((cur) => cur.filter((_, j) => j !== i))}
                    >
                      Remove<span className="ep-sr-only"> {r.name}</span>
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
          <button
            type="button"
            className="ep-btn ep-btn--secondary ep-btn--sm"
            disabled={rows.length >= 300}
            onClick={() => setRows((cur) => [...cur, rowOf()])}
          >
            Add an entry
          </button>
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            disabled={pending}
            onClick={save}
          >
            {pending ? 'Saving…' : 'Save the list'}
          </button>
        </div>
      ) : null}
      {msg ? (
        <p
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
          style={{ margin: 0 }}
        >
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
