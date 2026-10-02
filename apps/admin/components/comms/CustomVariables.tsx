'use client';
import { useState } from 'react';
import { deleteCustomVariable, saveCustomVariable } from '@/lib/comms-actions';

export interface CustomVariable {
  key: string;
  label: string;
  value: string;
  updatedAt: string;
}

const keyOf = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^([0-9])/, 'v_$1')
    .slice(0, 40);

/**
 * School variables: fixed values the school sets once and every template can use, e.g.
 * {{principal_name}}, {{school_phone}}, {{fee_pay_link}}. Changing a value changes every message
 * sent afterwards.
 */
export function CustomVariables({
  initial,
  canManage,
}: {
  initial: CustomVariable[];
  canManage: boolean;
}) {
  const [rows, setRows] = useState(initial);
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [touched, setTouched] = useState(false);
  const [value, setValue] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async (v: { key: string; label: string; value: string }) => {
    const r = await saveCustomVariable(v);
    if (!r.ok) {
      setMsg({ ok: false, text: [r.error, ...(r.errors ?? [])].join(' · ') });
      return false;
    }
    setRows((list) =>
      [...list.filter((x) => x.key !== v.key), { ...v, updatedAt: new Date().toISOString() }].sort(
        (a, b) => a.key.localeCompare(b.key),
      ),
    );
    setMsg({ ok: true, text: `Saved {{${v.key}}}.` });
    return true;
  };
  return (
    <div className="ep-grp">
      {msg ? (
        <p
          className={msg.ok ? 'ep-alert ep-alert--success' : 'ep-alert ep-alert--danger'}
          role={msg.ok ? 'status' : 'alert'}
        >
          {msg.text}
        </p>
      ) : null}
      {rows.length ? (
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="School variables">
          <table className="ep-table">
            <caption className="ep-sr-only">School variables</caption>
            <thead>
              <tr>
                <th scope="col">Variable</th>
                <th scope="col">Name</th>
                <th scope="col">Value</th>
                {canManage ? (
                  <th scope="col">
                    <span className="ep-sr-only">Actions</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>
                    <code>{`{{${r.key}}}`}</code>
                  </td>
                  <td>{r.label}</td>
                  <td>
                    {canManage ? (
                      <input
                        className="ep-input"
                        aria-label={`Value of ${r.label}`}
                        defaultValue={r.value}
                        maxLength={500}
                        onBlur={(e) => {
                          if (e.target.value !== r.value)
                            void save({ key: r.key, label: r.label, value: e.target.value });
                        }}
                      />
                    ) : (
                      r.value
                    )}
                  </td>
                  {canManage ? (
                    <td>
                      <button
                        type="button"
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        aria-label={`Delete {{${r.key}}}`}
                        onClick={async () => {
                          if (
                            !window.confirm(
                              `Delete {{${r.key}}}? Templates that use it will leave it empty.`,
                            )
                          )
                            return;
                          const res = await deleteCustomVariable(r.key);
                          if (res.ok) setRows(rows.filter((x) => x.key !== r.key));
                          else setMsg({ ok: false, text: res.error });
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="ep-field__help">No school variables yet.</p>
      )}
      {canManage ? (
        <form
          className="ep-wd__form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await save({ key: key || keyOf(label), label, value })) {
              setLabel('');
              setKey('');
              setValue('');
              setTouched(false);
            }
          }}
        >
          <label className="ep-field" htmlFor="cv-label">
            <span className="ep-field__label">Name *</span>
            <input
              id="cv-label"
              className="ep-input"
              required
              minLength={2}
              maxLength={80}
              value={label}
              placeholder="e.g. Principal name"
              onChange={(e) => {
                setLabel(e.target.value);
                if (!touched) setKey(keyOf(e.target.value));
              }}
            />
          </label>
          <label className="ep-field" htmlFor="cv-key">
            <span className="ep-field__label">Variable *</span>
            <input
              id="cv-key"
              className="ep-input"
              required
              pattern="[a-z][a-z0-9_]{1,39}"
              value={key}
              onChange={(e) => {
                setKey(e.target.value.toLowerCase());
                setTouched(true);
              }}
            />
          </label>
          <label className="ep-field ep-wd__wide" htmlFor="cv-value">
            <span className="ep-field__label">Value</span>
            <input
              id="cv-value"
              className="ep-input"
              maxLength={500}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="e.g. Dr. A. K. Mehta"
            />
          </label>
          <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
            Add variable
          </button>
        </form>
      ) : null}
      <div className="ep-card ep-cv__help">
        <h2 className="ep-card__title">Other ways to use a new variable</h2>
        <ul>
          <li>
            <strong>Ask when sending:</strong> write any new name in a template, e.g.{' '}
            <code>{'{{ptm_date}}'}</code>. Compose asks for its value once, the same for everyone.
          </li>
          <li>
            <strong>Excel list:</strong> extra columns in an uploaded list become variables for each
            row, e.g. a column “Amount” is <code>{'{{amount}}'}</code>.
          </li>
          <li>
            <strong>Computed for each student:</strong> <code>{'{{fee_due_heads}}'}</code>,{' '}
            <code>{'{{last_paid_date}}'}</code>, <code>{'{{attendance_percent}}'}</code>,{' '}
            <code>{'{{absent_days}}'}</code>, <code>{'{{last_exam_percent}}'}</code> and more in the
            variable picker.
          </li>
        </ul>
      </div>
    </div>
  );
}
