'use client';
import { useState } from 'react';
import type { WorkflowDefinition, WorkflowResolver } from '@/lib/types';

export interface WorkflowOptions {
  roles: Array<{ code: string; name: string }>;
  designations: string[];
  people: Array<{ id: string; name: string }>;
}
type Kind = 'roles' | 'person' | 'designation' | 'chain';
interface Row {
  key: number;
  name: string;
  kind: Kind;
  roleCodes: string[];
  userId: string;
  designation: string;
  depth: number;
  sla: string;
  auto: boolean;
  escalate: string;
}

const fromResolver = (
  r: WorkflowResolver,
): Pick<Row, 'kind' | 'roleCodes' | 'userId' | 'designation' | 'depth'> => {
  const base = { roleCodes: [] as string[], userId: '', designation: '', depth: 1 };
  if (r.kind === 'role') return { ...base, kind: 'roles', roleCodes: [r.roleCode] };
  if (r.kind === 'any_of')
    return r.roleCodes.length > 0 || r.userIds.length === 0
      ? { ...base, kind: 'roles', roleCodes: r.roleCodes }
      : { ...base, kind: 'person', userId: r.userIds[0] ?? '' };
  if (r.kind === 'named_user') return { ...base, kind: 'person', userId: r.userId };
  if (r.kind === 'position') return { ...base, kind: 'designation', designation: r.designation };
  return { ...base, kind: 'chain', depth: r.depth };
};
const toResolver = (r: Row): WorkflowResolver | null => {
  if (r.kind === 'roles')
    return r.roleCodes.length === 0
      ? null
      : r.roleCodes.length === 1
        ? { kind: 'role', roleCode: r.roleCodes[0]! }
        : { kind: 'any_of', roleCodes: r.roleCodes, userIds: [] };
  if (r.kind === 'person') return r.userId ? { kind: 'named_user', userId: r.userId } : null;
  if (r.kind === 'designation')
    return r.designation.trim().length >= 2
      ? { kind: 'position', designation: r.designation.trim() }
      : null;
  return { kind: 'approver_chain', depth: r.depth };
};

