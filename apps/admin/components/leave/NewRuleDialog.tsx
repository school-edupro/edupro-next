'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@edupro/ui';
import { ScopePicker } from '@/components/leave/ScopePicker';
import { createApprovalRule } from '@/lib/leave-actions';
import type { LeaveScope } from '@/lib/leave';

/**
 * "＋ New rule" on Who approves → Group rules: a small dialog — what it approves, a name, who it is for,
 * the leave type. Who approves is set on the next page.
 */
export function NewRuleDialog({
  scopes,
  staff,
  types,
}: {
  scopes: Record<Exclude<LeaveScope, 'all'>, string[]>;
  staff: Array<{ code: string; name: string }>;
  types: Array<{ id: string; code: string; name: string; auto: boolean }>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'leave' | 'regularisation'>('leave');
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        ＋ New rule
      </Button>
      <dialog
        ref={ref}
        className="ep-dialog"
        data-size="lg"
        aria-labelledby="nr-title"
        onClose={() => setOpen(false)}
      >
        <form action={createApprovalRule} className="ep-dialog__body">
          <h3 id="nr-title" className="ep-card__title">
            New rule
          </h3>
          <div className="ep-dialog__content ep-form-section__body">
            <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="ep-field__label">It approves</legend>
              <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
                <label className="ep-check">
                  <input
                    type="radio"
                    name="kind"
                    value="leave"
                    checked={kind === 'leave'}
                    onChange={() => setKind('leave')}
                  />
                  <span className="ep-check__text">Leave</span>
                </label>
                <label className="ep-check">
                  <input
                    type="radio"
                    name="kind"
                    value="regularisation"
                    checked={kind === 'regularisation'}
                    onChange={() => setKind('regularisation')}
                  />
                  <span className="ep-check__text">Attendance corrections</span>
                </label>
              </div>
            </fieldset>
            <label className="ep-field" htmlFor="nr-name">
              <span className="ep-field__label">
                Name<span aria-hidden="true"> *</span>
              </span>
              <input
                id="nr-name"
                name="name"
                className="ep-input"
                required
                minLength={2}
                maxLength={100}
                placeholder="e.g. Science department"
              />
            </label>
            <ScopePicker id="nr" scopes={scopes} staff={staff} />
            {kind === 'leave' ? (
              <label className="ep-field" htmlFor="nr-type">
                <span className="ep-field__label">Leave type</span>
                <select id="nr-type" name="leaveTypeId" className="ep-select" defaultValue="">
                  <option value="">Any leave type</option>
                  {types
                    .filter((t) => !t.auto)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.code})
                      </option>
                    ))}
                </select>
                <span className="ep-field__help">
                  Only for one type (e.g. maternity leave)? Pick it; otherwise leave Any.
                </span>
              </label>
            ) : null}
            <p className="ep-field__help">
              It goes just above “All staff” in the list (move it with ↑ ↓). Next you choose who
              approves.
            </p>
          </div>
          <div className="ep-dialog__actions">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Next: choose approvers</Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
