'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { ProfileField } from './ProfileField';
import {
  applies,
  type ProfileCatalogue,
  type ProfileSnapshot,
  type ProfileValues,
  type SaveProfileResult,
} from '@/lib/profile';

/**
 * The full student profile editor: one tab per section of the data collection sheet, fields that
 * appear only when they apply, completeness with jump links to what is missing, and a save that
 * sends only the fields that changed. Errors come back per field.
 */
export function ProfileEditor({
  catalogue,
  snapshot,
  canEdit,
  save,
  initialTab,
}: {
  catalogue: ProfileCatalogue;
  snapshot: ProfileSnapshot;
  canEdit: boolean;
  save: (id: string, values: ProfileValues) => Promise<SaveProfileResult>;
  initialTab?: string;
}) {
  const router = useRouter();
  const [base, setBase] = useState<ProfileSnapshot>(snapshot);
  const [values, setValues] = useState<ProfileValues>(snapshot.values);
  const [tab, setTab] = useState(initialTab ?? catalogue.sections[0]!.id);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, start] = useTransition();

  const fieldsBySection = useMemo(() => {
    const m = new Map<string, typeof catalogue.fields>();
    for (const f of catalogue.fields) m.set(f.section, [...(m.get(f.section) ?? []), f]);
    return m;
  }, [catalogue]);
  const changed = useMemo(
    () =>
      catalogue.fields
        .filter((f) => !f.readOnly)
        .filter((f) => (values[f.key] ?? null) !== (base.values[f.key] ?? null))
        .map((f) => f.key),
    [catalogue, values, base],
  );
  const missing = useMemo(
    () =>
      catalogue.fields.filter(
        (f) =>
          f.required &&
          f.type !== 'auto' &&
          applies(f, values) &&
          (values[f.key] === null || values[f.key] === undefined || values[f.key] === ''),
      ),
    [catalogue, values],
  );
  const requiredCount = catalogue.fields.filter(
    (f) => f.required && f.type !== 'auto' && applies(f, values),
  ).length;
  const percent = requiredCount
    ? Math.round(((requiredCount - missing.length) / requiredCount) * 100)
    : 100;

  useEffect(() => {
    if (!changed.length) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
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
      const r = await save(base.studentId, payload);
      if (r.ok) {
        setBase(r.snapshot);
        setValues(r.snapshot.values);
        setErrors({});
        setNotice({
          tone: 'success',
          text: `Saved ${String(changed.length)} change${changed.length === 1 ? '' : 's'}.`,
        });
        router.refresh();
      } else {
        setErrors(r.errors);
        setNotice({
          tone: 'danger',
          text: `${r.detail}. ${String(Object.keys(r.errors).length)} field(s) need attention.`,
        });
        const first = Object.keys(r.errors)[0];
        if (first) jumpTo(first);
      }
    });
  };

  const sectionMissing = (id: string) => missing.filter((f) => f.section === id).length;
  const sectionErrors = (id: string) =>
    (fieldsBySection.get(id) ?? []).filter((f) => errors[f.key]).length;

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
          <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
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
                setValues(base.values);
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
            const miss = sectionMissing(s.id);
            const errs = sectionErrors(s.id);
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
          <div className="ep-profile__grid">
            {(fieldsBySection.get(s.id) ?? [])
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
