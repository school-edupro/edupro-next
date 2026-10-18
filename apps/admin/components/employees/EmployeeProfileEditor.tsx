'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { ProfileField } from '@/components/ProfileField';
import {
  forForm,
  type EmployeeCatalogue,
  type EmployeeProfile,
  type SaveEmployeeResult,
} from '@/lib/employee';
import { applies, type ProfileValues } from '@/lib/profile';

/**
 * The employee profile (docs/design/30-employee-master.md): a tab per section, the same field boxes as
 * the student profile (lists to type into, the address cascade, masked IDs replaced only when retyped),
 * completeness with a jump to what is missing, and a save that sends only what changed.
 */
export function EmployeeProfileEditor({
  catalogue,
  profile,
  canEdit,
  save,
}: {
  catalogue: EmployeeCatalogue;
  profile: EmployeeProfile;
  canEdit: boolean;
  save: (id: string, values: ProfileValues) => Promise<SaveEmployeeResult>;
}) {
  const router = useRouter();
  const [base, setBase] = useState<EmployeeProfile>(profile);
  const baseValues = useMemo(() => forForm(base), [base]);
  const [values, setValues] = useState<ProfileValues>(baseValues);
  const [tab, setTab] = useState(catalogue.sections[0]!.id);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, start] = useTransition();

  const bySection = useMemo(() => {
    const m = new Map<string, typeof catalogue.fields>();
    for (const f of catalogue.fields) m.set(f.section, [...(m.get(f.section) ?? []), f]);
    return m;
  }, [catalogue]);
  const changed = useMemo(
    () =>
      catalogue.fields
        .filter((f) => !f.readOnly)
        .filter((f) => (values[f.key] ?? null) !== (baseValues[f.key] ?? null))
        .map((f) => f.key),
    [catalogue, values, baseValues],
  );
  const missing = useMemo(
    () =>
      catalogue.fields.filter(
        (f) =>
          f.required &&
          !f.readOnly &&
          applies(f, values) &&
          (values[f.key] === null || values[f.key] === undefined || values[f.key] === ''),
      ),
    [catalogue, values],
  );
  const required = catalogue.fields.filter((f) => f.required && !f.readOnly && applies(f, values));
  const percent = required.length
    ? Math.round(((required.length - missing.length) / required.length) * 100)
    : 100;

  useEffect(() => {
    if (!changed.length) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changed.length]);

  const onChange = (key: string, v: string | null) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };
  const jumpTo = (key: string) => {
    const f = catalogue.fields.find((x) => x.key === key);
    if (!f) return;
    setTab(f.section);
    setTimeout(() => document.getElementById(`pf-${key}`)?.focus(), 30);
  };
  const onSave = () => {
    const payload: ProfileValues = {};
    for (const k of changed) payload[k] = values[k] ?? null;
    start(async () => {
      const r = await save(base.id, payload);
      if (r.ok) {
        setBase(r.profile);
        setValues(forForm(r.profile));
        setErrors({});
        setNotice({
          tone: 'success',
          text: `Saved ${String(changed.length)} change${changed.length === 1 ? '' : 's'}.`,
        });
        router.refresh();
      } else {
        setErrors(r.errors);
        setNotice({ tone: 'danger', text: r.detail });
        const first = Object.keys(r.errors)[0];
        if (first) jumpTo(first);
      }
    });
  };

  return (
    <div className="ep-profile">
      <div className="ep-profile__bar" role="region" aria-label="Profile status">
        <div className="ep-profile__meter">
          <span>
            Profile <strong>{percent}%</strong> complete
          </span>
          <progress max={100} value={percent} aria-label={`Profile ${String(percent)}% complete`} />
          {missing.length ? (
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              onClick={() => jumpTo(missing[0]!.key)}
            >
              {missing.length} required field{missing.length === 1 ? '' : 's'} missing: go to first
            </button>
          ) : null}
        </div>
        {canEdit ? (
          <div
            style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap' }}
          >
            <span className="ep-field__help" aria-live="polite">
              {changed.length
                ? `${String(changed.length)} unsaved change${changed.length === 1 ? '' : 's'}`
                : 'No unsaved changes'}
            </span>
            <button
              type="button"
              className="ep-btn ep-btn--ghost"
              disabled={!changed.length || pending}
              onClick={() => {
                setValues(baseValues);
                setErrors({});
              }}
            >
              Discard
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              disabled={!changed.length || pending}
              onClick={onSave}
            >
              {pending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        ) : null}
      </div>
      {notice ? (
        <div
          className={`ep-alert ep-alert--${notice.tone}`}
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {notice.text}
        </div>
      ) : null}
      <div className="ep-tabs">
        <div
          role="tablist"
          aria-label="Profile sections"
          className="ep-tabs__list ep-profile__tabs"
        >
          {catalogue.sections.map((s) => {
            const miss = missing.filter((f) => f.section === s.id).length;
            const errs = (bySection.get(s.id) ?? []).filter((f) => errors[f.key]).length;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                id={`tab-${s.id}`}
                aria-selected={tab === s.id}
                aria-controls={`panel-${s.id}`}
                className="ep-tabs__tab"
                onClick={() => setTab(s.id)}
              >
                {s.title}
                {errs ? (
                  <span className="ep-badge ep-badge--danger" style={{ marginLeft: 'var(--sp-1)' }}>
                    {errs}
                  </span>
                ) : miss ? (
                  <span
                    className="ep-badge ep-badge--warning"
                    style={{ marginLeft: 'var(--sp-1)' }}
                    title={`${String(miss)} required missing`}
                  >
                    {miss}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
      {catalogue.sections.map((s) => (
        <section
          key={s.id}
          role="tabpanel"
          id={`panel-${s.id}`}
          aria-labelledby={`tab-${s.id}`}
          hidden={tab !== s.id}
          className="ep-card"
          style={{ padding: 'var(--sp-4)' }}
        >
          {s.id === 'govt_ids' || s.id === 'bank' ? (
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              {base.sensitiveShown
                ? 'Aadhaar, PAN and the account number are stored encrypted.'
                : 'Aadhaar, PAN and the account number are stored encrypted and shown masked; type a new number to replace one.'}
            </p>
          ) : null}
          <div className="ep-profile__grid">
            {(bySection.get(s.id) ?? [])
              .filter((f) => applies(f, values))
              .map((f) => (
                <ProfileField
                  key={f.key}
                  field={f}
                  values={values}
                  geography={catalogue.geography}
                  error={errors[f.key]}
                  masked={
                    base.masked.includes(f.key) && values[f.key] !== null
                      ? String(base.values[f.key] ?? '')
                      : null
                  }
                  disabled={!canEdit}
                  onChange={onChange}
                />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
