'use client';
import { Badge } from '@edupro/ui';
import { useState, useTransition } from 'react';
import {
  STAGE_KIND,
  type LevelBy,
  type Process,
  type ProcessLevel,
  type ProcessSetup,
  type ProcessStep,
  type Stage,
  type StageKind,
} from '@/lib/admission-process';
import { archiveProcess, saveProcess, saveStages } from '@/lib/admission-process-actions';

type StageDraft = Omit<Stage, 'id' | 'used'> & { id?: string; used: boolean; key: string };
type Draft = { id: string | null; name: string; steps: ProcessStep[]; classIds: string[] };
const BY: Record<LevelBy, string> = {
  anyone: 'Anyone who decides admissions',
  role: 'Everyone with a role',
  designation: 'Everyone with a designation',
  employees: 'Named employees',
};

/** Searchable tick-list of employees (named approvers of a level). */
function EmployeePicker({
  employees,
  value,
  onChange,
  disabled,
}: {
  employees: Array<{ id: string; name: string }>;
  value: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
}) {
  const [q, setQ] = useState('');
  const shown = employees
    .filter((e) => value.includes(e.id) || e.name.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 40);
  return (
    <div className="ep-pe__people">
      <input
        className="ep-input"
        type="search"
        aria-label="Find an employee"
        placeholder="Type a name"
        value={q}
        disabled={disabled}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="ep-pe__peoplelist">
        {shown.map((e) => (
          <label key={e.id} className="ep-check">
            <input
              type="checkbox"
              className="ep-check__input"
              disabled={disabled}
              checked={value.includes(e.id)}
              onChange={(ev) =>
                onChange(ev.target.checked ? [...value, e.id] : value.filter((x) => x !== e.id))
              }
            />
            <span className="ep-check__box" aria-hidden="true" />
            <span className="ep-check__text">{e.name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * Stages and approval processes of online admission (docs/design/39, part 4). A process is the order of
 * stages a class follows, each with its approval levels (anyone deciding admissions, a role, a
 * designation or named employees). A change that reaches registrations in progress is confirmed first;
 * decisions already taken stay.
 */
export function ProcessEditor({ setup, canEdit }: { setup: ProcessSetup; canEdit: boolean }) {
  const [stages, setStages] = useState<StageDraft[]>(() =>
    setup.stages.map((s) => ({ ...s, key: s.id })),
  );
  const [processes, setProcesses] = useState<Process[]>(setup.processes);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirm, setConfirm] = useState<{ affected: number; sample: string[] } | null>(null);
  const [msg, setMsg] = useState<{
    tone: 'success' | 'danger';
    text: string;
    where: 'stages' | 'process';
  } | null>(null);
  const [pending, start] = useTransition();
  const active = stages.filter((s) => s.status === 'active' && s.id);
  const stageName = (id: string) => stages.find((s) => s.id === id)?.name ?? 'Stage';
  const owner = (classId: string) =>
    processes.find((p) => p.classIds.includes(classId) && p.id !== draft?.id);

  const setStep = (i: number, patch: Partial<ProcessStep>) =>
    setDraft((d) =>
      d ? { ...d, steps: d.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) } : d,
    );
  const setLevel = (i: number, k: number, patch: Partial<ProcessLevel>) =>
    setStep(i, {
      levels: draft!.steps[i]!.levels.map((l, m) => (m === k ? { ...l, ...patch } : l)),
    });

  const save = (ok: boolean) =>
    start(async () => {
      if (!draft) return;
      const r = await saveProcess(draft.id, {
        name: draft.name,
        steps: draft.steps,
        classIds: draft.classIds,
        confirm: ok,
      });
      if (r.ok) {
        setProcesses(r.data.processes);
        setDraft(null);
        setConfirm(null);
        setMsg({
          tone: 'success',
          text: r.data.affected
            ? `Process saved; ${r.data.affected} registration${r.data.affected === 1 ? '' : 's'} in progress follow it now.`
            : 'Process saved.',
          where: 'process',
        });
      } else if (r.confirm) setConfirm(r.confirm);
      else setMsg({ tone: 'danger', text: r.error, where: 'process' });
    });

  return (
    <div className="ep-as">
      <section className="ep-card ep-as__card" aria-labelledby="as-stages">
        <h2 id="as-stages" className="ep-as__h">
          Stages
        </h2>
        <p className="ep-field__help">
          The school&rsquo;s stages of admission. A test or an interview takes slots and marks (give
          the maximum); Selection makes the offers and keeps the waiting list and is always the last
          step of a process.
        </p>
        <div className="ep-table-wrap">
          <table className="ep-table">
            <caption className="ep-sr-only">Stages</caption>
            <thead>
              <tr>
                <th scope="col">Stage</th>
                <th scope="col">Kind</th>
                <th scope="col">Maximum marks</th>
                <th scope="col">
                  <span className="ep-sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {stages.map((s, i) => (
                <tr key={s.key} data-off={s.status === 'inactive' || undefined}>
                  <td>
                    <input
                      className="ep-input"
                      aria-label="Stage name"
                      value={s.name}
                      maxLength={60}
                      disabled={!canEdit}
                      onChange={(e) =>
                        setStages((cur) =>
                          cur.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                        )
                      }
                    />
                  </td>
                  <td>
                    <select
                      className="ep-select"
                      aria-label="Kind of stage"
                      value={s.kind}
                      disabled={!canEdit || s.used}
                      onChange={(e) =>
                        setStages((cur) =>
                          cur.map((x, j) =>
                            j === i ? { ...x, kind: e.target.value as StageKind } : x,
                          ),
                        )
                      }
                    >
                      {Object.entries(STAGE_KIND).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {s.kind === 'test' || s.kind === 'interview' ? (
                      <>
                        <input
                          className="ep-input"
                          type="number"
                          min={1}
                          aria-label="Maximum marks"
                          value={s.maxMarks ?? ''}
                          disabled={!canEdit}
                          onChange={(e) =>
                            setStages((cur) =>
                              cur.map((x, j) =>
                                j === i
                                  ? {
                                      ...x,
                                      maxMarks: e.target.value ? Number(e.target.value) : null,
                                    }
                                  : x,
                              ),
                            )
                          }
                        />
                        {s.id ? (
                          <a
                            className="ep-field__help"
                            href={`/admissions/setup/papers?stage=${s.id}`}
                            style={{ display: 'block', marginTop: 'var(--sp-1)' }}
                          >
                            Papers by class
                          </a>
                        ) : null}
                      </>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td>
                    {s.status === 'inactive' ? <Badge tone="neutral">Off</Badge> : null}
                    {canEdit ? (
                      <button
                        type="button"
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        onClick={() =>
                          setStages((cur) =>
                            cur.map((x, j) =>
                              j === i
                                ? { ...x, status: x.status === 'active' ? 'inactive' : 'active' }
                                : x,
                            ),
                          )
                        }
                      >
                        {s.status === 'active' ? 'Switch off' : 'Switch on'}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {msg?.where === 'stages' ? (
          <p
            className={`ep-alert ep-alert--${msg.tone}`}
            role={msg.tone === 'danger' ? 'alert' : 'status'}
          >
            {msg.text}
          </p>
        ) : null}
        {canEdit ? (
          <div className="ep-form-actions">
            <button
              type="button"
              className="ep-btn ep-btn--secondary"
              onClick={() =>
                setStages((cur) => [
                  ...cur,
                  {
                    key: `n${String(Date.now())}`,
                    name: 'New stage',
                    kind: 'custom',
                    maxMarks: null,
                    status: 'active',
                    used: false,
                  },
                ])
              }
            >
              Add a stage
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await saveStages(stages.map(({ key: _k, used: _u, ...x }) => x));
                  if (r.ok) {
                    setStages(r.data.map((s) => ({ ...s, key: s.id })));
                    setMsg({ tone: 'success', text: 'Stages saved.', where: 'stages' });
                  } else setMsg({ tone: 'danger', text: r.error, where: 'stages' });
                })
              }
            >
              Save stages
            </button>
          </div>
        ) : null}
      </section>

      <section className="ep-card ep-as__card" aria-labelledby="as-processes">
        <h2 id="as-processes" className="ep-as__h">
          Approval processes
        </h2>
        <p className="ep-field__help">
          Each class follows one process, for example Primary (Document check, Interaction,
          Selection) and Senior (Document check, Written test, Interview, Selection). A registration
          of a class without a process waits until one is given.
        </p>
        {processes.length === 0 && !draft ? <p>No process yet.</p> : null}
        <ul className="ep-pe__list">
          {processes.map((p) => (
            <li key={p.id} className="ep-pe__item">
              <div>
                <strong>{p.name}</strong>
                <div className="ep-kicker">
                  {p.classNames.length ? p.classNames.join(', ') : 'No class yet'}
                </div>
                <ol className="ep-pe__flow">
                  {p.steps.map((s) => (
                    <li key={s.stageId}>
                      {stageName(s.stageId)}
                      {s.levels.length > 1 ? ` (${s.levels.length} levels)` : ''}
                    </li>
                  ))}
                </ol>
              </div>
              {canEdit ? (
                <span className="ep-as__catacts">
                  <button
                    type="button"
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    onClick={() => {
                      setConfirm(null);
                      setDraft({ id: p.id, name: p.name, steps: p.steps, classIds: p.classIds });
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const r = await archiveProcess(p.id);
                        if (r.ok) setProcesses(r.data.processes);
                        else setMsg({ tone: 'danger', text: r.error, where: 'process' });
                      })
                    }
                  >
                    Remove
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>

        {draft ? (
          <div
            className="ep-pe__draft"
            role="group"
            aria-label={draft.id ? 'Edit the process' : 'New process'}
          >
            <label className="ep-field">
              <span className="ep-field__label">Process name</span>
              <input
                className="ep-input"
                value={draft.name}
                maxLength={80}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <fieldset className="ep-fb__group">
              <legend>Classes that follow it</legend>
              <div className="ep-fb__radios">
                {setup.classes.map((cl) => {
                  const other = owner(cl.id);
                  return (
                    <label key={cl.id} className="ep-check">
                      <input
                        type="checkbox"
                        className="ep-check__input"
                        checked={draft.classIds.includes(cl.id)}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            classIds: e.target.checked
                              ? [...draft.classIds, cl.id]
                              : draft.classIds.filter((x) => x !== cl.id),
                          })
                        }
                      />
                      <span className="ep-check__box" aria-hidden="true" />
                      <span className="ep-check__text">
                        {cl.name}
                        {other ? <span className="ep-kicker"> (now {other.name})</span> : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <ol className="ep-pe__steps">
              {draft.steps.map((s, i) => (
                <li key={`${s.stageId}-${String(i)}`} className="ep-pe__step">
                  <div className="ep-as__cathead">
                    <span className="ep-fb__stepno">{i + 1}</span>
                    <select
                      className="ep-select"
                      aria-label={`Stage of step ${String(i + 1)}`}
                      value={s.stageId}
                      onChange={(e) => setStep(i, { stageId: e.target.value })}
                    >
                      {active.map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.name}
                        </option>
                      ))}
                    </select>
                    <span className="ep-as__catacts">
                      <button
                        type="button"
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        aria-label={`Move step ${String(i + 1)} up`}
                        disabled={i === 0}
                        onClick={() =>
                          setDraft((d) => {
                            if (!d) return d;
                            const n = [...d.steps];
                            [n[i - 1], n[i]] = [n[i]!, n[i - 1]!];
                            return { ...d, steps: n };
                          })
                        }
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        onClick={() =>
                          setDraft({ ...draft, steps: draft.steps.filter((_, j) => j !== i) })
                        }
                      >
                        Remove step
                      </button>
                    </span>
                  </div>
                  <ol className="ep-pe__levels">
                    {s.levels.map((l, k) => (
                      <li key={k} className="ep-pe__level">
                        <span className="ep-kicker">Level {k + 1}</span>
                        <input
                          className="ep-input"
                          aria-label={`Name of level ${String(k + 1)}`}
                          value={l.name}
                          maxLength={60}
                          onChange={(e) => setLevel(i, k, { name: e.target.value })}
                        />
                        <select
                          className="ep-select"
                          aria-label={`Who decides at level ${String(k + 1)}`}
                          value={l.by}
                          onChange={(e) => setLevel(i, k, { by: e.target.value as LevelBy })}
                        >
                          {Object.entries(BY).map(([v, t]) => (
                            <option key={v} value={v}>
                              {t}
                            </option>
                          ))}
                        </select>
                        {l.by === 'role' ? (
                          <select
                            className="ep-select"
                            aria-label="Role"
                            value={l.roleCode ?? ''}
                            onChange={(e) => setLevel(i, k, { roleCode: e.target.value })}
                          >
                            <option value="">Choose the role</option>
                            {setup.roles.map((r) => (
                              <option key={r.code} value={r.code}>
                                {r.name}
                              </option>
                            ))}
                          </select>
                        ) : null}
                        {l.by === 'designation' ? (
                          <select
                            className="ep-select"
                            aria-label="Designation"
                            value={l.designation ?? ''}
                            onChange={(e) => setLevel(i, k, { designation: e.target.value })}
                          >
                            <option value="">Choose the designation</option>
                            {setup.designations.map((d) => (
                              <option key={d} value={d}>
                                {d}
                              </option>
                            ))}
                          </select>
                        ) : null}
                        {l.by === 'employees' ? (
                          <EmployeePicker
                            employees={setup.employees}
                            value={l.employeeIds ?? []}
                            disabled={false}
                            onChange={(ids) => setLevel(i, k, { employeeIds: ids })}
                          />
                        ) : null}
                        <label className="ep-pe__days">
                          <span className="ep-field__label">Days to decide</span>
                          <input
                            className="ep-input"
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={90}
                            placeholder="No limit"
                            aria-describedby="pe-days-help"
                            value={l.days ?? ''}
                            onChange={(e) =>
                              setLevel(i, k, {
                                days: e.target.value ? Math.round(Number(e.target.value)) : null,
                              })
                            }
                          />
                        </label>
                        {s.levels.length > 1 ? (
                          <button
                            type="button"
                            className="ep-btn ep-btn--ghost ep-btn--sm"
                            onClick={() =>
                              setStep(i, { levels: s.levels.filter((_, m) => m !== k) })
                            }
                          >
                            Remove level
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                  {i === 0 ? (
                    <p id="pe-days-help" className="ep-field__help" style={{ margin: 0 }}>
                      Days to decide: a reminder goes the day before in the morning email to the
                      level&apos;s people, and a registration past it shows as overdue. Leave empty
                      for no limit.
                    </p>
                  ) : null}
                  {s.levels.length < 5 ? (
                    <button
                      type="button"
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      onClick={() =>
                        setStep(i, {
                          levels: [
                            ...s.levels,
                            { name: `Level ${String(s.levels.length + 1)}`, by: 'anyone' },
                          ],
                        })
                      }
                    >
                      Add a level
                    </button>
                  ) : null}
                </li>
              ))}
            </ol>
            <button
              type="button"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              disabled={!active.length}
              onClick={() =>
                setDraft({
                  ...draft,
                  steps: [
                    ...draft.steps,
                    {
                      stageId:
                        active.find((st) => !draft.steps.some((x) => x.stageId === st.id))?.id ??
                        active[0]!.id!,
                      levels: [{ name: 'Approval', by: 'anyone' }],
                    },
                  ],
                })
              }
            >
              Add a step
            </button>
            {confirm ? (
              <div className="ep-alert ep-alert--warning" role="alert">
                <p style={{ marginTop: 0 }}>
                  {confirm.affected} registration{confirm.affected === 1 ? '' : 's'} in progress
                  will follow the changed process. Decisions already taken stay; a registration
                  waits at the first step not yet approved.
                </p>
                {confirm.sample.length ? (
                  <p className="ep-kicker">{confirm.sample.join(' · ')}</p>
                ) : null}
                <div className="ep-form-actions">
                  <button
                    type="button"
                    className="ep-btn ep-btn--primary"
                    disabled={pending}
                    onClick={() => save(true)}
                  >
                    Apply to {confirm.affected} registration{confirm.affected === 1 ? '' : 's'}
                  </button>
                  <button
                    type="button"
                    className="ep-btn ep-btn--ghost"
                    onClick={() => setConfirm(null)}
                  >
                    Go back
                  </button>
                </div>
              </div>
            ) : null}
            {msg?.where === 'process' && msg.tone === 'danger' ? (
              <p className="ep-alert ep-alert--danger" role="alert">
                {msg.text}
              </p>
            ) : null}
            {!confirm ? (
              <div className="ep-form-actions">
                <button
                  type="button"
                  className="ep-btn ep-btn--primary"
                  disabled={pending}
                  onClick={() => save(false)}
                >
                  Save the process
                </button>
                <button
                  type="button"
                  className="ep-btn ep-btn--ghost"
                  onClick={() => setDraft(null)}
                >
                  Cancel
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {msg?.where === 'process' && msg.tone === 'success' ? (
          <p className="ep-alert ep-alert--success" role="status">
            {msg.text}
          </p>
        ) : null}
        {canEdit && !draft ? (
          <div className="ep-form-actions">
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              disabled={!active.length}
              onClick={() => {
                setConfirm(null);
                setMsg(null);
                setDraft({
                  id: null,
                  name: '',
                  classIds: [],
                  steps: active
                    .filter((s) => ['document_check', 'selection'].includes(s.kind))
                    .map((s) => ({
                      stageId: s.id!,
                      levels: [{ name: 'Approval', by: 'anyone' as const }],
                    })),
                });
              }}
            >
              New process
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
