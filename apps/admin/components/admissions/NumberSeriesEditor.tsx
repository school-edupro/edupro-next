'use client';
import { Badge } from '@edupro/ui';
import { useState, useTransition } from 'react';
import { archiveNumberSeries, saveNumberSeries } from '@/lib/admission-scores-actions';
import { seriesText, type NumberSeries, type NumberSeriesSetup } from '@/lib/admission-scores';

type Draft = {
  id: string | null;
  kind: 'registration' | 'admission';
  cycleId: string;
  classId: string | null;
  name: string;
  prefix: string;
  nextNo: number;
  digits: number;
  conditions: Array<{ field: string; op: 'eq'; value: string }>;
};
const KIND = { registration: 'Registration no.', admission: 'Admission no.' } as const;

/**
 * Number series (docs/design/48, part 5): for Registration no. and Admission no., per session and class
 * (or every class), with answers a registration must have (round, student type, board); a prefix, the
 * next number and its digits, with the number it will give next. The most specific series wins.
 */
export function NumberSeriesEditor({
  initial,
  questions,
  canEdit,
}: {
  initial: NumberSeriesSetup;
  /** form questions (key, label, choices) a series may depend on */
  questions: Array<{ key: string; label: string; options: string[] }>;
  canEdit: boolean;
}) {
  const [series, setSeries] = useState(initial.series);
  const first = initial.cycles[0];
  const fresh = (kind: Draft['kind'] = 'registration'): Draft => ({
    id: null,
    kind,
    cycleId: first?.id ?? '',
    classId: null,
    name: '',
    prefix: '',
    nextNo: 1,
    digits: 4,
    conditions: [],
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const cycle = initial.cycles.find((y) => y.id === draft?.cycleId);
  const q = (key: string) => questions.find((x) => x.key === key);

  const save = () =>
    start(async () => {
      if (!draft) return;
      const r = await saveNumberSeries(draft.id, {
        kind: draft.kind,
        cycleId: draft.cycleId,
        classId: draft.classId,
        name: draft.name.trim(),
        prefix: draft.prefix.trim(),
        nextNo: draft.nextNo,
        digits: draft.digits,
        conditions: draft.conditions.filter((c) => c.field && c.value),
      });
      if (r.ok) {
        setSeries(r.data.series);
        setDraft(null);
        setMsg({ tone: 'success', text: 'Series saved.' });
      } else setMsg({ tone: 'danger', text: r.error });
    });
  const archive = (s: NumberSeries) =>
    start(async () => {
      const r = await archiveNumberSeries(s.id);
      if (r.ok) {
        setSeries(r.data.series);
        setMsg({ tone: 'success', text: `“${s.name}” stopped; numbers already given stay.` });
      } else setMsg({ tone: 'danger', text: r.error });
    });

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
      {msg ? (
        <p
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
          style={{ margin: 0 }}
        >
          {msg.text}
        </p>
      ) : null}
      {canEdit && !draft ? (
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="ep-btn ep-btn--primary ep-btn--sm"
            onClick={() => setDraft(fresh('registration'))}
          >
            Add a registration no. series
          </button>
          <button
            type="button"
            className="ep-btn ep-btn--secondary ep-btn--sm"
            onClick={() => setDraft(fresh('admission'))}
          >
            Add an admission no. series
          </button>
        </div>
      ) : null}
      {draft ? (
        <section className="ep-card" aria-labelledby="ns-form">
          <h2 id="ns-form" className="ep-card__title">
            {draft.id ? 'Change the series' : `New ${KIND[draft.kind]} series`}
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
              gap: 'var(--sp-3)',
              alignItems: 'end',
            }}
          >
            <label className="ep-field">
              <span className="ep-field__label">Number</span>
              <select
                className="ep-select"
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value as Draft['kind'] })}
              >
                <option value="registration">{KIND.registration}</option>
                <option value="admission">{KIND.admission}</option>
              </select>
            </label>
            <label className="ep-field">
              <span className="ep-field__label">Session</span>
              <select
                className="ep-select"
                value={draft.cycleId}
                onChange={(e) => setDraft({ ...draft, cycleId: e.target.value, classId: null })}
              >
                {initial.cycles.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field">
              <span className="ep-field__label">Class</span>
              <select
                className="ep-select"
                value={draft.classId ?? ''}
                onChange={(e) => setDraft({ ...draft, classId: e.target.value || null })}
              >
                <option value="">Every class of the session</option>
                {(cycle?.classes ?? []).map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field">
              <span className="ep-field__label">Name</span>
              <input
                className="ep-input"
                maxLength={80}
                placeholder="e.g. DP1 Round 1 External"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label className="ep-field">
              <span className="ep-field__label">Prefix (optional)</span>
              <input
                className="ep-input"
                maxLength={30}
                placeholder="e.g. DPSNMI, N2026"
                value={draft.prefix}
                onChange={(e) => setDraft({ ...draft, prefix: e.target.value.replace(/\s/g, '') })}
              />
            </label>
            <label className="ep-field">
              <span className="ep-field__label">Next number</span>
              <input
                className="ep-input"
                inputMode="numeric"
                value={draft.nextNo}
                onChange={(e) =>
                  setDraft({ ...draft, nextNo: Number(e.target.value.replace(/\D/g, '') || 0) })
                }
              />
            </label>
            <label className="ep-field">
              <span className="ep-field__label">Digits</span>
              <input
                className="ep-input"
                inputMode="numeric"
                value={draft.digits}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    digits: Math.min(
                      10,
                      Math.max(1, Number(e.target.value.replace(/\D/g, '') || 1)),
                    ),
                  })
                }
              />
            </label>
          </div>
          <div style={{ display: 'grid', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}>
            <span className="ep-field__label">
              Only for registrations whose answer is (optional)
            </span>
            {draft.conditions.map((c, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  gap: 'var(--sp-2)',
                  flexWrap: 'wrap',
                  alignItems: 'flex-end',
                }}
              >
                <label className="ep-field" style={{ margin: 0 }}>
                  <span className="ep-sr-only">Question</span>
                  <select
                    className="ep-select"
                    value={c.field}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        conditions: draft.conditions.map((x, j) =>
                          j === i ? { ...x, field: e.target.value } : x,
                        ),
                      })
                    }
                  >
                    <option value="">Choose the question</option>
                    {questions.map((x) => (
                      <option key={x.key} value={x.key}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="ep-field__help">is</span>
                <label className="ep-field" style={{ margin: 0 }}>
                  <span className="ep-sr-only">Answer</span>
                  {q(c.field)?.options.length ? (
                    <select
                      className="ep-select"
                      value={c.value}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          conditions: draft.conditions.map((x, j) =>
                            j === i ? { ...x, value: e.target.value } : x,
                          ),
                        })
                      }
                    >
                      <option value="">Choose the answer</option>
                      {q(c.field)!.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="ep-input"
                      value={c.value}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          conditions: draft.conditions.map((x, j) =>
                            j === i ? { ...x, value: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  )}
                </label>
                <button
                  type="button"
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  onClick={() =>
                    setDraft({ ...draft, conditions: draft.conditions.filter((_, j) => j !== i) })
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            {draft.conditions.length < 5 ? (
              <button
                type="button"
                className="ep-btn ep-btn--ghost ep-btn--sm"
                style={{ justifySelf: 'start' }}
                onClick={() =>
                  setDraft({
                    ...draft,
                    conditions: [...draft.conditions, { field: '', op: 'eq', value: '' }],
                  })
                }
              >
                Add an answer (round, student type, board…)
              </button>
            ) : null}
          </div>
          <p className="ep-alert ep-alert--info" role="status" style={{ marginTop: 'var(--sp-3)' }}>
            Next {KIND[draft.kind]} will be:{' '}
            <strong>{seriesText(draft.prefix, draft.nextNo, draft.digits)}</strong>
          </p>
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              disabled={pending || draft.name.trim().length < 2 || !draft.cycleId}
              onClick={save}
            >
              {pending ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="ep-btn ep-btn--ghost" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </section>
      ) : null}
      {initial.cycles.map((y) => {
        const list = series.filter((s) => s.cycleId === y.id);
        return (
          <section key={y.id} className="ep-card" aria-labelledby={`ns-${y.id}`}>
            <h2 id={`ns-${y.id}`} className="ep-card__title">
              {y.name}
            </h2>
            <p className="ep-field__help">
              Without a series: registration numbers {y.defaultRegistration}, …; admission numbers
              continue the school&rsquo;s last one.
            </p>
            {list.length === 0 ? (
              <p className="ep-field__help">No series for this session yet.</p>
            ) : (
              <div className="ep-table-wrap">
                <table className="ep-table">
                  <caption className="ep-sr-only">Number series of {y.name}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Series</th>
                      <th scope="col">Number</th>
                      <th scope="col">Class</th>
                      <th scope="col">Only when</th>
                      <th scope="col">Next</th>
                      <th scope="col">Last given</th>
                      {canEdit ? (
                        <th scope="col">
                          <span className="ep-sr-only">Actions</span>
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((s) => (
                      <tr key={s.id}>
                        <td>{s.name}</td>
                        <td>
                          <Badge tone={s.kind === 'registration' ? 'info' : 'success'}>
                            {KIND[s.kind]}
                          </Badge>
                        </td>
                        <td>{s.className ?? 'Every class'}</td>
                        <td>
                          {s.conditions.length
                            ? s.conditions
                                .map((c) => `${q(c.field)?.label ?? c.field} is ${c.value ?? ''}`)
                                .join('; ')
                            : '-'}
                        </td>
                        <td>
                          <strong>{s.next}</strong>
                        </td>
                        <td>
                          {s.lastGiven ?? '-'}
                          {s.given ? <div className="ep-kicker">{s.given} given</div> : null}
                        </td>
                        {canEdit ? (
                          <td>
                            <span style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}>
                              <button
                                type="button"
                                className="ep-btn ep-btn--ghost ep-btn--sm"
                                aria-label={`Change ${s.name}`}
                                onClick={() =>
                                  setDraft({
                                    id: s.id,
                                    kind: s.kind,
                                    cycleId: s.cycleId,
                                    classId: s.classId,
                                    name: s.name,
                                    prefix: s.prefix,
                                    nextNo: s.nextNo,
                                    digits: s.digits,
                                    conditions: s.conditions.map((c) => ({
                                      field: c.field,
                                      op: 'eq' as const,
                                      value: c.value ?? '',
                                    })),
                                  })
                                }
                              >
                                Change
                              </button>
                              <button
                                type="button"
                                className="ep-btn ep-btn--ghost ep-btn--sm"
                                aria-label={`Stop ${s.name}`}
                                disabled={pending}
                                onClick={() => archive(s)}
                              >
                                Stop
                              </button>
                            </span>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
