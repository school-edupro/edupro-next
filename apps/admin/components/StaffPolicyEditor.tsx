'use client';
import { useMemo, useState, useTransition } from 'react';
import { saveStaffPolicy } from '@/lib/staff-profile-actions';

type Level = 'hidden' | 'view' | 'edit_approval' | 'edit_direct';
type Approver =
  | { kind: 'office' }
  | { kind: 'hod' }
  | { kind: 'l1' }
  | { kind: 'l2' }
  | { kind: 'role'; roleCode: string }
  | { kind: 'employee'; employeeId: string };
export interface StaffPolicyView {
  policy: {
    fields: Record<string, Level>;
    proofs: Record<string, string>;
    /** 0188: the employee's photo (sent back as fields.photo) */
    photo?: Level;
    window: {
      mode: 'open' | 'closed' | 'period';
      from?: string | null;
      to?: string | null;
      message?: string | null;
    };
    approval: {
      default: Approver[];
      sections: Record<string, Approver[]>;
      fields: Record<string, Approver[]>;
    };
    /** 0187: education, languages, experience, documents */
    lists: Record<string, { level: Level; proof: string | null }>;
  };
  sections: Array<{ id: string; title: string }>;
  lists: Array<{ id: string; title: string; proofHint: string }>;
  fields: Array<{
    key: string;
    section: string;
    label: string;
    sensitive: boolean;
    editable: boolean;
  }>;
  documentTypes: Array<{ id: string; name: string }>;
  roles: Array<{ code: string; name: string }>;
  staff: Array<{ id: string; name: string; code: string }>;
}

const LEVELS: Array<[Level, string]> = [
  ['hidden', 'Not shown'],
  ['view', 'Shown'],
  ['edit_approval', 'Change with approval'],
  ['edit_direct', 'Change at once'],
];
const KINDS: Array<[Approver['kind'], string]> = [
  ['office', 'HR / office (staff record keepers)'],
  ['hod', 'The employee’s ACR HOD'],
  ['l1', 'The employee’s L1 approver'],
  ['l2', 'The employee’s L2 approver'],
  ['role', 'Anyone with a role'],
  ['employee', 'A named person'],
];

