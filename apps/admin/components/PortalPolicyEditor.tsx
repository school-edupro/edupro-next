'use client';
import { Badge, Tabs } from '@edupro/ui';
import { useId, useMemo, useState } from 'react';
import { savePortalPolicy } from '@/lib/actions';
import {
  LEVEL_LABEL,
  type ApprovalRoute,
  type Approver,
  type PolicyScreen,
  type PortalAudience,
  type PortalLevel,
  type PortalPolicy,
} from '@/lib/portal-profile';

const LEVELS: PortalLevel[] = ['hidden', 'view', 'edit_approval', 'edit_direct'];
const AUDIENCES: Array<{ id: PortalAudience; label: string }> = [
  { id: 'parent', label: 'Parents' },
  { id: 'student', label: 'Students' },
];

/**
 * What the parent and student portals show and let families change, field by field, plus the proof
 * documents, the update window and who approves. Saved for the whole school.
 */
export function PortalPolicyEditor({ screen }: { screen: PolicyScreen }) {
  const [policy, setPolicy] = useState<PortalPolicy>(screen.policy);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const update = (fn: (p: PortalPolicy) => PortalPolicy) => {
    setPolicy((p) => fn(p));
    setDirty(true);
    setMsg(null);
  };
  const save = async () => {
    setBusy(true);
    const r = await savePortalPolicy(policy);
    setBusy(false);
    if (r.ok) {
      setPolicy(r.data);
      setDirty(false);
      setMsg({ tone: 'success', text: 'Settings saved. Parents and students see them now.' });
    } else setMsg({ tone: 'danger', text: r.error });
  };
  const counts = (a: PortalAudience) => {
    const c: Record<PortalLevel, number> = { hidden: 0, view: 0, edit_approval: 0, edit_direct: 0 };
    for (const l of Object.values(policy.fields[a])) c[l] += 1;
    return c;
  };

  return (
    <div className="ep-pp">
      <div className="ep-pp__summary">
        {AUDIENCES.map((a) => {
          const c = counts(a.id);
          return (
            <div key={a.id} className="ep-pp__stat">
              <strong>{a.label}</strong>
              <span>
                {c.view + c.edit_approval + c.edit_direct} shown · {c.edit_approval} with approval ·{' '}
                {c.edit_direct} direct · {c.hidden} hidden
              </span>
            </div>
          );
        })}
        <div className="ep-pp__stat">
          <strong>Updates</strong>
          <span>
            {policy.window.mode === 'open'
              ? 'Open'
              : policy.window.mode === 'closed'
                ? 'Closed'
                : `${policy.window.from ?? '…'} to ${policy.window.to ?? '…'}`}
          </span>
        </div>
      </div>

      <Tabs
        ariaLabel="Portal profile settings"
        items={[
          {
            id: 'fields',
            label: 'Fields',
            content: <FieldsTab screen={screen} policy={policy} update={update} />,
          },
          {
            id: 'approvals',
            label: 'Approvers',
            content: <ApprovalsTab screen={screen} policy={policy} update={update} />,
          },
          {
            id: 'proofs',
            label: 'Proof documents',
            content: <ProofsTab screen={screen} policy={policy} update={update} />,
          },
          {
            id: 'window',
            label: 'Update window',
            content: <WindowTab policy={policy} update={update} />,
          },
        ]}
      />

      <div className="ep-pp__bar" role="region" aria-label="Save settings">
        {msg ? (
          <span
            role={msg.tone === 'danger' ? 'alert' : 'status'}
            className={`ep-pp__msg ep-pp__msg--${msg.tone}`}
          >
            {msg.text}
          </span>
        ) : dirty ? (
          <span className="ep-pp__msg">Unsaved changes</span>
        ) : (
          <span className="ep-pp__msg">
            {screen.updatedAt
              ? `Last saved ${new Date(screen.updatedAt).toLocaleString('en-IN')}${screen.updatedBy ? ` by ${screen.updatedBy}` : ''}`
              : 'Using the defaults'}
          </span>
        )}
        <button
          type="button"
          className="ep-btn ep-btn--ghost"
          disabled={busy || !dirty}
          onClick={() => {
            setPolicy(screen.policy);
            setDirty(false);
            setMsg(null);
          }}
        >
          Undo changes
        </button>
        <button
          type="button"
          className="ep-btn ep-btn--primary"
          disabled={busy || !dirty}
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </div>
  );
}

