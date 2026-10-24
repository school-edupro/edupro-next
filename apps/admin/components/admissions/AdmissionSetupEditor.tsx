'use client';
import { Badge, RULE_OPS, type AdmissionCondition } from '@edupro/ui';
import { useId, useState, useTransition } from 'react';
import { saveAdmissionSettings, saveFeeCategories } from '@/lib/admission-setup-actions';
import type { AdmissionSetup, FeeCategory } from '@/lib/admission-setup';

const CHANNELS = [
  ['email', 'Email'],
  ['sms', 'SMS'],
  ['whatsapp', 'WhatsApp'],
] as const;
const OP: Record<string, string> = {
  eq: 'is',
  neq: 'is not',
  in: 'is one of (a|b)',
  not_in: 'is none of (a|b)',
  empty: 'is empty',
  not_empty: 'is answered',
  gt: 'is more than',
  lt: 'is less than',
  gte: 'is at least',
  lte: 'is at most',
};
type Cat = Omit<FeeCategory, 'sortOrder' | 'id'> & { id?: string; key: string };

/**
 * Admission set-up (docs/design/39, part 2): the channels sign-in codes go by, the receipt series, and the
 * fee categories with the form answers that put a candidate in each (the first that matches, else the
 * default). Part 4 adds the stages and approval processes here.
 */
