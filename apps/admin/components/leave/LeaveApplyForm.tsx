'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import type { ApplyResult, LeaveFormType } from '@/lib/leave';

/**
 * Apply for leave (docs/design/85, phase B): the type, the dates (one date may be half a day), the
 * reason and the document when the type needs one. The school's answer may be a question first — the
 * sandwich across two leaves, or the paid part + loss of pay when the balance is short — accepted with one
 * click. The office's form also picks the employee, and may enter loss of pay.
 */
export function LeaveApplyForm({
  types,
  balances = [],
  employees,
  apply,
  idPrefix = 'la',
  submitLabel = 'Apply',
  detailPath = '/leave/requests/',
}: {
  types: LeaveFormType[];
  balances?: Array<{ typeId: string; available: number }>;
  /** the office's form: the employee to enter leave for */
  employees?: Array<{ id: string; name: string }>;
  apply: (fd: FormData) => Promise<ApplyResult>;
  idPrefix?: string;
  submitLabel?: string;
  /** where the leave made opens (the staff app has its own page) */
  detailPath?: string;
}) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [typeId, setTypeId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [half, setHalf] = useState(false);
  const [ask, setAsk] = useState<Extract<ApplyResult, { ok: 'confirm' }> | null>(null);
  const [accepted, setAccepted] = useState<{ bridge: boolean; split: boolean }>({
    bridge: false,
    split: false,
  });
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const type = types.find((t) => t.id === typeId);
  const left = balances.find((b) => b.typeId === typeId);
  const oneDay = !!from && (!to || to === from);
  const send = (
    extra: { bridge?: boolean; split?: boolean; documentFileId?: string | null } = {},
  ) =>
    start(async () => {
      if (!form.current) return;
      const fd = new FormData(form.current);
      const acc = {
        bridge: extra.bridge ?? accepted.bridge,
        split: extra.split ?? accepted.split,
      };
      if (acc.bridge) fd.set('bridgeOk', '1');
      if (acc.split) fd.set('splitOk', '1');
      if (extra.documentFileId) {
        fd.set('documentFileId', extra.documentFileId);
        fd.delete('document');
      }
      setError('');
      const r = await apply(fd);
      if (r.ok === 'confirm') {
        setAccepted(acc);
        setAsk(r);
        return;
      }
      setAsk(null);
      setAccepted({ bridge: false, split: false });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const words = `${r.number}: ${r.status === 'approved' ? 'approved' : 'sent for approval'} (${String(r.days)} day${r.days === 1 ? '' : 's'})${r.lopNumber ? `, the loss-of-pay part is ${r.lopNumber}` : ''}${r.replaced?.length ? `; replaced ${r.replaced.join(', ')}` : ''}.`;
      router.push(`${detailPath}${r.id}?ok=1&detail=${encodeURIComponent(words)}`);
    });
  return (
    <form
      ref={form}
      className="ep-form-section__body"
      onSubmit={(e) => {
        e.preventDefault();
        setAccepted({ bridge: false, split: false });
        send({ bridge: false, split: false });
      }}
    >
      {employees ? (
        <label className="ep-field" htmlFor={`${idPrefix}-emp`}>
          <span className="ep-field__label">Employee</span>
          <select
            id={`${idPrefix}-emp`}
            name="employeeId"
            className="ep-select"
            required
            defaultValue=""
          >
            <option value="">Pick the employee</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="ep-field" htmlFor={`${idPrefix}-type`}>
        <span className="ep-field__label">Leave type</span>
        <select
          id={`${idPrefix}-type`}
          name="leaveTypeId"
          className="ep-select"
          required
          value={typeId}
          onChange={(e) => {
            setTypeId(e.target.value);
            setAsk(null);
          }}
        >
          <option value="">Pick the leave type</option>
          {types.map((t) => {
            const b = balances.find((x) => x.typeId === t.id);
            return (
              <option key={t.id} value={t.id}>
                {t.name} ({t.code}){b ? ` — ${String(b.available)} left` : ''}
              </option>
            );
          })}
        </select>
        {type ? (
          <span className="ep-field__help">
            {[
              type.keepsBalance && left ? `${String(left.available)} days left` : null,
              type.maxDays !== null ? `at most ${String(type.maxDays)} days an application` : null,
              type.approvedAtOnce ? 'approved at once' : null,
              type.documentNeeded ? 'needs a document' : null,
            ]
              .filter(Boolean)
              .join(' · ') ||
              'Weekly offs and holidays inside the dates are not counted unless the sandwich rule applies.'}
          </span>
        ) : null}
      </label>
      <div className="ep-grid__toolbar" style={{ flexWrap: 'wrap' }}>
        <label className="ep-field" htmlFor={`${idPrefix}-from`}>
          <span className="ep-field__label">From</span>
          <input
            id={`${idPrefix}-from`}
            name="from"
            type="date"
            required
            className="ep-input"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              if (!to || to < e.target.value) setTo(e.target.value);
              setAsk(null);
            }}
          />
        </label>
        <label className="ep-field" htmlFor={`${idPrefix}-to`}>
          <span className="ep-field__label">To</span>
          <input
            id={`${idPrefix}-to`}
            name="to"
            type="date"
            required
            className="ep-input"
            min={from || undefined}
            value={half ? from : to}
            disabled={half}
            onChange={(e) => {
              setTo(e.target.value);
              setAsk(null);
            }}
          />
        </label>
        {type?.halfDay && oneDay ? (
          <>
            <label className="ep-check" htmlFor={`${idPrefix}-half`}>
              <input
                id={`${idPrefix}-half`}
                name="halfDay"
                type="checkbox"
                className="ep-check__input"
                checked={half}
                onChange={(e) => setHalf(e.target.checked)}
              />
              <span className="ep-check__box" />
              Half a day
            </label>
            {half ? (
              <label className="ep-field" htmlFor={`${idPrefix}-session`}>
                <span className="ep-field__label">Which half</span>
                <select id={`${idPrefix}-session`} name="session" className="ep-select">
                  <option value="first">First half</option>
                  <option value="second">Second half</option>
                </select>
              </label>
            ) : null}
          </>
        ) : null}
      </div>
      <label className="ep-field" htmlFor={`${idPrefix}-reason`}>
        <span className="ep-field__label">Reason</span>
        <textarea
          id={`${idPrefix}-reason`}
          name="reason"
          required
          minLength={3}
          maxLength={1000}
          rows={3}
          className="ep-input"
        />
      </label>
      {type?.documentNeeded || employees ? (
        <label className="ep-field" htmlFor={`${idPrefix}-doc`}>
          <span className="ep-field__label">
            Document{type?.documentNeeded && !employees ? '' : ' (if any)'}
          </span>
          <input
            id={`${idPrefix}-doc`}
            name="document"
            type="file"
            className="ep-input"
            accept="application/pdf,image/png,image/jpeg"
            required={!!type?.documentNeeded && !employees}
          />
          <span className="ep-field__help">A PDF or a photo, up to 5 MB.</span>
        </label>
      ) : null}
      {error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {error}
        </p>
      ) : null}
      {ask ? (
        <div
          className="ep-alert ep-alert--warning"
          role="alertdialog"
          aria-labelledby={`${idPrefix}-ask`}
        >
          <p id={`${idPrefix}-ask`} style={{ margin: 0 }}>
            {ask.message}
          </p>
          <div className="ep-form-actions" style={{ marginTop: 'var(--sp-2)' }}>
            <button
              type="button"
              className="ep-btn ep-btn--primary ep-btn--sm"
              disabled={pending}
              onClick={() =>
                send({
                  bridge: ask.kind === 'bridge' ? true : accepted.bridge,
                  split: ask.kind === 'split' ? true : accepted.split,
                  documentFileId: ask.documentFileId,
                })
              }
            >
              {ask.kind === 'bridge' ? 'Yes, apply for those dates' : 'Yes, apply with loss of pay'}
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              onClick={() => {
                setAsk(null);
                setAccepted({ bridge: false, split: false });
              }}
            >
              No, change it
            </button>
          </div>
        </div>
      ) : (
        <div className="ep-form-actions">
          <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm" disabled={pending}>
            {pending ? 'Checking…' : submitLabel}
          </button>
        </div>
      )}
    </form>
  );
}