function RoleTicks({
  roles,
  chosen,
  onToggle,
  label,
}: {
  roles: WorkflowOptions['roles'];
  chosen: string[];
  onToggle: (code: string) => void;
  label: string;
}) {
  return (
    <fieldset>
      <legend className="ep-field__label">{label}</legend>
      <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
        {roles.map((r) => (
          <label key={r.code} className="ep-check">
            <input
              type="checkbox"
              className="ep-check__input"
              checked={chosen.includes(r.code)}
              onChange={() => onToggle(r.code)}
            />
            <span className="ep-check__box" aria-hidden="true" />
            <span className="ep-check__text">{r.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * One workflow as a chain: who may raise the request, then the approval levels in order. Roles are
 * ticked from the school's role list; nothing is typed as a code.
 */
export function WorkflowEditor({
  def,
  options,
  action,
}: {
  def: WorkflowDefinition;
  options: WorkflowOptions;
  action: (fd: FormData) => Promise<void>;
}) {
  const [name, setName] = useState(def.name);
  const [creators, setCreators] = useState<string[]>(def.creatorRoles ?? []);
  const [rows, setRows] = useState<Row[]>(
    def.levels.map((l, i) => ({
      key: i + 1,
      name: l.name,
      ...fromResolver(l.resolver),
      sla: l.slaHours ? String(l.slaHours) : '',
      auto: Boolean(l.autoIfRequester),
      escalate: l.escalateTo?.kind === 'role' ? l.escalateTo.roleCode : '',
    })),
  );
  const [next, setNext] = useState(def.levels.length + 1);
  const patch = (key: number, p: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const toggle = (list: string[], code: string) =>
    list.includes(code) ? list.filter((c) => c !== code) : [...list, code];
  const roleName = (code: string) => options.roles.find((r) => r.code === code)?.name ?? code;
  const problems = rows
    .map((r, i) =>
      !r.name.trim()
        ? `Level ${i + 1} needs a name`
        : toResolver(r) === null
          ? `Level ${i + 1} needs its approver`
          : '',
    )
    .filter(Boolean);
  if (rows.length === 0) problems.push('Add at least one approval level');
  const payload = JSON.stringify({
    name: name.trim(),
    creatorRoles: creators,
    levels: rows.map((r, i) => ({
      level: i + 1,
      name: r.name.trim(),
      resolver: toResolver(r),
      ...(Number(r.sla) > 0 ? { slaHours: Number(r.sla) } : {}),
      ...(r.escalate ? { escalateTo: { kind: 'role', roleCode: r.escalate } } : {}),
      ...(r.auto && i < rows.length - 1 ? { autoIfRequester: true } : {}),
    })),
  });
  return (
    <form action={action}>
      <input type="hidden" name="id" value={def.id} />
      <input type="hidden" name="payload" value={payload} />
      <label className="ep-field" style={{ maxWidth: '36rem' }}>
        <span className="ep-field__label">Name of this approval *</span>
        <input
          className="ep-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={120}
        />
      </label>

      <section className="ep-card" style={{ padding: 'var(--sp-4)', margin: 'var(--sp-4) 0' }}>
        <h3 className="ep-h4">Who creates the request</h3>
        <RoleTicks
          roles={options.roles}
          chosen={creators}
          onToggle={(code) => setCreators((cs) => toggle(cs, code))}
          label="Creator roles"
        />
        <p className="ep-field__help">
          {creators.length === 0
            ? 'Nothing ticked: anyone whose permissions allow it can raise this request.'
            : `Only ${creators.map(roleName).join(', ')} can raise this request.`}
        </p>
      </section>

      {rows.map((r, i) => (
        <section
          key={r.key}
          className="ep-card"
          style={{ padding: 'var(--sp-4)', marginBottom: 'var(--sp-3)' }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 'var(--sp-3)',
              alignItems: 'center',
            }}
          >
            <h3 className="ep-h4">Approval level {i + 1}</h3>
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
              disabled={rows.length === 1}
            >
              Remove this level
            </button>
          </div>
          <div
            style={{
              display: 'grid',
              gap: 'var(--sp-3)',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 14rem), 1fr))',
              alignItems: 'start',
            }}
          >
            <label className="ep-field">
              <span className="ep-field__label">Level name *</span>
              <input
                className="ep-input"
                value={r.name}
                onChange={(e) => patch(r.key, { name: e.target.value })}
                maxLength={80}
                placeholder="e.g. Fee in-charge"
              />
            </label>
            <label className="ep-field">
              <span className="ep-field__label">Approved by *</span>
              <select
                className="ep-select"
                value={r.kind}
                onChange={(e) => patch(r.key, { kind: e.target.value as Kind })}
              >
                <option value="roles">People holding a role</option>
                <option value="person">One named person</option>
                <option value="designation">People with a designation</option>
                <option value="chain">The creator’s reporting officer</option>
              </select>
            </label>
            <label className="ep-field">
              <span className="ep-field__label">Hours allowed</span>
              <input
                className="ep-input"
                type="number"
                min={1}
                max={720}
                value={r.sla}
                onChange={(e) => patch(r.key, { sla: e.target.value })}
                placeholder="e.g. 24"
              />
              <span className="ep-field__help">After this it shows as overdue.</span>
            </label>
          </div>
          <div style={{ marginTop: 'var(--sp-3)' }}>
            {r.kind === 'roles' ? (
              <>
                <RoleTicks
                  roles={options.roles}
                  chosen={r.roleCodes}
                  onToggle={(code) =>
                    setRows((rs) =>
                      rs.map((x) =>
                        x.key === r.key ? { ...x, roleCodes: toggle(x.roleCodes, code) } : x,
                      ),
                    )
                  }
                  label="Roles that can approve this level (any one person among them) *"
                />
              </>
            ) : r.kind === 'person' ? (
              <label className="ep-field" style={{ maxWidth: '28rem' }}>
                <span className="ep-field__label">Person *</span>
                <select
                  className="ep-select"
                  value={r.userId}
                  onChange={(e) => patch(r.key, { userId: e.target.value })}
                >
                  <option value="">Choose the person</option>
                  {options.people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : r.kind === 'designation' ? (
              <label className="ep-field" style={{ maxWidth: '28rem' }}>
                <span className="ep-field__label">Designation *</span>
                <select
                  className="ep-select"
                  value={r.designation}
                  onChange={(e) => patch(r.key, { designation: e.target.value })}
                >
                  <option value="">Choose the designation</option>
                  {[...new Set([r.designation, ...options.designations].filter(Boolean))].map(
                    (d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ),
                  )}
                </select>
              </label>
            ) : (
              <p className="ep-field__help">
                Goes to the officer the creator reports to (from the staff posting).
              </p>
            )}
          </div>
          {i < rows.length - 1 ? (
            <label className="ep-check" style={{ marginTop: 'var(--sp-3)' }}>
              <input
                type="checkbox"
                className="ep-check__input"
                checked={r.auto}
                onChange={() => patch(r.key, { auto: !r.auto })}
              />
              <span className="ep-check__box" aria-hidden="true" />
              <span className="ep-check__text">
                If the person who creates the request is an approver of this level, approve this
                level by itself
              </span>
            </label>
          ) : (
            <p className="ep-field__help" style={{ marginTop: 'var(--sp-3)' }}>
              The last level is always approved by a person.
            </p>
          )}
        </section>
      ))}
      <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          className="ep-btn ep-btn--secondary"
          disabled={rows.length >= 6}
          onClick={() => {
            setRows((rs) => [
              ...rs,
              {
                key: next,
                name: '',
                kind: 'roles',
                roleCodes: [],
                userId: '',
                designation: '',
                depth: 1,
                sla: '',
                auto: false,
                escalate: '',
              },
            ]);
            setNext((n) => n + 1);
          }}
        >
          ＋ Add approval level
        </button>
        <button type="submit" className="ep-btn" disabled={problems.length > 0 || !name.trim()}>
          Save
        </button>
        <a className="ep-btn ep-btn--ghost" href="/workflow/definitions">
          Cancel
        </a>
      </div>
      {problems.length > 0 ? (
        <p className="ep-field__help" role="status">
          {problems.join(' · ')}
        </p>
      ) : null}
      <p className="ep-field__help">
        Changes apply to new requests; requests already waiting keep the levels they started with.
      </p>
    </form>
  );
}