type Update = (fn: (p: PortalPolicy) => PortalPolicy) => void;

function FieldsTab({
  screen,
  policy,
  update,
}: {
  screen: PolicyScreen;
  policy: PortalPolicy;
  update: Update;
}) {
  const [q, setQ] = useState('');
  const searchId = useId();
  const term = q.trim().toLowerCase();
  const setLevel = (a: PortalAudience, keys: string[], level: PortalLevel) =>
    update((p) => {
      const next = { ...p.fields[a] };
      for (const k of keys) {
        const f = screen.fields.find((x) => x.key === k);
        next[k] =
          !f?.editable && (level === 'edit_approval' || level === 'edit_direct') ? 'view' : level;
      }
      return { ...p, fields: { ...p.fields, [a]: next } };
    });
  return (
    <div>
      <p className="ep-field__help">
        For each field choose what parents and students see on their portal.{' '}
        <strong>Edit with approval</strong> sends the change to the approvers set on the next tab;{' '}
        <strong>Edit direct</strong> saves it at once (it is still logged). Fields kept by the
        office (admission number, class, roll number, documents checklist) can be shown but not
        changed. Photos always show as pictures.
      </p>
      <label className="ep-field" htmlFor={searchId} style={{ maxWidth: 360 }}>
        <span className="ep-field__label">Find a field</span>
        <input
          id={searchId}
          className="ep-input"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. mobile, address, Aadhaar"
        />
      </label>
      {screen.sections.map((s) => {
        const fields = screen.fields.filter(
          (f) => f.section === s.id && (!term || f.label.toLowerCase().includes(term)),
        );
        if (!fields.length) return null;
        const keys = fields.map((f) => f.key);
        return (
          <section key={s.id} className="ep-pp__section" aria-labelledby={`pp-sec-${s.id}`}>
            <div className="ep-pp__sechead">
              <h3 id={`pp-sec-${s.id}`}>{s.title}</h3>
              {AUDIENCES.map((a) => (
                <label key={a.id} className="ep-pp__bulk">
                  <span>All for {a.label.toLowerCase()}</span>
                  <select
                    className="ep-input ep-input--sm"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) setLevel(a.id, keys, e.target.value as PortalLevel);
                    }}
                  >
                    <option value="">Set all…</option>
                    {LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {LEVEL_LABEL[l]}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div
              className="ep-table-wrap"
              tabIndex={0}
              role="region"
              aria-label={`${s.title} fields`}
            >
              <table className="ep-table ep-table--dense">
                <thead>
                  <tr>
                    <th scope="col">Field</th>
                    {AUDIENCES.map((a) => (
                      <th scope="col" key={a.id}>
                        {a.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fields.map((f) => (
                    <tr key={f.key}>
                      <th scope="row" className="ep-pp__fname">
                        {f.label} {f.sensitive ? <Badge tone="warning">ID number</Badge> : null}{' '}
                        {!f.editable ? <Badge tone="neutral">office</Badge> : null}
                      </th>
                      {AUDIENCES.map((a) => {
                        const lvl = policy.fields[a.id][f.key] ?? 'view';
                        return (
                          <td key={a.id}>
                            <select
                              className={`ep-input ep-input--sm ep-pp__lvl ep-pp__lvl--${lvl}`}
                              aria-label={`${f.label} for ${a.label.toLowerCase()}`}
                              value={lvl}
                              onChange={(e) =>
                                setLevel(a.id, [f.key], e.target.value as PortalLevel)
                              }
                            >
                              {LEVELS.filter(
                                (l) => f.editable || l === 'hidden' || l === 'view',
                              ).map((l) => (
                                <option key={l} value={l}>
                                  {LEVEL_LABEL[l]}
                                </option>
                              ))}
                            </select>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function RouteEditor({
  screen,
  route,
  onChange,
  label,
}: {
  screen: PolicyScreen;
  route: ApprovalRoute;
  onChange: (r: ApprovalRoute) => void;
  label: string;
}) {
  const setStep = (i: number, a: Approver | null) => {
    const next = [...route];
    if (a) next[i] = a;
    else next.splice(i, 1);
    onChange(next.length ? next : [{ kind: 'office' }]);
  };
  return (
    <div className="ep-pp__route">
      {route.map((a, i) => (
        <ApproverPicker
          key={i}
          screen={screen}
          value={a}
          label={`${label}, ${i === 0 ? 'first' : 'second'} approval`}
          step={i + 1}
          onChange={(x) => setStep(i, x)}
          removable={i === 1}
        />
      ))}
      {route.length < 2 ? (
        <button
          type="button"
          className="ep-btn ep-btn--ghost ep-btn--sm"
          onClick={() => onChange([...route, { kind: 'office' }])}
        >
          + Second approval
        </button>
      ) : null}
    </div>
  );
}

function ApproverPicker({
  screen,
  value,
  label,
  step,
  onChange,
  removable,
}: {
  screen: PolicyScreen;
  value: Approver;
  label: string;
  step: number;
  onChange: (a: Approver | null) => void;
  removable: boolean;
}) {
  const id = useId();
  const roleList = useId();
  const staffList = useId();
  const current =
    value.kind === 'role'
      ? (screen.roles.find((r) => r.id === value.roleId)?.name ?? value.name ?? '')
      : value.kind === 'user'
        ? (screen.staff.find((s) => s.userId === value.userId)?.name ?? value.name ?? '')
        : '';
  const [text, setText] = useState(current);
  return (
    <div className="ep-pp__step">
      <span className="ep-pp__stepno" aria-hidden="true">
        {step}
      </span>
      <select
        id={id}
        className="ep-input ep-input--sm"
        aria-label={label}
        value={value.kind}
        onChange={(e) => {
          const k = e.target.value as Approver['kind'];
          setText('');
          if (k === 'office' || k === 'class_teacher') onChange({ kind: k });
          else if (k === 'role')
            onChange({
              kind: 'role',
              roleId: screen.roles[0]?.id ?? '',
              name: screen.roles[0]?.name,
            });
          else
            onChange({
              kind: 'user',
              userId: screen.staff[0]?.userId ?? '',
              name: screen.staff[0]?.name,
            });
        }}
      >
        <option value="office">School office</option>
        <option value="class_teacher">Class teacher</option>
        <option value="role">A role…</option>
        <option value="user">A named employee…</option>
      </select>
      {value.kind === 'role' ? (
        <>
          <input
            className="ep-input ep-input--sm"
            list={roleList}
            aria-label={`${label}: role`}
            value={text || current}
            placeholder="Type a role"
            onChange={(e) => {
              setText(e.target.value);
              const r = screen.roles.find((x) => x.name === e.target.value);
              if (r) onChange({ kind: 'role', roleId: r.id, name: r.name });
            }}
          />
          <datalist id={roleList}>
            {screen.roles.map((r) => (
              <option key={r.id} value={r.name} />
            ))}
          </datalist>
        </>
      ) : null}
      {value.kind === 'user' ? (
        <>
          <input
            className="ep-input ep-input--sm"
            list={staffList}
            aria-label={`${label}: employee`}
            value={text || current}
            placeholder="Type a name"
            onChange={(e) => {
              setText(e.target.value);
              const s = screen.staff.find((x) => x.name === e.target.value);
              if (s) onChange({ kind: 'user', userId: s.userId, name: s.name });
            }}
          />
          <datalist id={staffList}>
            {screen.staff.map((s) => (
              <option key={s.userId} value={s.name}>
                {s.designation ?? ''}
              </option>
            ))}
          </datalist>
        </>
      ) : null}
      {removable ? (
        <button
          type="button"
          className="ep-btn ep-btn--ghost ep-btn--sm"
          aria-label={`Remove the second approval (${label})`}
          onClick={() => onChange(null)}
        >
          Remove
        </button>
      ) : null}
    </div>
  );
}

function ApprovalsTab({
  screen,
  policy,
  update,
}: {
  screen: PolicyScreen;
  policy: PortalPolicy;
  update: Update;
}) {
  const fieldList = useId();
  const [adding, setAdding] = useState('');
  const byLabel = useMemo(
    () => new Map(screen.fields.filter((f) => f.editable).map((f) => [f.label, f.key])),
    [screen.fields],
  );
  const setApproval = (fn: (a: PortalPolicy['approval']) => PortalPolicy['approval']) =>
    update((p) => ({ ...p, approval: fn(p.approval) }));
  return (
    <div className="ep-pp__approvals">
      <p className="ep-field__help">
        A change asked by a parent or student goes to the approvers of its field, else of its
        section, else to the default. With two approvals the second sees it only after the first
        accepts. <strong>School office</strong> means anyone who decides profile changes;
        administrators can decide at any step, and their decision is final.
      </p>
      <section className="ep-pp__section">
        <h3>Default</h3>
        <RouteEditor
          screen={screen}
          label="Default"
          route={policy.approval.default}
          onChange={(r) => setApproval((a) => ({ ...a, default: r }))}
        />
      </section>
      <section className="ep-pp__section">
        <h3>By section</h3>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Approvers by section">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                <th scope="col">Section</th>
                <th scope="col">Approvers</th>
              </tr>
            </thead>
            <tbody>
              {screen.sections
                .filter((s) => s.id !== 'documents')
                .map((s) => {
                  const own = policy.approval.sections[s.id];
                  return (
                    <tr key={s.id}>
                      <th scope="row">{s.title}</th>
                      <td>
                        {own ? (
                          <div className="ep-pp__inline">
                            <RouteEditor
                              screen={screen}
                              label={s.title}
                              route={own}
                              onChange={(r) =>
                                setApproval((a) => ({
                                  ...a,
                                  sections: { ...a.sections, [s.id]: r },
                                }))
                              }
                            />
                            <button
                              type="button"
                              className="ep-btn ep-btn--ghost ep-btn--sm"
                              onClick={() =>
                                setApproval((a) => {
                                  const next = { ...a.sections };
                                  delete next[s.id];
                                  return { ...a, sections: next };
                                })
                              }
                            >
                              Use the default
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="ep-btn ep-btn--ghost ep-btn--sm"
                            aria-label={`Set approvers for ${s.title}`}
                            onClick={() =>
                              setApproval((a) => ({
                                ...a,
                                sections: { ...a.sections, [s.id]: [...a.default] },
                              }))
                            }
                          >
                            Default · set own approvers
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="ep-pp__section">
        <h3>For single fields</h3>
        {Object.entries(policy.approval.fields).map(([key, route]) => {
          const f = screen.fields.find((x) => x.key === key);
          return (
            <div key={key} className="ep-pp__inline ep-pp__fieldroute">
              <strong>{f?.label ?? key}</strong>
              <RouteEditor
                screen={screen}
                label={f?.label ?? key}
                route={route}
                onChange={(r) => setApproval((a) => ({ ...a, fields: { ...a.fields, [key]: r } }))}
              />
              <button
                type="button"
                className="ep-btn ep-btn--ghost ep-btn--sm"
                aria-label={`Remove the rule for ${f?.label ?? key}`}
                onClick={() =>
                  setApproval((a) => {
                    const next = { ...a.fields };
                    delete next[key];
                    return { ...a, fields: next };
                  })
                }
              >
                Remove
              </button>
            </div>
          );
        })}
        <div className="ep-pp__inline">
          <label className="ep-field" style={{ minWidth: 280 }}>
            <span className="ep-field__label">Add a field</span>
            <input
              className="ep-input"
              list={fieldList}
              value={adding}
              placeholder="Type a field name"
              onChange={(e) => setAdding(e.target.value)}
            />
          </label>
          <datalist id={fieldList}>
            {[...byLabel.keys()].map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
          <button
            type="button"
            className="ep-btn ep-btn--secondary ep-btn--sm"
            disabled={!byLabel.has(adding)}
            onClick={() => {
              const key = byLabel.get(adding);
              if (!key) return;
              setApproval((a) => ({ ...a, fields: { ...a.fields, [key]: [{ kind: 'office' }] } }));
              setAdding('');
            }}
          >
            Add rule
          </button>
        </div>
      </section>
    </div>
  );
}

function ProofsTab({
  screen,
  policy,
  update,
}: {
  screen: PolicyScreen;
  policy: PortalPolicy;
  update: Update;
}) {
  const open = (k: string) =>
    ['edit_approval', 'edit_direct'].includes(policy.fields.parent[k] ?? '') ||
    ['edit_approval', 'edit_direct'].includes(policy.fields.student[k] ?? '');
  const [all, setAll] = useState(false);
  const fields = screen.fields.filter(
    (f) => f.editable && (all || open(f.key) || policy.proofs[f.key]),
  );
  return (
    <div>
      <p className="ep-field__help">
        A change to these fields must carry a document. The approver sees it next to the change, and
        on approval it joins the student's documents (ticking the checklist where it applies).
      </p>
      <label className="ep-check">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show
        every field, not only those families can change
      </label>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Proof documents">
        <table className="ep-table ep-table--dense">
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Families can change it</th>
              <th scope="col">Proof needed</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f.key}>
                <th scope="row">{f.label}</th>
                <td>{open(f.key) ? 'Yes' : 'No'}</td>
                <td>
                  <select
                    className="ep-input ep-input--sm"
                    aria-label={`Proof for ${f.label}`}
                    value={policy.proofs[f.key] ?? ''}
                    onChange={(e) =>
                      update((p) => {
                        const next = { ...p.proofs };
                        if (e.target.value) next[f.key] = e.target.value;
                        else delete next[f.key];
                        return { ...p, proofs: next };
                      })
                    }
                  >
                    <option value="">No proof</option>
                    {screen.proofKinds.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WindowTab({ policy, update }: { policy: PortalPolicy; update: Update }) {
  const w = policy.window;
  const set = (patch: Partial<PortalPolicy['window']>) =>
    update((p) => ({ ...p, window: { ...p.window, ...patch } }));
  return (
    <div style={{ maxWidth: 640 }}>
      <p className="ep-field__help">
        Families can always see their profile and download it. This decides when they may change it,
        for example a profile update drive in April and May.
      </p>
      <fieldset className="ep-pp__radios">
        <legend className="ep-field__label">Profile updates are</legend>
        {(
          [
            ['open', 'Open all year'],
            ['period', 'Open for a period'],
            ['closed', 'Closed'],
          ] as const
        ).map(([v, l]) => (
          <label key={v} className="ep-check">
            <input
              type="radio"
              name="pp-window"
              value={v}
              checked={w.mode === v}
              onChange={() => set({ mode: v })}
            />{' '}
            {l}
          </label>
        ))}
      </fieldset>
      {w.mode === 'period' ? (
        <div className="ep-pp__inline">
          <label className="ep-field">
            <span className="ep-field__label">From *</span>
            <input
              className="ep-input"
              type="date"
              value={w.from ?? ''}
              onChange={(e) => set({ from: e.target.value || null })}
            />
          </label>
          <label className="ep-field">
            <span className="ep-field__label">To *</span>
            <input
              className="ep-input"
              type="date"
              value={w.to ?? ''}
              onChange={(e) => set({ to: e.target.value || null })}
            />
          </label>
        </div>
      ) : null}
      <label className="ep-field">
        <span className="ep-field__label">Message for families (optional)</span>
        <input
          className="ep-input"
          maxLength={300}
          value={w.message ?? ''}
          placeholder="e.g. Please check and update your child's details before 31 May."
          onChange={(e) => set({ message: e.target.value || null })}
        />
      </label>
    </div>
  );
}
