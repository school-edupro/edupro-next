'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createSlot, deleteSlot, updateSlot } from '@/lib/admission-process-actions';

/** A test / interview slot: stage, class (or every class), date and time, minutes, venue, capacity. */
export function SlotForm({
  cycleId,
  stages,
  classes,
  slot,
}: {
  cycleId: string;
  stages: Array<{ id: string; name: string }>;
  classes: Array<{ id: string; name: string }>;
  slot?: {
    id: string;
    stageId: string;
    classId: string | null;
    startsAt: string;
    minutes: number;
    venue: string;
    capacity: number;
    notes: string | null;
    allotted: number;
  };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const local = (iso: string) => {
    const d = new Date(new Date(iso).getTime() + 330 * 60_000);
    return d.toISOString().slice(0, 16);
  };
  const [v, setV] = useState({
    stageId: slot?.stageId ?? stages[0]?.id ?? '',
    classId: slot?.classId ?? '',
    startsAt: slot ? local(slot.startsAt) : '',
    minutes: String(slot?.minutes ?? 60),
    venue: slot?.venue ?? '',
    capacity: String(slot?.capacity ?? 30),
    notes: slot?.notes ?? '',
  });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV({ ...v, [k]: e.target.value });
  const save = () =>
    start(async () => {
      setError(null);
      if (!v.startsAt || !v.venue.trim()) return setError('Give the date, time and venue.');
      const body = {
        stageId: v.stageId,
        classId: v.classId || null,
        startsAt: `${v.startsAt}:00+05:30`,
        minutes: Number(v.minutes) || 60,
        venue: v.venue.trim(),
        capacity: Number(v.capacity) || 1,
        notes: v.notes.trim() || null,
      };
      const r = slot ? await updateSlot(slot.id, body) : await createSlot(cycleId, body);
      if (!r.ok) return setError(r.error);
      if (slot) router.refresh();
      else router.push(`/admissions/schedule/${r.data.id}`);
    });
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
          gap: 'var(--sp-3)',
        }}
      >
        <label className="ep-field">
          <span className="ep-field__label">Stage</span>
          <select
            className="ep-select"
            value={v.stageId}
            onChange={set('stageId')}
            disabled={Boolean(slot?.allotted)}
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Class</span>
          <select className="ep-select" value={v.classId} onChange={set('classId')}>
            <option value="">Every class</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Date and time</span>
          <input
            className="ep-input"
            type="datetime-local"
            value={v.startsAt}
            onChange={set('startsAt')}
          />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Minutes</span>
          <input
            className="ep-input"
            type="number"
            min={5}
            max={600}
            value={v.minutes}
            onChange={set('minutes')}
          />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Venue</span>
          <input className="ep-input" maxLength={160} value={v.venue} onChange={set('venue')} />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Capacity</span>
          <input
            className="ep-input"
            type="number"
            min={1}
            value={v.capacity}
            onChange={set('capacity')}
          />
        </label>
      </div>
      <label className="ep-field">
        <span className="ep-field__label">Note on the admit card</span>
        <input className="ep-input" maxLength={500} value={v.notes} onChange={set('notes')} />
      </label>
      {error ? (
        <div className="ep-alert ep-alert--danger" role="alert">
          {error}
        </div>
      ) : null}
      <div className="ep-form-actions">
        <button type="button" className="ep-btn ep-btn--primary" disabled={pending} onClick={save}>
          {slot ? 'Save the slot' : 'Add the slot'}
        </button>
        {slot && !slot.allotted ? (
          <button
            type="button"
            className="ep-btn ep-btn--ghost"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await deleteSlot(slot.id);
                if (r.ok) router.push(`/admissions/schedule?cycleId=${cycleId}`);
                else setError(r.error);
              })
            }
          >
            Remove the slot
          </button>
        ) : null}
      </div>
    </div>
  );
}
