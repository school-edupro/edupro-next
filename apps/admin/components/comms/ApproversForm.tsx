'use client';
import { useState } from 'react';
import { saveApprovers, searchPeople } from '@/lib/comms-actions';
import type { Member } from '@/lib/comms';

export interface ApproverSetup {
  roleCodes: string[];
  people: Array<{ userId: string; name: string; code: string | null; designation: string | null }>;
}

/**
 * Who approves bulk messages (one step): any one of the chosen roles or named employees. Messages
 * above the approval threshold, from senders without an exempt role, wait for one of them.
 */
export function ApproversForm({
  initial,
  roles,
}: {
  initial: ApproverSetup;
  roles: Array<{ code: string; name: string }>;
}) {
  const [roleCodes, setRoleCodes] = useState(initial.roleCodes);
  // people chosen now are employees (by employee id); saved ones are shown by name
  const [people, setPeople] = useState<
    Array<{ key: string; employeeId?: string; name: string; detail: string }>
  >(
    initial.people.map((p) => ({
      key: `u${p.userId}`,
      name: p.name,
      detail: [p.code, p.designation].filter(Boolean).join(' · '),
    })),
  );
  const [savedUsers, setSavedUsers] = useState(initial.people.map((p) => p.userId));
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Member[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <section className="ep-card" aria-labelledby="appr-title">
      <h2 className="ep-card__title" id="appr-title">
        Who approves bulk messages
      </h2>
      <p className="ep-field__help">
        One step: any one of the roles or employees below approves. It applies to messages above the
        threshold in Rules, from senders without an exempt role.
      </p>
      {msg ? (
        <p
          className={msg.ok ? 'ep-alert ep-alert--success' : 'ep-alert ep-alert--danger'}
          role={msg.ok ? 'status' : 'alert'}
        >
          {msg.text}
        </p>
      ) : null}
      <fieldset className="ep-cl">
        <legend className="ep-field__label">Roles</legend>
        <ul className="ep-cl__list">
          {roles.map((r) => (
            <li key={r.code}>
              <label className="ep-roles__tick" htmlFor={`appr-role-${r.code}`}>
                <input
                  id={`appr-role-${r.code}`}
                  type="checkbox"
                  checked={roleCodes.includes(r.code)}
                  onChange={(e) =>
                    setRoleCodes(
                      e.target.checked
                        ? [...roleCodes, r.code]
                        : roleCodes.filter((x) => x !== r.code),
                    )
                  }
                />{' '}
                {r.name}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <div className="ep-field" style={{ marginTop: 'var(--sp-3)' }}>
        <span className="ep-field__label">Named employees</span>
        {people.length ? (
          <ul className="ep-chips">
            {people.map((p) => (
              <li key={p.key} className="ep-chip">
                {p.name}
                {p.detail ? ` · ${p.detail}` : ''}
                <button
                  type="button"
                  aria-label={`Remove ${p.name}`}
                  onClick={() => {
                    setPeople(people.filter((x) => x.key !== p.key));
                    if (p.key.startsWith('u'))
                      setSavedUsers(savedUsers.filter((u) => `u${u}` !== p.key));
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <span className="ep-field__help">None.</span>
        )}
        <label className="ep-field" htmlFor="appr-q" style={{ marginTop: 'var(--sp-2)' }}>
          <span className="ep-field__label">Add an employee (name or code)</span>
          <input
            id="appr-q"
            type="search"
            className="ep-input"
            value={q}
            onChange={async (e) => {
              setQ(e.target.value);
              if (e.target.value.trim().length >= 2) {
                const r = await searchPeople(e.target.value.trim(), 'employee');
                setFound(r.ok ? r.data.data : []);
              } else setFound([]);
            }}
          />
        </label>
        {found.length ? (
          <ul className="ep-compose__found">
            {found.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  disabled={people.some((p) => p.employeeId === m.id)}
                  onClick={() =>
                    setPeople([
                      ...people,
                      {
                        key: `e${m.id}`,
                        employeeId: m.id,
                        name: m.name,
                        detail: [m.ref, m.detail].filter(Boolean).join(' · '),
                      },
                    ])
                  }
                >
                  + {m.name}
                </button>
                <span className="ep-field__help">
                  {m.ref ? ` ${m.ref}` : ''}
                  {m.detail ? ` · ${m.detail}` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="ep-wdset__actions">
        <button
          type="button"
          className="ep-btn ep-btn--primary"
          onClick={async () => {
            const r = await saveApprovers({
              roleCodes,
              employeeIds: people.filter((p) => p.employeeId).map((p) => p.employeeId!),
              keepUserIds: savedUsers,
            });
            if (r.ok) {
              setMsg({ ok: true, text: 'Saved. New approval requests go to these approvers.' });
              setPeople(
                r.data.people.map((p) => ({
                  key: `u${p.userId}`,
                  name: p.name,
                  detail: [p.code, p.designation].filter(Boolean).join(' · '),
                })),
              );
              setSavedUsers(r.data.people.map((p) => p.userId));
            } else setMsg({ ok: false, text: [r.error, ...(r.errors ?? [])].join(' · ') });
          }}
        >
          Save approvers
        </button>
      </div>
    </section>
  );
}