export function AdmissionSetupEditor({
  setup,
  formFields,
  canEdit,
}: {
  setup: AdmissionSetup;
  formFields: Array<{ key: string; label: string }>;
  canEdit: boolean;
}) {
  const fieldList = useId();
  const [s, setS] = useState(setup.settings);
  const [cats, setCats] = useState<Cat[]>(() => setup.categories.map((c) => ({ ...c, key: c.id })));
  const [msg, setMsg] = useState<{
    tone: 'success' | 'danger';
    text: string;
    where: 'settings' | 'cats';
  } | null>(null);
  const [pending, start] = useTransition();
  const label = (key: string) => formFields.find((f) => f.key === key)?.label ?? key;
  const setCat = (i: number, patch: Partial<Cat>) =>
    setCats((cur) => cur.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const setCond = (i: number, k: number, patch: Partial<AdmissionCondition>) =>
    setCat(i, {
      conditions: cats[i]!.conditions.map((c, m) => (m === k ? { ...c, ...patch } : c)),
    });

  return (
    <div className="ep-as">
      <datalist id={fieldList}>
        {formFields.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </datalist>
      <section className="ep-card ep-as__card" aria-labelledby="as-signin">
        <h2 id="as-signin" className="ep-as__h">
          Sign-in and receipts
        </h2>
        <fieldset className="ep-fb__group">
          <legend>Sign-in code goes by</legend>
          <div className="ep-fb__radios">
            {CHANNELS.map(([v, l]) => (
              <label key={v} className="ep-check">
                <input
                  type="checkbox"
                  className="ep-check__input"
                  disabled={!canEdit}
                  checked={s.signinChannels.includes(v)}
                  onChange={(e) =>
                    setS({
                      ...s,
                      signinChannels: e.target.checked
                        ? [...s.signinChannels, v]
                        : s.signinChannels.filter((x) => x !== v),
                    })
                  }
                />
                <span className="ep-check__box" aria-hidden="true" />
                <span className="ep-check__text">{l}</span>
              </label>
            ))}
          </div>
          <p className="ep-field__help">
            The candidate signs in with a mobile number, an email or the registration number; the
            code goes to every ticked channel the school can send on (SMS needs a DLT template,
            WhatsApp an approved template, email a mail account in Communication set-up).
          </p>
          <label className="ep-check">
            <input
              type="checkbox"
              className="ep-check__input"
              disabled={!canEdit}
              checked={s.otpOnScreen}
              onChange={(e) => setS({ ...s, otpOnScreen: e.target.checked })}
            />
            <span className="ep-check__box" aria-hidden="true" />
            <span className="ep-check__text">
              Also show the sign-in code on screen (testing, while email or SMS is being set up)
            </span>
          </label>
          <p className="ep-field__help">
            Anyone who types a mobile number or email then sees its code, so switch this off before
            registrations open. Every code shown is recorded
            {s.codesShown7d ? `: ${String(s.codesShown7d)} in the last 7 days` : ''}.
          </p>
        </fieldset>
        <div className="ep-as__grid">
          <label className="ep-field">
            <span className="ep-field__label">Registration receipt prefix</span>
            <input
              className="ep-input"
              maxLength={6}
              disabled={!canEdit}
              value={s.regReceiptPrefix}
              onChange={(e) =>
                setS({
                  ...s,
                  regReceiptPrefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, ''),
                })
              }
            />
            <span className="ep-field__help">
              Receipts read {s.regReceiptPrefix || 'RF'}/2027-28/000001
            </span>
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Admission receipt prefix</span>
            <input
              className="ep-input"
              maxLength={6}
              disabled={!canEdit}
              value={s.admReceiptPrefix}
              onChange={(e) =>
                setS({
                  ...s,
                  admReceiptPrefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, ''),
                })
              }
            />
            <span className="ep-field__help">
              Receipts read {s.admReceiptPrefix || 'AF'}/2027-28/000001
            </span>
          </label>
        </div>
        {msg?.where === 'settings' ? (
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
              className="ep-btn ep-btn--primary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await saveAdmissionSettings(s);
                  setMsg(
                    r.ok
                      ? { tone: 'success', text: 'Saved.', where: 'settings' }
                      : { tone: 'danger', text: r.error, where: 'settings' },
                  );
                })
              }
            >
              Save
            </button>
          </div>
        ) : null}
      </section>

      <section className="ep-card ep-as__card" aria-labelledby="as-cats">
        <h2 id="as-cats" className="ep-as__h">
          Fee categories
        </h2>
        <p className="ep-field__help">
          The registration and admission fee of a class can differ by category. A candidate&rsquo;s
          category is the first one (top to bottom) whose conditions hold for the form&rsquo;s
          answers; the default category takes everyone else. The office confirms or changes it at
          Document check.
        </p>
        <ol className="ep-as__cats">
          {cats.map((c, i) => (
            <li key={c.key} className="ep-as__cat" data-off={c.status === 'inactive' || undefined}>
              <div className="ep-as__cathead">
                <span className="ep-fb__stepno">{i + 1}</span>
                <input
                  className="ep-input"
                  aria-label="Category name"
                  disabled={!canEdit}
                  value={c.name}
                  maxLength={60}
                  onChange={(e) => setCat(i, { name: e.target.value })}
                />
                <input
                  className="ep-input ep-as__code"
                  aria-label="Code"
                  disabled={!canEdit || Boolean(c.id)}
                  value={c.code}
                  maxLength={30}
                  onChange={(e) =>
                    setCat(i, { code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })
                  }
                />
                {c.isDefault ? <Badge tone="info">Default</Badge> : null}
                {c.status === 'inactive' ? <Badge tone="neutral">Off</Badge> : null}
                {canEdit ? (
                  <span className="ep-as__catacts">
                    <button
                      type="button"
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      aria-label={`Move ${c.name} up`}
                      disabled={i === 0}
                      onClick={() =>
                        setCats((cur) => {
                          const n = [...cur];
                          [n[i - 1], n[i]] = [n[i]!, n[i - 1]!];
                          return n;
                        })
                      }
                    >
                      Up
                    </button>
                    {!c.isDefault ? (
                      <button
                        type="button"
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        onClick={() =>
                          setCats((cur) => cur.map((x, j) => ({ ...x, isDefault: j === i })))
                        }
                      >
                        Make default
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      onClick={() =>
                        setCat(i, { status: c.status === 'active' ? 'inactive' : 'active' })
                      }
                    >
                      {c.status === 'active' ? 'Switch off' : 'Switch on'}
                    </button>
                  </span>
                ) : null}
              </div>
              {c.isDefault ? (
                <p className="ep-field__help">Everyone who matches no other category.</p>
              ) : (
                <div className="ep-as__conds">
                  <span className="ep-field__help">When</span>
                  <select
                    className="ep-select ep-as__logic"
                    aria-label="All or any"
                    disabled={!canEdit}
                    value={c.logic}
                    onChange={(e) => setCat(i, { logic: e.target.value as 'all' | 'any' })}
                  >
                    <option value="any">any of these holds</option>
                    <option value="all">all of these hold</option>
                  </select>
                  {c.conditions.map((k, m) => (
                    <div key={m} className="ep-fb__cond">
                      <input
                        className="ep-input"
                        list={fieldList}
                        aria-label="Form field (key)"
                        disabled={!canEdit}
                        value={k.field}
                        onChange={(e) =>
                          setCond(i, m, {
                            field: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''),
                          })
                        }
                      />
                      <span className="ep-field__help ep-as__lbl">{label(k.field)}</span>
                      <select
                        className="ep-select"
                        aria-label="Condition"
                        disabled={!canEdit}
                        value={k.op}
                        onChange={(e) =>
                          setCond(i, m, { op: e.target.value as AdmissionCondition['op'] })
                        }
                      >
                        {RULE_OPS.map((o) => (
                          <option key={o} value={o}>
                            {OP[o]}
                          </option>
                        ))}
                      </select>
                      {k.op !== 'empty' && k.op !== 'not_empty' ? (
                        <input
                          className="ep-input"
                          aria-label="Value"
                          disabled={!canEdit}
                          value={k.value ?? ''}
                          onChange={(e) => setCond(i, m, { value: e.target.value })}
                        />
                      ) : null}
                      {canEdit ? (
                        <button
                          type="button"
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                          onClick={() =>
                            setCat(i, { conditions: c.conditions.filter((_, x) => x !== m) })
                          }
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {canEdit ? (
                    <button
                      type="button"
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      onClick={() =>
                        setCat(i, {
                          conditions: [
                            ...c.conditions,
                            { field: formFields[0]?.key ?? '', op: 'eq', value: 'Yes' },
                          ],
                        })
                      }
                    >
                      Add a condition
                    </button>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ol>
        {msg?.where === 'cats' ? (
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
                setCats((cur) => [
                  ...cur,
                  {
                    key: `n${String(Date.now())}`,
                    code: `category_${String(cur.length + 1)}`,
                    name: 'New category',
                    logic: 'any',
                    conditions: [],
                    isDefault: false,
                    status: 'active',
                  },
                ])
              }
            >
              Add a category
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await saveFeeCategories(cats.map(({ key: _k, ...x }) => x));
                  if (r.ok) {
                    setCats(r.data.map((c) => ({ ...c, key: c.id })));
                    setMsg({ tone: 'success', text: 'Categories saved.', where: 'cats' });
                  } else setMsg({ tone: 'danger', text: r.error, where: 'cats' });
                })
              }
            >
              Save categories
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
