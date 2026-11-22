'use client';
import { Badge, Button, Switch } from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { ChipPicker } from '@/components/ChipPicker';
import {
  anchorOf,
  valueText,
  type Choice,
  type SettingField,
  type SettingRow,
} from '@/lib/settings-sections';
import { saveSettings } from '../actions';

type Row = Record<string, unknown>;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** What a field's editor holds for a value: text for numbers, JSON and line lists; a copy of rows; else the value. */
function toEdit(f: SettingField, v: unknown): unknown {
  switch (f.control.kind) {
    case 'json':
      return JSON.stringify(v ?? null, null, 2);
    case 'lines':
      return Array.isArray(v) ? v.map(String).join('\n') : '';
    case 'number':
    case 'money':
      return v == null ? '' : String(v);
    case 'rows':
      return Array.isArray(v) ? v.map((r) => ({ ...(r as Row) })) : [];
    case 'window': {
      const w = (v ?? {}) as { start?: string; end?: string };
      return { start: w.start ?? '', end: w.end ?? '' };
    }
    case 'multi':
      return Array.isArray(v) ? [...(v as unknown[])] : [];
    default:
      return v ?? '';
  }
}

/** The value to save from what the editor holds, or what is wrong with it. */
function fromEdit(f: SettingField, e: unknown): { value?: unknown; error?: string } {
  const c = f.control;
  switch (c.kind) {
    case 'json':
      try {
        return { value: JSON.parse(String(e)) };
      } catch {
        return { error: 'Not valid JSON: check the brackets, commas and quotes.' };
      }
    case 'lines':
      return {
        value: String(e)
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
      };
    case 'number': {
      const s = String(e).trim();
      const n = Number(s);
      if (!s || !Number.isFinite(n)) return { error: 'Enter a number.' };
      if (c.step === undefined && !Number.isInteger(n)) return { error: 'Enter a whole number.' };
      if (c.min !== undefined && n < c.min) return { error: `At least ${String(c.min)}.` };
      if (c.max !== undefined && n > c.max) return { error: `At most ${String(c.max)}.` };
      return { value: n };
    }
    case 'money': {
      const s = String(e).trim();
      return /^\d+(\.\d{1,2})?$/.test(s)
        ? { value: s }
        : { error: 'An amount, e.g. 250 or 250.50.' };
    }
    case 'time':
      return /^\d{2}:\d{2}$/.test(String(e)) ? { value: e } : { error: 'Choose a time.' };
    case 'window': {
      const w = e as { start: string; end: string };
      if (!w.start || !w.end) return { error: 'Choose both times.' };
      if (w.start >= w.end) return { error: 'The end comes after the start.' };
      return { value: w };
    }
    case 'multi': {
      const a = e as unknown[];
      if (c.min && a.length < c.min) return { error: `Choose at least ${String(c.min)}.` };
      // in the order of the choices
      return { value: c.choices.map((x) => x.value).filter((v) => a.includes(v)) };
    }
    case 'csv':
    case 'roles':
      return String(e) ? { value: String(e) } : { error: 'Choose at least one.' };
    case 'rows': {
      const rows = e as Row[];
      const out: Row[] = [];
      for (const r of rows) {
        const row: Row = {};
        for (const col of c.columns) {
          const v = r[col.key];
          if (col.type === 'number') {
            const n = Number(v);
            if (v === '' || v == null || !Number.isFinite(n))
              return { error: `${col.label}: a number in every row.` };
            row[col.key] = n;
          } else row[col.key] = String(v ?? '').trim();
        }
        if (
          c.columns.some((col) => col.type !== 'number' && col.key !== 'category' && !row[col.key])
        )
          return { error: 'Fill every cell, or remove the row.' };
        out.push(row);
      }
      return { value: out };
    }
    case 'text':
      return { value: String(e ?? '').trim() };
    case 'email': {
      const s = String(e ?? '').trim();
      return !s || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
        ? { value: s }
        : { error: 'An e-mail address, or empty.' };
    }
    default:
      return { value: e };
  }
}

