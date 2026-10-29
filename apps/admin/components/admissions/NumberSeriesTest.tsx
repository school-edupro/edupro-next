'use client';
import { useState, useTransition } from 'react';
import type {
  NumberSeries,
  NumberSeriesSetup,
  NumberSeriesTestResult,
} from '@/lib/admission-scores';
import { testNumberSeries } from '@/lib/admission-scores-actions';

/**
 * Test a series (docs/design/63): pick the number, session, class and the answers the series look at;
 * the page says which series a registration like that would take and the number it would get now.
 * Nothing is used.
 */
export function NumberSeriesTest({
  setup,
  series,
  questions,
  defaultCycleId,
}: {
  setup: NumberSeriesSetup;
  series: NumberSeries[];
  questions: Array<{ key: string; label: string; options: string[] }>;
  defaultCycleId: string;
}) {
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<'registration' | 'admission'>('registration');
  const [cycleId, setCycleId] = useState(defaultCycleId);
  const cycle = setup.cycles.find((y) => y.id === cycleId);
  const [classId, setClassId] = useState(cycle?.classes[0]?.id ?? '');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [out, setOut] = useState<{ tone: 'success' | 'info' | 'danger'; text: string } | null>(
    null,
  );
  // only the questions this session's series look at
  const asked = [
    ...new Set(
      series
        .filter((s) => s.cycleId === cycleId && s.kind === kind)
        .flatMap((s) => s.conditions.map((c) => c.field)),
    ),
  ].map((key) => questions.find((x) => x.key === key) ?? { key, label: key, options: [] });
  const show = (r: NumberSeriesTestResult) =>
    r.series
      ? {
          tone: 'success' as const,
          text: `“${r.series.name}” would give ${r.number ?? '(no free number)'}.`,
        }
      : { tone: 'info' as const, text: `No series fits: ${r.usual ?? 'the default numbers'}.` };

  return (
    <section className="ep-card" aria-labelledby="ns-test-h">
      <h2 id="ns-test-h" className="ep-card__title">
        Test a series
      </h2>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        Which series would a registration get, and its number? Nothing is used.
      </p>
      <div className="ep-lead-filter" style={{ margin: 0 }}>
        <label className="ep-field">
          <span className="ep-field__label">Number</span>
          <select
            className="ep-select"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as typeof kind);
              setOut(null);
            }}
          >
            <option value="registration">Registration no.</option>
            <option value="admission">Admission no.</option>
          </select>
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Session</span>
          <select
            className="ep-select"
            value={cycleId}
            onChange={(e) => {
              setCycleId(e.target.value);
              setClassId(setup.cycles.find((y) => y.id === e.target.value)?.classes[0]?.id ?? '');
              setOut(null);
            }}
          >
            {setup.cycles.map((y) => (
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
            value={classId}
            onChange={(e) => {
              setClassId(e.target.value);
              setOut(null);
            }}
          >
            {(cycle?.classes ?? []).map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </label>
        {asked.map((q) => (
          <label key={q.key} className="ep-field">
            <span className="ep-field__label">{q.label}</span>
            {q.options.length ? (
              <select
                className="ep-select"
                value={answers[q.key] ?? ''}
                onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })}
              >
                <option value="">No answer</option>
                {q.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="ep-input"
                value={answers[q.key] ?? ''}
                onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })}
              />
            )}
          </label>
        ))}
        <span style={{ alignSelf: 'flex-end' }}>
          <button
            type="button"
            className="ep-btn ep-btn--secondary"
            disabled={pending || !classId}
            onClick={() =>
              start(async () => {
                const r = await testNumberSeries({
                  kind,
                  cycleId,
                  classId,
                  answers: Object.fromEntries(
                    Object.entries(answers).filter(([k, v]) => v && asked.some((q) => q.key === k)),
                  ),
                });
                setOut(r.ok ? show(r.data) : { tone: 'danger', text: r.error });
              })
            }
          >
            Test
          </button>
        </span>
      </div>
      {out ? (
        <p
          className={`ep-alert ep-alert--${out.tone}`}
          role={out.tone === 'danger' ? 'alert' : 'status'}
          style={{ marginBottom: 0 }}
        >
          {out.text}
        </p>
      ) : null}
    </section>
  );
}
