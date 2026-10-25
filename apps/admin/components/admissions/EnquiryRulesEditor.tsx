'use client';
import { Badge } from '@edupro/ui';
import { useState, useTransition } from 'react';
import { saveEnquiryRules } from '@/lib/admission-enquiry-actions';
import type { EnquiryRule } from '@/lib/admission-enquiry';

type Draft = Omit<EnquiryRule, 'id' | 'leads' | 'level2Name' | 'status'> & {
  id?: string;
  /** the hours as typed */
  hoursText: string;
};
const blank = (): Draft => ({
  name: '',
  classIds: [],
  sourceIds: [],
  autoAssign: true,
  pool: [],
  poolRoles: [],
  firstContactHours: 4,
  hoursText: '4',
  level2UserId: null,
  level2Role: null,
  acknowledge: true,
  isDefault: false,
});

/**
 * The enquiry desk's assignment rules (docs/design/45, part 3), laid out like the approval processes:
 * which classes and sources a rule covers, the counsellors who take its leads in turn, the working hours
 * for the first contact, and who takes a lead over when nobody called in time.
 */
export function EnquiryRulesEditor({
  initial,
  counsellors,
  classes,
  sources,
  roles,
  channels,
  canEdit,
}: {
  initial: EnquiryRule[];
  counsellors: Array<{ id: string; name: string }>;
  classes: Array<{ id: string; name: string }>;
  sources: Array<{ id: string; name: string }>;
  roles: Array<{ code: string; name: string }>;
  channels: string[];
  canEdit: boolean;
}) {
  const [rules, setRules] = useState(initial.filter((r) => r.status === 'active'));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const nameOf = (list: Array<{ id: string; name: string }>, ids: string[], none: string) =>
    ids.length ? ids.map((id) => list.find((x) => x.id === id)?.name ?? '?').join(', ') : none;
  const by = [
    channels.includes('email') ? 'email' : '',
    channels.includes('sms') ? 'SMS' : '',
    channels.includes('whatsapp') ? 'WhatsApp' : '',
  ]
    .filter(Boolean)
    .join(', ');
  const save = (next: Array<EnquiryRule | Draft>) =>
    start(async () => {
      const r = await saveEnquiryRules(
        next.map((x) => ({
          ...(x.id ? { id: x.id } : {}),
          name: x.name,
          classIds: x.classIds,
          sourceIds: x.sourceIds,
          autoAssign: x.autoAssign,
          pool: x.pool,
          poolRoles: x.poolRoles,
          firstContactHours: x.firstContactHours,
          level2UserId: x.level2UserId,
          level2Role: x.level2Role,
          acknowledge: x.acknowledge,
          isDefault: x.isDefault,
        })),
      );
      if (r.ok) {
        setRules(r.data.filter((x) => x.status === 'active'));
        setDraft(null);
        setMsg({ tone: 'success', text: 'Rules saved.' });
      } else setMsg({ tone: 'danger', text: r.error });
    });
  const toggle = (list: string[], id: string, on: boolean) =>
    on ? [...list, id] : list.filter((x) => x !== id);
  const checks = (
    legend: string,
    options: Array<{ id: string; name: string }>,
    value: string[],
    set: (v: string[]) => void,
  ) => (
    <fieldset className="ep-fb__group">
      <legend>{legend}</legend>
      <div className="ep-fb__radios">
        {options.map((o) => (
          <label key={o.id} className="ep-check">
            <input
              type="checkbox"
              className="ep-check__input"
              checked={value.includes(o.id)}
              onChange={(e) => set(toggle(value, o.id, e.target.checked))}
            />
            <span className="ep-check__box" aria-hidden="true" />
            <span className="ep-check__text">{o.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
  return (
    <section className="ep-card ep-as__card" aria-labelledby="as-desk">
      <h2 id="as-desk" className="ep-as__h">
        Enquiry desk
      </h2>
      <p className="ep-field__help">
        Who takes each enquiry from the website, the desk&rsquo;s imports and campaigns. A rule
        covers classes and sources; its counsellors take its leads in turn; when nobody calls the
        family within its working hours, level 2 takes the lead over and is told by email. An
        enquiry no rule covers follows the rule for everything else.
      </p>
      <ul className="ep-pe__list">
        {rules.map((r) => (
          <li key={r.id} className="ep-pe__item">
            <div>
              <strong>{r.name}</strong>{' '}
              {r.isDefault ? <Badge tone="info">Everything else</Badge> : null}
              <div className="ep-kicker">
                {r.isDefault
                  ? 'Enquiries no other rule covers'
                  : `${nameOf(classes, r.classIds, 'Every class')} · ${nameOf(sources, r.sourceIds, 'every source')}`}
              </div>
              <ol className="ep-pe__flow">
                <li>
                  {r.autoAssign
                    ? `In turn: ${
                        [
                          ...r.poolRoles.map(
                            (code) => roles.find((x) => x.code === code)?.name ?? code,
                          ),
                          ...r.pool.map((id) => counsellors.find((x) => x.id === id)?.name ?? '?'),
                        ].join(', ') || 'everyone who takes enquiries'
                      }`
                    : 'Waits for someone to take it'}
                </li>
                {r.firstContactHours ? (
                  <li>First contact within {r.firstContactHours} working hours</li>
                ) : null}
                {r.firstContactHours && r.level2Name ? <li>Then {r.level2Name}</li> : null}
                {r.acknowledge ? <li>Acknowledged to the family</li> : null}
              </ol>
            </div>
            {canEdit ? (
              <span className="ep-as__catacts">
                <button
                  type="button"
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  onClick={() =>
                    setDraft({
                      ...r,
                      hoursText: r.firstContactHours ? String(r.firstContactHours) : '',
                    })
                  }
                >
                  Edit
                </button>
                {r.isDefault ? null : (
                  <button
                    type="button"
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    disabled={pending}
                    onClick={() => save(rules.filter((x) => x.id !== r.id))}
                  >
                    Remove
                  </button>
                )}
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      {draft ? (
        <div
          className="ep-pe__draft"
          role="group"
          aria-label={draft.id ? 'Edit the rule' : 'New rule'}
        >
          <label className="ep-field">
            <span className="ep-field__label">Rule name</span>
            <input
              className="ep-input"
              value={draft.name}
              maxLength={80}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          {draft.isDefault ? (
            <p className="ep-field__help">This rule takes every enquiry no other rule covers.</p>
          ) : (
            <>
              {checks('Classes it covers (none: every class)', classes, draft.classIds, (v) =>
                setDraft({ ...draft, classIds: v }),
              )}
              {checks('Sources it covers (none: every source)', sources, draft.sourceIds, (v) =>
                setDraft({ ...draft, sourceIds: v }),
              )}
            </>
          )}
          <label className="ep-check">
            <input
              type="checkbox"
              className="ep-check__input"
              checked={draft.autoAssign}
              onChange={(e) => setDraft({ ...draft, autoAssign: e.target.checked })}
            />
            <span className="ep-check__box" aria-hidden="true" />
            <span className="ep-check__text">
              Give each lead to a counsellor on arrival (in turn: the one with the fewest open
              leads)
            </span>
          </label>
          {draft.autoAssign ? (
            <>
              {checks(
                'Roles: whoever holds one when a lead arrives',
                roles.map((r) => ({ id: r.code, name: r.name })),
                draft.poolRoles,
                (v) => setDraft({ ...draft, poolRoles: v }),
              )}
              {checks(
                'And people by name (no role and no person: everyone who takes enquiries)',
                counsellors,
                draft.pool,
                (v) => setDraft({ ...draft, pool: v }),
              )}
            </>
          ) : null}
          <div className="ep-pe__levels">
            <label className="ep-field">
              <span className="ep-field__label">First contact within (working hours)</span>
              <input
                className="ep-input"
                inputMode="decimal"
                placeholder="No limit"
                value={draft.hoursText}
                onChange={(e) => {
                  const t = e.target.value.replace(/[^\d.]/g, '');
                  const n = Number(t);
                  setDraft({ ...draft, hoursText: t, firstContactHours: t && n > 0 ? n : null });
                }}
              />
            </label>
            <label className="ep-field">
              <span className="ep-field__label">Then level 2</span>
              <select
                className="ep-select"
                disabled={!draft.firstContactHours}
                value={
                  draft.level2UserId
                    ? `u:${draft.level2UserId}`
                    : draft.level2Role
                      ? `r:${draft.level2Role}`
                      : ''
                }
                onChange={(e) => {
                  const v = e.target.value;
                  setDraft({
                    ...draft,
                    level2UserId: v.startsWith('u:') ? v.slice(2) : null,
                    level2Role: v.startsWith('r:') ? v.slice(2) : null,
                  });
                }}
              >
                <option value="">Nobody (no escalation)</option>
                <optgroup label="A person">
                  {counsellors.map((c) => (
                    <option key={c.id} value={`u:${c.id}`}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="A role (its holder with the fewest open leads)">
                  {roles.map((r) => (
                    <option key={r.code} value={`r:${r.code}`}>
                      {r.name}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
          </div>
          <label className="ep-check">
            <input
              type="checkbox"
              className="ep-check__input"
              checked={draft.acknowledge}
              onChange={(e) => setDraft({ ...draft, acknowledge: e.target.checked })}
            />
            <span className="ep-check__box" aria-hidden="true" />
            <span className="ep-check__text">
              Acknowledge each website enquiry to the family with its number
              {by ? ` (by ${by}, as the sign-in codes go)` : ''}
            </span>
          </label>
          <div className="ep-form-actions">
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              disabled={pending || draft.name.trim().length < 2}
              onClick={() =>
                save(
                  draft.id
                    ? rules.map((x) => (x.id === draft.id ? { ...x, ...draft } : x))
                    : [
                        ...rules.filter((x) => !x.isDefault),
                        draft,
                        ...rules.filter((x) => x.isDefault),
                      ],
                )
              }
            >
              Save the rule
            </button>
            <button type="button" className="ep-btn ep-btn--ghost" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : canEdit ? (
        <div className="ep-form-actions">
          <button
            type="button"
            className="ep-btn ep-btn--secondary"
            onClick={() => setDraft(blank())}
          >
            Add a rule
          </button>
        </div>
      ) : null}
      {msg ? (
        <p
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
        >
          {msg.text}
        </p>
      ) : null}
    </section>
  );
}