/** One or two approvers, in order. */
function RouteEditor({
  id,
  route,
  onChange,
  roles,
  staff,
}: {
  id: string;
  route: Approver[];
  onChange: (r: Approver[]) => void;
  roles: StaffPolicyView['roles'];
  staff: StaffPolicyView['staff'];
}) {
  const set = (i: number, a: Approver) => onChange(route.map((x, j) => (j === i ? a : x)));
  const make = (kind: Approver['kind']): Approver =>
    kind === 'role'
      ? { kind, roleCode: roles[0]?.code ?? '' }
      : kind === 'employee'
        ? { kind, employeeId: staff[0]?.id ?? '' }
        : { kind };
  return (
    <div className="ep-fit-row">
      {route.map((a, i) => (
        <div key={String(i)} className="ep-field">
          <label className="ep-field__label" htmlFor={`${id}-${String(i)}`}>
            {i === 0 ? 'First approver' : 'Then'}
          </label>
          <select
            id={`${id}-${String(i)}`}
            className="ep-select"
            value={a.kind}
            onChange={(e) => set(i, make(e.target.value as Approver['kind']))}
          >
            {KINDS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          {a.kind === 'role' ? (
            <select
              aria-label="Role"
              className="ep-select"
              value={a.roleCode}
              onChange={(e) => set(i, { kind: 'role', roleCode: e.target.value })}
            >
              {roles.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </select>
          ) : a.kind === 'employee' ? (
            <select
              aria-label="Person"
              className="ep-select"
              value={a.employeeId}
              onChange={(e) => set(i, { kind: 'employee', employeeId: e.target.value })}
            >
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          ) : null}
        </div>
      ))}
      <div className="ep-field" style={{ alignSelf: 'end' }}>
        {route.length < 2 ? (
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            onClick={() => onChange([...route, { kind: 'office' }])}
          >
            + Second approver
          </button>
        ) : (
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            onClick={() => onChange(route.slice(0, 1))}
          >
            Only one approver
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * What staff see and change on their own profile (docs/design/33-people-dashboards.md), like the family
 * portal's profile settings: the level of each field, the document a change needs, the approvers, the window.
 */
export function StaffPolicyEditor({ data }: { data: StaffPolicyView }) {
  const [tab, setTab] = useState<'fields' | 'approvers' | 'window'>('fields');
  const [fields, setFields] = useState<Record<string, Level>>({
    ...data.policy.fields,
    photo: data.policy.photo ?? 'edit_approval',
  });
  const [proofs, setProofs] = useState(data.policy.proofs);
  const [win, setWin] = useState(data.policy.window);
  const [approval, setApproval] = useState(data.policy.approval);
  const [lists, setLists] = useState(data.policy.lists ?? {});
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const counts = useMemo(() => {
    const c: Record<Level, number> = { hidden: 0, view: 0, edit_approval: 0, edit_direct: 0 };
    for (const v of Object.values(fields)) c[v] += 1;
    return c;
  }, [fields]);
  const save = () =>
    start(async () => {
      const r = await saveStaffPolicy({ fields, proofs, lists, window: win, approval });
      setMsg(r.ok ? { tone: 'success', text: 'Saved.' } : { tone: 'danger', text: r.error });
    });

  return (
    <div>
      <p className="ep-field__help">
        {counts.hidden} not shown · {counts.view} shown · {counts.edit_approval} change with
        approval · {counts.edit_direct} change at once. The code, the job, the approvers and the
        machine id are kept by the office.
      </p>
      <nav
        className="ep-tabs-links"
        aria-label="Staff profile settings"
        style={{ marginBottom: 'var(--sp-4)' }}
      >
        {(
          [
            ['fields', 'Fields and documents'],
            ['approvers', 'Approvers'],
            ['window', 'Update window'],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            aria-pressed={tab === k}
            onClick={() => setTab(k)}
          >
            {l}
          </button>
        ))}
      </nav>

      {tab === 'fields'
        ? data.sections.map((s) => {
            const list = data.fields.filter((f) => f.section === s.id);
            if (!list.length) return null;
            return (
              <section
                key={s.id}
                className="ep-card ep-acr-card"
                aria-labelledby={`sp-${s.id}`}
                style={{ marginBottom: 'var(--sp-3)' }}
              >
                <h2 id={`sp-${s.id}`} className="ep-card__title">
                  {s.title}
                </h2>
                <div className="ep-table-wrap">
                  <table className="ep-table ep-table--dense">
                    <thead>
                      <tr>
                        <th scope="col">Field</th>
                        <th scope="col">Staff</th>
                        <th scope="col">Document needed for a change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((f) => {
                        const lv = fields[f.key] ?? 'view';
                        return (
                          <tr key={f.key}>
                            <td>
                              <strong>{f.label}</strong>
                              {f.sensitive ? (
                                <span className="ep-field__help"> · ID number</span>
                              ) : null}
                            </td>
                            <td>
                              <select
                                aria-label={`${f.label}: what staff may do`}
                                className="ep-select"
                                value={lv}
                                onChange={(e) =>
                                  setFields((x) => ({ ...x, [f.key]: e.target.value as Level }))
                                }
                              >
                                {LEVELS.filter(
                                  ([k]) => f.editable || k === 'hidden' || k === 'view',
                                ).map(([k, l]) => (
                                  <option key={k} value={k}>
                                    {l}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              {lv === 'edit_approval' || lv === 'edit_direct' ? (
                                <select
                                  aria-label={`${f.label}: document needed`}
                                  className="ep-select"
                                  value={proofs[f.key] ?? ''}
                                  onChange={(e) =>
                                    setProofs((x) => {
                                      const n = { ...x };
                                      if (e.target.value) n[f.key] = e.target.value;
                                      else delete n[f.key];
                                      return n;
                                    })
                                  }
                                >
                                  <option value="">No document</option>
                                  {data.documentTypes.map((d) => (
                                    <option key={d.id} value={d.id}>
                                      {d.name}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span className="ep-field__help">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })
        : null}

      {tab === 'fields' ? (
        <section className="ep-card ep-acr-card" aria-labelledby="sp-lists">
          <h2 id="sp-lists" className="ep-card__title">
            Lists staff may update
          </h2>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            The photo, and education, languages, work experience, training and documents: staff ask
            for a new photo, and add, change or remove rows, from My profile. A document a change
            must carry is attached with the request and filed on the employee&apos;s record when
            accepted; HR still ticks it against the original.
          </p>
          <div className="ep-table-wrap">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">List</th>
                  <th scope="col">Staff</th>
                  <th scope="col">Document needed for a change</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>Photo</strong>
                    <span className="ep-field__help">
                      {' '}
                      · the office sets it on the employee&apos;s page; staff may ask for a new one
                    </span>
                  </td>
                  <td>
                    <select
                      aria-label="Photo: what staff may do"
                      className="ep-select"
                      value={fields.photo ?? 'edit_approval'}
                      onChange={(e) => setFields((x) => ({ ...x, photo: e.target.value as Level }))}
                    >
                      {LEVELS.filter(([k]) => k !== 'hidden').map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <span className="ep-field__help">—</span>
                  </td>
                </tr>
                {(data.lists ?? []).map((l) => {
                  const lp = lists[l.id] ?? { level: 'edit_approval' as Level, proof: null };
                  return (
                    <tr key={l.id}>
                      <td>
                        <strong>{l.title}</strong>
                        <span className="ep-field__help"> · usually {l.proofHint}</span>
                      </td>
                      <td>
                        <select
                          aria-label={`${l.title}: what staff may do`}
                          className="ep-select"
                          value={lp.level}
                          onChange={(e) =>
                            setLists((x) => ({
                              ...x,
                              [l.id]: { ...lp, level: e.target.value as Level },
                            }))
                          }
                        >
                          {LEVELS.map(([k, label]) => (
                            <option key={k} value={k}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {lp.level === 'edit_approval' || lp.level === 'edit_direct' ? (
                          <select
                            aria-label={`${l.title}: document needed`}
                            className="ep-select"
                            value={lp.proof ?? ''}
                            onChange={(e) =>
                              setLists((x) => ({
                                ...x,
                                [l.id]: { ...lp, proof: e.target.value || null },
                              }))
                            }
                          >
                            <option value="">No document</option>
                            {data.documentTypes.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="ep-field__help">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === 'approvers' ? (
        <section className="ep-card ep-acr-card">
          <h2 className="ep-card__title">Who approves</h2>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            Changes that need approval go to these people, one after the other. HOD and L1/L2 are
            taken from each employee’s record (Approvers).
          </p>
          <h3 className="ep-field__label">Every section, unless set below</h3>
          <RouteEditor
            id="route-default"
            route={approval.default}
            roles={data.roles}
            staff={data.staff}
            onChange={(r) => setApproval((a) => ({ ...a, default: r }))}
          />
          {[
            ...data.sections,
            ...(data.lists ?? []).map((l) => ({ id: `list:${l.id}`, title: `${l.title} (list)` })),
            { id: 'photo', title: 'Photo' },
          ].map((s) => {
            const own = approval.sections[s.id];
            return (
              <div key={s.id} style={{ marginTop: 'var(--sp-4)' }}>
                <label className="ep-check">
                  <input
                    type="checkbox"
                    checked={Boolean(own)}
                    onChange={(e) =>
                      setApproval((a) => {
                        const sections = { ...a.sections };
                        if (e.target.checked) sections[s.id] = [{ kind: 'office' }];
                        else delete sections[s.id];
                        return { ...a, sections };
                      })
                    }
                  />{' '}
                  <strong>{s.title}</strong>: its own approvers
                </label>
                {own ? (
                  <RouteEditor
                    id={`route-${s.id}`}
                    route={own}
                    roles={data.roles}
                    staff={data.staff}
                    onChange={(r) =>
                      setApproval((a) => ({ ...a, sections: { ...a.sections, [s.id]: r } }))
                    }
                  />
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}

      {tab === 'window' ? (
        <section className="ep-card ep-acr-card">
          <h2 className="ep-card__title">When staff may update</h2>
          <fieldset className="ep-field" style={{ border: 0, padding: 0 }}>
            <legend className="ep-field__label">Updates are</legend>
            {(
              [
                ['open', 'Open'],
                ['closed', 'Closed'],
                ['period', 'Open between two dates'],
              ] as const
            ).map(([k, l]) => (
              <label key={k} className="ep-check">
                <input
                  type="radio"
                  name="sp-window"
                  checked={win.mode === k}
                  onChange={() => setWin((w) => ({ ...w, mode: k }))}
                />{' '}
                {l}
              </label>
            ))}
          </fieldset>
          {win.mode === 'period' ? (
            <div className="ep-fit-row">
              <label className="ep-field" htmlFor="sp-from">
                <span className="ep-field__label">From</span>
                <input
                  id="sp-from"
                  type="date"
                  className="ep-input"
                  value={win.from ?? ''}
                  onChange={(e) => setWin((w) => ({ ...w, from: e.target.value || null }))}
                />
              </label>
              <label className="ep-field" htmlFor="sp-to">
                <span className="ep-field__label">To</span>
                <input
                  id="sp-to"
                  type="date"
                  className="ep-input"
                  value={win.to ?? ''}
                  onChange={(e) => setWin((w) => ({ ...w, to: e.target.value || null }))}
                />
              </label>
            </div>
          ) : null}
          <label className="ep-field" htmlFor="sp-msg">
            <span className="ep-field__label">Message to staff (optional)</span>
            <input
              id="sp-msg"
              className="ep-input"
              maxLength={300}
              value={win.message ?? ''}
              onChange={(e) => setWin((w) => ({ ...w, message: e.target.value || null }))}
            />
          </label>
        </section>
      ) : null}

      <div
        className="ep-acr-actions"
        style={{
          position: 'sticky',
          bottom: 0,
          background: 'var(--surface-page)',
          padding: 'var(--sp-3) 0',
        }}
      >
        {msg ? (
          <span className={`ep-alert ep-alert--${msg.tone}`} role="status" style={{ margin: 0 }}>
            {msg.text}
          </span>
        ) : null}
        <button type="button" className="ep-btn ep-btn--primary" onClick={save} disabled={pending}>
          Save settings
        </button>
      </div>
    </div>
  );
}