/** A setting's editor. */
function Control({
  f,
  id,
  edit,
  set,
  roles,
  disabled,
  described,
}: {
  f: SettingField;
  id: string;
  edit: unknown;
  set: (next: unknown) => void;
  roles: Choice[];
  disabled: boolean;
  described: string;
}) {
  const c = f.control;
  switch (c.kind) {
    case 'switch':
    case 'onoff': {
      const on = c.kind === 'switch' ? edit === true : edit === 'on';
      return (
        <Switch
          id={id}
          label={on ? 'On' : 'Off'}
          checked={on}
          disabled={disabled}
          aria-label={f.label}
          aria-describedby={described}
          onChange={(v) => set(c.kind === 'switch' ? v : v ? 'on' : 'off')}
        />
      );
    }
    case 'choice':
      if (c.choices.length <= 4)
        return (
          <fieldset className="ep-setform__choices" aria-describedby={described}>
            <legend className="ep-sr-only">{f.label}</legend>
            {c.choices.map((o) => (
              <label key={String(o.value)} className="ep-check">
                <input
                  type="radio"
                  name={id}
                  checked={edit === o.value}
                  disabled={disabled}
                  onChange={() => set(o.value)}
                />
                <span className="ep-check__text">{o.label}</span>
              </label>
            ))}
          </fieldset>
        );
      return (
        <select
          id={id}
          className="ep-select"
          aria-label={f.label}
          value={String(edit)}
          disabled={disabled}
          aria-describedby={described}
          onChange={(e) => {
            const hit = c.choices.find((o) => String(o.value) === e.target.value);
            set(hit ? hit.value : e.target.value);
          }}
        >
          {c.choices.map((o) => (
            <option key={String(o.value)} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case 'multi':
    case 'csv': {
      const chosen: unknown[] =
        c.kind === 'multi' ? (edit as unknown[]) : String(edit).split(',').filter(Boolean);
      const toggle = (v: string | number, on: boolean) => {
        const next = on ? [...chosen, v] : chosen.filter((x) => x !== v);
        const ordered = c.choices.map((x) => x.value).filter((x) => next.includes(x));
        set(c.kind === 'multi' ? ordered : ordered.join(','));
      };
      return (
        <fieldset className="ep-setform__choices" aria-describedby={described}>
          <legend className="ep-sr-only">{f.label}</legend>
          {c.choices.map((o) => (
            <label key={String(o.value)} className="ep-check">
              <input
                type="checkbox"
                checked={chosen.includes(o.value)}
                disabled={disabled}
                onChange={(e) => toggle(o.value, e.target.checked)}
              />
              <span className="ep-check__text">{o.label}</span>
            </label>
          ))}
        </fieldset>
      );
    }
    case 'roles': {
      const codes = String(edit).split(',').filter(Boolean);
      const options = [
        ...roles,
        // a code the role list does not have (or no list could be read): still shown
        ...codes
          .filter((x) => !roles.some((r) => r.value === x))
          .map((x) => ({ value: x, label: x })),
      ].map((o) => ({ value: String(o.value), label: o.label }));
      return disabled ? (
        <span>{codes.map((x) => options.find((o) => o.value === x)?.label ?? x).join(', ')}</span>
      ) : (
        <ChipPicker
          label={f.label}
          options={options}
          value={codes}
          onChange={(next) => set(next.join(','))}
          hideLabel
        />
      );
    }
    case 'number':
    case 'money':
      return (
        <span className="ep-setform__unit">
          {c.kind === 'money' ? <span aria-hidden="true">₹</span> : null}
          <input
            id={id}
            className="ep-input"
            inputMode="decimal"
            type={c.kind === 'number' ? 'number' : 'text'}
            min={c.kind === 'number' ? c.min : undefined}
            max={c.kind === 'number' ? c.max : undefined}
            step={c.kind === 'number' ? (c.step ?? 1) : undefined}
            value={String(edit)}
            disabled={disabled}
            aria-describedby={described}
            onChange={(e) => set(e.target.value)}
          />
          {c.kind === 'number' && c.unit ? <span>{c.unit}</span> : null}
        </span>
      );
    case 'time':
      return (
        <input
          id={id}
          type="time"
          className="ep-input"
          style={{ maxWidth: '10rem' }}
          value={String(edit)}
          disabled={disabled}
          aria-describedby={described}
          onChange={(e) => set(e.target.value)}
        />
      );
    case 'window': {
      const w = edit as { start: string; end: string };
      return (
        <span
          className="ep-setform__unit"
          role="group"
          aria-label={f.label}
          aria-describedby={described}
        >
          <label htmlFor={`${id}-start`}>From</label>
          <input
            id={`${id}-start`}
            type="time"
            className="ep-input"
            value={w.start}
            disabled={disabled}
            onChange={(e) => set({ ...w, start: e.target.value })}
          />
          <label htmlFor={`${id}-end`}>to</label>
          <input
            id={`${id}-end`}
            type="time"
            className="ep-input"
            value={w.end}
            disabled={disabled}
            onChange={(e) => set({ ...w, end: e.target.value })}
          />
        </span>
      );
    }
    case 'date':
      return (
        <span className="ep-setform__unit">
          <input
            id={id}
            type="date"
            className="ep-input"
            value={String(edit)}
            disabled={disabled}
            aria-describedby={described}
            onChange={(e) => set(e.target.value)}
          />
          {edit && !disabled ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => set('')}>
              Clear
            </Button>
          ) : null}
        </span>
      );
    case 'rows': {
      const rows = edit as Row[];
      const setCell = (i: number, k: string, v: unknown) =>
        set(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
      return (
        <div>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={f.label}>
            <table className="ep-table">
              <thead>
                <tr>
                  {c.columns.map((col) => (
                    <th key={col.key} scope="col">
                      {col.label}
                    </th>
                  ))}
                  <th scope="col">
                    <span className="ep-sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  // rows have no id of their own: their place is their key
                  <tr key={i}>
                    {c.columns.map((col) => (
                      <td key={col.key}>
                        <input
                          className="ep-input"
                          type={col.type === 'text' ? 'text' : col.type}
                          value={String(r[col.key] ?? '')}
                          disabled={disabled}
                          aria-label={`${col.label}, row ${String(i + 1)}`}
                          onChange={(e) => setCell(i, col.key, e.target.value)}
                        />
                      </td>
                    ))}
                    <td>
                      {disabled ? null : (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={`Remove row ${String(i + 1)}`}
                          onClick={() => set(rows.filter((_, j) => j !== i))}
                        >
                          Remove
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {disabled ? null : (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              style={{ marginTop: 'var(--sp-2)' }}
              onClick={() =>
                set([...rows, Object.fromEntries(c.columns.map((col) => [col.key, '']))])
              }
            >
              Add a row
            </Button>
          )}
        </div>
      );
    }
    case 'lines':
    case 'textarea':
    case 'json':
      return (
        <textarea
          id={id}
          className="ep-input"
          rows={c.kind === 'json' ? 8 : 4}
          maxLength={c.kind === 'textarea' ? c.maxLength : undefined}
          placeholder={c.kind === 'lines' ? c.placeholder : undefined}
          spellCheck={c.kind !== 'json'}
          style={
            c.kind === 'json'
              ? { fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-small)' }
              : undefined
          }
          value={String(edit)}
          disabled={disabled}
          aria-describedby={described}
          onChange={(e) => set(e.target.value)}
        />
      );
    default: {
      const t = c as {
        kind: 'text' | 'email';
        upper?: boolean;
        maxLength?: number;
        placeholder?: string;
      };
      return (
        <input
          id={id}
          type={t.kind === 'email' ? 'email' : 'text'}
          className="ep-input"
          value={String(edit)}
          maxLength={t.maxLength}
          placeholder={t.placeholder}
          disabled={disabled}
          aria-describedby={described}
          style={t.upper ? { textTransform: 'uppercase', maxWidth: '12rem' } : undefined}
          onChange={(e) => set(t.upper ? e.target.value.toUpperCase() : e.target.value)}
        />
      );
    }
  }
}

const tomorrow = () => {
  const d = new Date(Date.now() + 86_400_000);
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * An area's settings (docs/design/95): each with its plain name, help, editor and how it stands (standard, set
 * since, changed); Use the standard value; one Save for the changes, from today or a later date. Leaving with
 * changes not saved asks first.
 */
export function SettingsForm({
  sectionTitle,
  advanced,
  fields,
  rows: initialRows,
  roles,
  canEdit,
}: {
  sectionTitle: string;
  advanced: boolean;
  fields: SettingField[];
  rows: SettingRow[];
  roles: Choice[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const start = () =>
    Object.fromEntries(fields.map((f) => [f.setting, toEdit(f, byKey.get(f.setting)?.value)]));
  const [edits, setEdits] = useState<Record<string, unknown>>(start);
  const [later, setLater] = useState(false);
  const [from, setFrom] = useState(tomorrow());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [busy, startSave] = useTransition();

  const changed = fields.filter(
    (f) => !same(edits[f.setting], toEdit(f, byKey.get(f.setting)?.value)),
  );
  const problems = Object.fromEntries(
    changed
      .map((f) => [f.setting, fromEdit(f, edits[f.setting]).error] as const)
      .filter(([, e]) => !!e),
  ) as Record<string, string>;
  const dirty = changed.length > 0;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = (key: string) => (next: unknown) => {
    setMsg(null);
    setServerErrors((x) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== key)));
    setEdits((x) => ({ ...x, [key]: next }));
  };

  const save = () =>
    startSave(async () => {
      const values = Object.fromEntries(
        changed.map((f) => [f.setting, fromEdit(f, edits[f.setting]).value]),
      );
      const r = await saveSettings(values, later ? from : null);
      if (r.ok) {
        setRows(r.rows);
        const fresh = new Map(r.rows.map((x) => [x.key, x]));
        setEdits(
          Object.fromEntries(
            fields.map((f) => [f.setting, toEdit(f, fresh.get(f.setting)?.value)]),
          ),
        );
        setServerErrors({});
        setMsg({
          ok: true,
          text: later
            ? `Saved ${String(changed.length)} ${changed.length === 1 ? 'change' : 'changes'} from ${from}; until then the values below stay.`
            : `Saved ${String(changed.length)} ${changed.length === 1 ? 'change' : 'changes'}; they apply from today.`,
        });
        setLater(false);
        router.refresh();
        return;
      }
      const errs: Record<string, string> = {};
      for (const e of r.errors) {
        const f = fields.find((x) => e.path === x.setting || e.path.startsWith(`${x.setting}.`));
        if (f) errs[f.setting] = errs[f.setting] ? `${errs[f.setting]} ${e.message}` : e.message;
      }
      setServerErrors(errs);
      setMsg({ ok: false, text: `${r.error} Nothing was saved.` });
    });

  return (
    <form
      className="ep-card"
      aria-label={`${sectionTitle} settings`}
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && !Object.keys(problems).length) save();
      }}
    >
      {msg ? (
        <p
          className={`ep-alert ${msg.ok ? 'ep-alert--success' : 'ep-alert--danger'}`}
          role={msg.ok ? 'status' : 'alert'}
          data-testid="set-msg"
        >
          {msg.text}
        </p>
      ) : null}
      {fields.map((f) => {
        const key = f.setting;
        const row = byKey.get(key);
        const id = `${anchorOf(key)}-input`;
        const isChanged = changed.includes(f);
        const parsed = fromEdit(f, edits[key]);
        const atStandard = row
          ? same(parsed.value, row.default) || same(edits[key], toEdit(f, row.default))
          : true;
        const error = (isChanged ? problems[key] : undefined) ?? serverErrors[key];
        const helpId = `${anchorOf(key)}-help`;
        const labelled = f.control.kind !== 'switch' && f.control.kind !== 'onoff';
        return (
          <div key={key} id={anchorOf(key)} className="ep-setform__row" data-testid="set-row">
            <div>
              {labelled &&
              !['choice', 'multi', 'csv', 'rows', 'window', 'roles'].includes(f.control.kind) ? (
                <label htmlFor={id} className="ep-field__label" style={{ marginBottom: 0 }}>
                  {f.label}
                </label>
              ) : (
                <span className="ep-field__label" style={{ display: 'block', marginBottom: 0 }}>
                  {f.label}
                </span>
              )}
              <span id={helpId} className="ep-field__help" style={{ display: 'block', margin: 0 }}>
                {f.help}
              </span>
              {advanced ? (
                <code style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)' }}>
                  {key}
                </code>
              ) : null}
            </div>
            <div className="ep-setform__control">
              <Control
                f={f}
                id={id}
                edit={edits[key]}
                set={set(key)}
                roles={roles}
                disabled={!canEdit || busy}
                described={helpId}
              />
              {error ? (
                <span className="ep-field__error" role="alert">
                  {error}
                </span>
              ) : null}
              <span className="ep-setform__status">
                {isChanged ? (
                  <Badge tone="warning">Changed, not saved</Badge>
                ) : row?.isDefault ? (
                  <Badge tone="neutral">Standard</Badge>
                ) : (
                  <span>{row?.validFrom ? `Set from ${row.validFrom}` : 'Set'}</span>
                )}
                {!atStandard && row ? (
                  <>
                    {['json', 'rows', 'lines'].includes(f.control.kind) ? null : (
                      <span>{`Standard: ${valueText(f, row.default)}`}</span>
                    )}
                    {canEdit ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => set(key)(toEdit(f, row.default))}
                      >
                        Use the standard value
                      </Button>
                    ) : null}
                  </>
                ) : null}
              </span>
            </div>
          </div>
        );
      })}
      {canEdit ? (
        <div
          className={`ep-setform__bar${dirty ? ' ep-setform__bar--sticky' : ''}`}
          data-testid="set-bar"
        >
          <span role="status" aria-live="polite">
            {dirty
              ? `${String(changed.length)} ${changed.length === 1 ? 'change' : 'changes'} not saved`
              : 'No changes'}
          </span>
          <span
            style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'center' }}
          >
            <label className="ep-check">
              <input
                type="checkbox"
                checked={later}
                disabled={!dirty || busy}
                onChange={(e) => setLater(e.target.checked)}
              />
              <span className="ep-check__text">From a later date</span>
            </label>
            {later ? (
              <input
                type="date"
                className="ep-input"
                aria-label="Applies from"
                min={tomorrow()}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            ) : null}
            <Button
              type="button"
              variant="ghost"
              disabled={!dirty || busy}
              onClick={() => {
                setEdits(start());
                setServerErrors({});
                setMsg(null);
              }}
            >
              Undo changes
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!dirty || busy || Object.keys(problems).length > 0 || (later && !from)}
              data-testid="set-save"
            >
              {busy ? 'Saving…' : 'Save changes'}
            </Button>
          </span>
        </div>
      ) : null}
    </form>
  );
}
