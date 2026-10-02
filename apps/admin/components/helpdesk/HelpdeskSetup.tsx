'use client';
import { useState, useTransition } from 'react';
import {
  DESKS,
  DESK_LABEL,
  OWNER_LABEL,
  PRIORITY_LABEL,
  type Desk,
  type Head,
  type HelpdeskSettings,
  type Level,
  type Setup,
} from '@/lib/helpdesk';
import { saveHead, saveHelpdeskSettings } from '@/lib/helpdesk-actions';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
type Draft = Omit<Head, 'used' | 'ownerName'>;

const blank = (desk: Desk): Draft => ({
  id: '',
  desk,
  code: '',
  name: '',
  description: '',
  ownerType: desk === 'provider' ? 'provider' : desk === 'parent' ? 'class_teacher' : 'role',
  ownerRole: desk === 'staff' ? 'school_admin' : null,
  ownerUserId: null,
  slaHours: desk === 'provider' ? null : 24,
  sortOrder: 50,
  active: true,
  levels: [],
});

function who(l: Level, setup: Setup) {
  if (l.assignType === 'role')
    return `role ${setup.roles.find((r) => r.code === l.roleCode)?.name ?? l.roleCode ?? ''}`;
  if (l.assignType === 'employee')
    return setup.staff.find((s) => s.id === l.userId)?.name ?? l.userName ?? 'employee';
  return 'mail only';
}

