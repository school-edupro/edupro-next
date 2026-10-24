'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createExit, findEmployees, uploadExitLetter } from '@/lib/exit-actions';
import { dmy, type ExitSetup } from '@/lib/exits';

type Found = Awaited<ReturnType<typeof findEmployees>>[number];
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The office records an exit on an employee's behalf: who, which exit, the letter, the dates. */
export function ExitNewForm({ setup }: { setup: ExitSetup }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[] | null>(null);
  const [emp, setEmp] = useState<Found | null>(null);
  const types = setup.types.filter((t) => t.active);
  const [type, setType] = useState(types[0]?.code ?? '');
  const [reason, setReason] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const [requestedOn, setRequestedOn] = useState(today);
  const [lastDay, setLastDay] = useState('');
  const [letter, setLetter] = useState<File | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const t = types.find((x) => x.code === type);
  const notice = emp && t?.noticeApplies ? (setup.noticeDays[emp.type] ?? 0) : 0;
  const expected = addDays(requestedOn || today, notice);
  const search = () => start(async () => setFound(await findEmployees(q)));

  const save = () =>
    start(async () => {
      setMsg(null);
      let letterFileId: string | null = null;
      if (letter) {
        const fd = new FormData();
        fd.set('file', letter);
        const up = await uploadExitLetter(fd);
        if (!up.ok) return setMsg(up.error);
        letterFileId = up.data.id;
      }
      const r = await createExit({
        employeeId: emp!.id,
        exitType: type,
        reason: reason.trim(),
        letterFileId,
        requestedOn,
        proposedLastDay: lastDay || expected,
      });
      if (r.ok)
        router.push(
          `/people/exits/${r.data.id}?ok=1&detail=${encodeURIComponent('Recorded and sent for approval.')}`,
        );
      else setMsg(r.error);
    });

  return (
    <section
      className="ep-card"
      style={{ padding: 'var(--sp-4)', display: 'grid', gap: 'var(--sp-3)' }}
    >
      <div className="ep-rp__row" style={{ alignItems: 'flex-end' }}>
        <label className="ep-field" htmlFor="xn-q" style={{ flex: 1 }}>
          <span className="ep-field__label">Employee: name or code</span>
          <input
            id="xn-q"
            className="ep-input"
            value={q}
            maxLength={80}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                search();
              }
            }}
          />
        </label>
        <button
          type="button"
          className="ep-btn ep-btn--secondary ep-btn--sm"
          disabled={pending || q.trim().length < 2}
          onClick={search}
        >
          Find
        </button>
      </div>
      {found ? (
        found.length ? (
          <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="ep-field__label">Choose the employee</legend>
            {found.map((f) => (
              <label key={f.id} className="ep-radio">
                <input
                  type="radio"
                  className="ep-radio__input"
                  name="xn-emp"
                  checked={emp?.id === f.id}
                  onChange={() => setEmp(f)}
                />
                <span className="ep-radio__dot" aria-hidden="true" />
                <span className="ep-check__text">
                  {f.name} · {f.code}
                  {f.designation ? ` · ${f.designation}` : ''}
                  {f.department ? ` · ${f.department}` : ''}
                </span>
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="ep-field__help" style={{ margin: 0 }}>
            No active employee found.
          </p>
        )
      ) : null}
      <div className="ep-profile__grid">
        <label className="ep-field" htmlFor="xn-type">
          <span className="ep-field__label">Exit</span>
          <select
            id="xn-type"
            className="ep-select"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {types.map((x) => (
              <option key={x.code} value={x.code}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor="xn-on">
          <span className="ep-field__label">Date of the request (or letter)</span>
          <input
            id="xn-on"
            className="ep-input"
            type="date"
            value={requestedOn}
            onChange={(e) => setRequestedOn(e.target.value)}
          />
        </label>
        <label className="ep-field" htmlFor="xn-last">
          <span className="ep-field__label">Proposed last working day</span>
          <input
            id="xn-last"
            className="ep-input"
            type="date"
            value={lastDay}
            aria-describedby="xn-last-help"
            onChange={(e) => setLastDay(e.target.value)}
          />
          <span id="xn-last-help" className="ep-field__help">
            {t?.noticeApplies
              ? emp
                ? `Notice ${String(notice)} days: the expected last day is ${dmy(expected)}${lastDay ? '' : ' (used when left blank)'}.`
                : 'The notice period of the employee’s type applies.'
              : 'No notice period for this exit.'}
          </span>
        </label>
        <label className="ep-field" htmlFor="xn-letter">
          <span className="ep-field__label">Letter (PDF or photo, optional)</span>
          <input
            id="xn-letter"
            className="ep-input"
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            onChange={(e) => setLetter(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>
      <label className="ep-field" htmlFor="xn-reason">
        <span className="ep-field__label">Reason</span>
        <textarea
          id="xn-reason"
          className="ep-input"
          rows={3}
          maxLength={1000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {msg ? (
        <div className="ep-alert ep-alert--danger" role="alert">
          {msg}
        </div>
      ) : null}
      <div className="ep-form-actions">
        <button
          type="button"
          className="ep-btn ep-btn--primary"
          disabled={pending || !emp || !type || reason.trim().length < 3}
          onClick={save}
        >
          Record and send for approval
        </button>
        <a className="ep-btn ep-btn--ghost" href="/people/exits">
          Cancel
        </a>
      </div>
    </section>
  );
}