/** Helpdesk set-up: working hours, the ERP provider, and per desk the query types with owner, SLA and escalation matrix. */
export function HelpdeskSetup({ initial }: { initial: Setup }) {
  const [setup, setSetup] = useState(initial);
  const [s, setS] = useState<HelpdeskSettings>(initial.settings);
  const [desk, setDesk] = useState<Desk>('parent');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const saveSettings = () =>
    start(async () => {
      const r = await saveHelpdeskSettings(s);
      if (r.ok) {
        setSetup(r.data);
        setS(r.data.settings);
        setMsg({ ok: true, text: 'Working hours and provider details saved.' });
      } else setMsg({ ok: false, text: r.error });
    });

  const saveDraft = () => {
    if (!draft) return;
    start(async () => {
      const r = await saveHead(draft.id || null, draft);
      if (r.ok) {
        setSetup(r.data);
        setDraft(null);
        setMsg({ ok: true, text: `“${draft.name}” saved.` });
      } else setMsg({ ok: false, text: r.error });
    });
  };

  const setLevel = (i: number, patch: Partial<Level>) =>
    draft &&
    setDraft({ ...draft, levels: draft.levels.map((l, j) => (j === i ? { ...l, ...patch } : l)) });

  const heads = setup.heads.filter((h) => h.desk === desk);
  return (
    <div className="ep-hd__form">
      {msg ? (
        <p
          className={`ep-alert ${msg.ok ? 'ep-alert--success' : 'ep-alert--danger'}`}
          role="status"
        >
          {msg.text}
        </p>
      ) : null}

      <section className="ep-card" aria-labelledby="hd-hours">
        <h2 id="hd-hours" className="ep-cdash__h3" style={{ marginTop: 0 }}>
          Working hours (the SLA clock) and reopening
        </h2>
        <p className="ep-field__help">
          SLA hours count only these days and hours; holidays in the school calendar are skipped.
        </p>
        <fieldset className="ep-hd__days">
          <legend className="ep-field__label">Working days</legend>
          {DAYS.map((d, i) => (
            <label key={d} className="ep-check" htmlFor={`wd-${String(i + 1)}`}>
              <input
                id={`wd-${String(i + 1)}`}
                type="checkbox"
                checked={s.workingDays.includes(i + 1)}
                onChange={(e) =>
                  setS({
                    ...s,
                    workingDays: e.target.checked
                      ? [...s.workingDays, i + 1].sort()
                      : s.workingDays.filter((x) => x !== i + 1),
                  })
                }
              />{' '}
              {d}
            </label>
          ))}
        </fieldset>
        <div className="ep-hd__row">
          <label className="ep-field" htmlFor="hd-start">
            <span className="ep-field__label">Day starts</span>
            <input
              id="hd-start"
              type="time"
              className="ep-input"
              value={s.dayStart}
              onChange={(e) => setS({ ...s, dayStart: e.target.value })}
            />
          </label>
          <label className="ep-field" htmlFor="hd-end">
            <span className="ep-field__label">Day ends</span>
            <input
              id="hd-end"
              type="time"
              className="ep-input"
              value={s.dayEnd}
              onChange={(e) => setS({ ...s, dayEnd: e.target.value })}
            />
          </label>
          <label className="ep-field" htmlFor="hd-reopen">
            <span className="ep-field__label">Reopen allowed for (days after closing)</span>
            <input
              id="hd-reopen"
              type="number"
              min={0}
              max={60}
              className="ep-input"
              value={s.reopenDays}
              onChange={(e) => setS({ ...s, reopenDays: Number(e.target.value) })}
            />
          </label>
        </div>
        <h3 className="ep-cdash__h3">ERP provider</h3>
        <p className="ep-field__help">
          New tickets to the provider are mailed to its support address; a ticket not resolved
          within its priority’s hours is mailed to the senior person. Give the provider’s support
          staff a login with the role “ERP Support (provider)” so they can answer in EduPro.
        </p>
        <div className="ep-hd__row">
          <label className="ep-field" htmlFor="hd-pn">
            <span className="ep-field__label">Provider name</span>
            <input
              id="hd-pn"
              className="ep-input"
              value={s.providerName}
              onChange={(e) => setS({ ...s, providerName: e.target.value })}
            />
          </label>
          <label className="ep-field" htmlFor="hd-pe">
            <span className="ep-field__label">Support email</span>
            <input
              id="hd-pe"
              type="email"
              className="ep-input"
              value={s.providerEmail}
              onChange={(e) => setS({ ...s, providerEmail: e.target.value })}
            />
          </label>
          <label className="ep-field" htmlFor="hd-sn">
            <span className="ep-field__label">Senior person</span>
            <input
              id="hd-sn"
              className="ep-input"
              value={s.providerSeniorName}
              onChange={(e) => setS({ ...s, providerSeniorName: e.target.value })}
            />
          </label>
          <label className="ep-field" htmlFor="hd-se">
            <span className="ep-field__label">Senior person’s email (escalation)</span>
            <input
              id="hd-se"
              type="email"
              className="ep-input"
              value={s.providerSeniorEmail}
              onChange={(e) => setS({ ...s, providerSeniorEmail: e.target.value })}
            />
          </label>
        </div>
        <div className="ep-hd__row">
          {(['urgent', 'high', 'normal', 'low'] as const).map((p) => (
            <label key={p} className="ep-field" htmlFor={`sla-${p}`}>
              <span className="ep-field__label">
                {PRIORITY_LABEL[p]}: resolve within (working hours)
              </span>
              <input
                id={`sla-${p}`}
                type="number"
                min={0.5}
                step={0.5}
                className="ep-input"
                value={s.providerSla[p]}
                onChange={(e) =>
                  setS({ ...s, providerSla: { ...s.providerSla, [p]: Number(e.target.value) } })
                }
              />
            </label>
          ))}
        </div>
        <div>
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            disabled={pending}
            onClick={saveSettings}
          >
            Save working hours and provider
          </button>
        </div>
      </section>

      <section className="ep-card" aria-labelledby="hd-heads">
        <h2 id="hd-heads" className="ep-cdash__h3" style={{ marginTop: 0 }}>
          Query types, owners and the escalation matrix
        </h2>
        <div className="ep-tabs" role="tablist" aria-label="Desk">
          {DESKS.map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={desk === d}
              className={`ep-btn ep-btn--sm ${desk === d ? 'ep-btn--primary' : 'ep-btn--ghost'}`}
              onClick={() => {
                setDesk(d);
                setDraft(null);
              }}
            >
              {DESK_LABEL[d]}
            </button>
          ))}
        </div>
        <div
          className="ep-table-wrap"
          tabIndex={0}
          role="region"
          aria-label={`${DESK_LABEL[desk]} query types`}
        >
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">{DESK_LABEL[desk]} query types</caption>
            <thead>
              <tr>
                <th scope="col">Query type</th>
                <th scope="col">Goes to (level 1)</th>
                <th scope="col">Resolve within</th>
                <th scope="col">If not resolved</th>
                <th scope="col">Used</th>
                <th scope="col">
                  <span className="ep-sr-only">Edit</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {heads.map((h) => (
                <tr key={h.id}>
                  <td>
                    {h.name} {h.active ? null : <span className="ep-field__help">(inactive)</span>}
                    <div className="ep-field__help">{h.code}</div>
                  </td>
                  <td>
                    {h.ownerType === 'role'
                      ? `Role: ${setup.roles.find((r) => r.code === h.ownerRole)?.name ?? h.ownerRole ?? ''}`
                      : h.ownerType === 'employee'
                        ? (h.ownerName ?? 'employee')
                        : OWNER_LABEL[h.ownerType]}
                  </td>
                  <td>
                    {desk === 'provider'
                      ? 'by priority'
                      : h.slaHours
                        ? `${String(h.slaHours)} h`
                        : 'no limit'}
                  </td>
                  <td>
                    {h.levels.length
                      ? h.levels
                          .map((l) => `L${String(l.level)} ${who(l, setup)} (${String(l.hours)} h)`)
                          .join(' → ')
                      : desk === 'provider'
                        ? 'senior person by mail'
                        : '—'}
                  </td>
                  <td>{h.used}</td>
                  <td>
                    <button
                      type="button"
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      onClick={() => setDraft({ ...h })}
                    >
                      Edit <span className="ep-sr-only">{h.name}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <button
            type="button"
            className="ep-btn ep-btn--secondary ep-btn--sm"
            onClick={() => setDraft(blank(desk))}
          >
            Add a query type
          </button>
        </div>

        {draft ? (
          <div className="ep-hd__editor" role="group" aria-labelledby="hd-ed-title">
            <h3 id="hd-ed-title" className="ep-cdash__h3" style={{ marginTop: 0 }}>
              {draft.id ? `Edit “${draft.name}”` : `New ${DESK_LABEL[desk].toLowerCase()} type`}
            </h3>
            <div className="ep-hd__row">
              <label className="ep-field" htmlFor="ed-name">
                <span className="ep-field__label">Name</span>
                <input
                  id="ed-name"
                  className="ep-input"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <label className="ep-field" htmlFor="ed-code">
                <span className="ep-field__label">Code</span>
                <input
                  id="ed-code"
                  className="ep-input"
                  value={draft.code}
                  disabled={
                    Boolean(draft.id) && (setup.heads.find((h) => h.id === draft.id)?.used ?? 0) > 0
                  }
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                    })
                  }
                />
              </label>
              <label className="ep-field" htmlFor="ed-order">
                <span className="ep-field__label">Order</span>
                <input
                  id="ed-order"
                  type="number"
                  min={0}
                  max={999}
                  className="ep-input"
                  value={draft.sortOrder}
                  onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })}
                />
              </label>
            </div>
            <label className="ep-field" htmlFor="ed-desc">
              <span className="ep-field__label">Help text shown when raising (optional)</span>
              <input
                id="ed-desc"
                className="ep-input"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </label>
            {desk !== 'provider' ? (
              <div className="ep-hd__row">
                <label className="ep-field" htmlFor="ed-owner">
                  <span className="ep-field__label">Goes to</span>
                  <select
                    id="ed-owner"
                    className="ep-select"
                    value={draft.ownerType}
                    onChange={(e) =>
                      setDraft({ ...draft, ownerType: e.target.value as Draft['ownerType'] })
                    }
                  >
                    {desk === 'parent' ? (
                      <option value="class_teacher">{OWNER_LABEL.class_teacher}</option>
                    ) : null}
                    <option value="role">{OWNER_LABEL.role}</option>
                    <option value="employee">{OWNER_LABEL.employee}</option>
                  </select>
                </label>
                {draft.ownerType === 'role' ? (
                  <label className="ep-field" htmlFor="ed-role">
                    <span className="ep-field__label">Role</span>
                    <select
                      id="ed-role"
                      className="ep-select"
                      value={draft.ownerRole ?? ''}
                      onChange={(e) => setDraft({ ...draft, ownerRole: e.target.value })}
                    >
                      <option value="">Choose…</option>
                      {setup.roles.map((r) => (
                        <option key={r.code} value={r.code}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {draft.ownerType === 'employee' ? (
                  <label className="ep-field" htmlFor="ed-user">
                    <span className="ep-field__label">Employee</span>
                    <select
                      id="ed-user"
                      className="ep-select"
                      value={draft.ownerUserId ?? ''}
                      onChange={(e) => setDraft({ ...draft, ownerUserId: e.target.value })}
                    >
                      <option value="">Choose…</option>
                      {setup.staff.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className="ep-field" htmlFor="ed-sla">
                  <span className="ep-field__label">Resolve within (working hours)</span>
                  <input
                    id="ed-sla"
                    type="number"
                    min={0.5}
                    step={0.5}
                    className="ep-input"
                    value={draft.slaHours ?? ''}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        slaHours: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  />
                </label>
              </div>
            ) : (
              <p className="ep-field__help">
                Answered by the ERP provider; the time allowed comes from the ticket’s priority
                (above).
              </p>
            )}
            <label className="ep-check" htmlFor="ed-active">
              <input
                id="ed-active"
                type="checkbox"
                checked={draft.active}
                onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
              />{' '}
              Active (shown when raising)
            </label>

            <h4 className="ep-field__label">
              Escalation matrix: if level {draft.levels.length + 1 > 1 ? 'n' : '1'} does not resolve
              in time
            </h4>
            {draft.levels.map((l, i) => (
              <fieldset key={i} className="ep-hd__level">
                <legend>Level {l.level}</legend>
                <div className="ep-hd__row">
                  <label className="ep-field" htmlFor={`lv-type-${String(i)}`}>
                    <span className="ep-field__label">Goes to</span>
                    <select
                      id={`lv-type-${String(i)}`}
                      className="ep-select"
                      value={l.assignType}
                      onChange={(e) =>
                        setLevel(i, { assignType: e.target.value as Level['assignType'] })
                      }
                    >
                      <option value="role">A role (reassigned)</option>
                      <option value="employee">A named employee (reassigned)</option>
                      <option value="email_only">Email only (stays with the current owner)</option>
                    </select>
                  </label>
                  {l.assignType === 'role' ? (
                    <label className="ep-field" htmlFor={`lv-role-${String(i)}`}>
                      <span className="ep-field__label">Role</span>
                      <select
                        id={`lv-role-${String(i)}`}
                        className="ep-select"
                        value={l.roleCode ?? ''}
                        onChange={(e) => setLevel(i, { roleCode: e.target.value })}
                      >
                        <option value="">Choose…</option>
                        {setup.roles.map((r) => (
                          <option key={r.code} value={r.code}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {l.assignType === 'employee' ? (
                    <label className="ep-field" htmlFor={`lv-user-${String(i)}`}>
                      <span className="ep-field__label">Employee</span>
                      <select
                        id={`lv-user-${String(i)}`}
                        className="ep-select"
                        value={l.userId ?? ''}
                        onChange={(e) => setLevel(i, { userId: e.target.value })}
                      >
                        <option value="">Choose…</option>
                        {setup.staff.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label className="ep-field" htmlFor={`lv-hours-${String(i)}`}>
                    <span className="ep-field__label">Time at this level (working hours)</span>
                    <input
                      id={`lv-hours-${String(i)}`}
                      type="number"
                      min={0.5}
                      step={0.5}
                      className="ep-input"
                      value={l.hours}
                      onChange={(e) => setLevel(i, { hours: Number(e.target.value) })}
                    />
                  </label>
                </div>
                <label className="ep-field" htmlFor={`lv-mail-${String(i)}`}>
                  <span className="ep-field__label">
                    Also email (comma separated, e.g. principal, management)
                  </span>
                  <input
                    id={`lv-mail-${String(i)}`}
                    className="ep-input"
                    value={l.emails.join(', ')}
                    onChange={(e) =>
                      setLevel(i, {
                        emails: e.target.value
                          .split(/[,;\s]+/)
                          .map((x) => x.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </label>
                {i === draft.levels.length - 1 ? (
                  <button
                    type="button"
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    onClick={() => setDraft({ ...draft, levels: draft.levels.slice(0, -1) })}
                  >
                    Remove level {l.level}
                  </button>
                ) : null}
              </fieldset>
            ))}
            {draft.levels.length < 5 ? (
              <div>
                <button
                  type="button"
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      levels: [
                        ...draft.levels,
                        {
                          level: draft.levels.length + 2,
                          hours: 24,
                          assignType: 'role',
                          roleCode: 'school_admin',
                          userId: null,
                          emails: [],
                        },
                      ],
                    })
                  }
                >
                  Add level {draft.levels.length + 2}
                </button>
              </div>
            ) : null}
            <div className="ep-cdash__export">
              <button
                type="button"
                className="ep-btn ep-btn--primary"
                disabled={pending}
                onClick={saveDraft}
              >
                Save query type
              </button>
              <button type="button" className="ep-btn ep-btn--ghost" onClick={() => setDraft(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
