'use client';
import { Badge } from '@edupro/ui';
import { useState, useTransition } from 'react';
import { giveLatePasscode, latePasscodeAction } from '@/lib/admission-setup-actions';
import type { LatePasscode } from '@/lib/admission-setup';

const dmy = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(iso))
    : '';
const STATE: Record<
  LatePasscode['state'],
  { label: string; tone: 'info' | 'success' | 'neutral' | 'danger' }
> = {
  sent: { label: 'Sent, not used yet', tone: 'info' },
  used: { label: 'In use', tone: 'success' },
  expired: { label: 'Expired', tone: 'neutral' },
  revoked: { label: 'Revoked', tone: 'danger' },
};
/** yyyy-mm-dd of a day from today, India time */
const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10);

/**
 * Late entry (docs/design/41, part 4): once a class is closed families cannot start, save, submit or pay
 * the registration fee; the admin opens it for one family until a date with a passcode mailed to them.
 */
export function LateEntry({
  sessionId,
  classes,
  initial,
}: {
  sessionId: string;
  classes: Array<{ classId: string; className: string }>;
  initial: LatePasscode[];
}) {
  const [rows, setRows] = useState(initial);
  const [form, setForm] = useState({
    classId: classes[0]?.classId ?? '',
    email: '',
    mobile: '',
    childName: '',
    validUntil: inDays(3),
    note: '',
  });
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, start] = useTransition();

  const give = () =>
    start(async () => {
      const r = await giveLatePasscode(sessionId, {
        classId: form.classId,
        email: form.email.trim(),
        validUntil: form.validUntil,
        ...(form.mobile.trim() ? { mobile: form.mobile.trim() } : {}),
        ...(form.childName.trim() ? { childName: form.childName.trim() } : {}),
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
      });
      if (r.ok) {
        setRows(r.data);
        setMsg({ tone: 'success', text: `Passcode sent to ${form.email.trim()}.` });
        setForm({ ...form, email: '', mobile: '', childName: '', note: '' });
      } else setMsg({ tone: 'danger', text: r.error });
    });
  const act = (id: string, action: 'resend' | 'revoke') =>
    start(async () => {
      const r = await latePasscodeAction(sessionId, id, action);
      if (r.ok) {
        setRows(r.data);
        setMsg({
          tone: 'success',
          text:
            action === 'resend'
              ? 'A new passcode is sent; the earlier one no longer works.'
              : 'Revoked.',
        });
      } else setMsg({ tone: 'danger', text: r.error });
    });

  return (
    <div className="ep-late">
      <p className="ep-field__help">
        When the session or a class is closed, families can no longer start, save or submit a form
        or pay the registration fee. To let one family in late, give them a passcode: it is emailed
        to them (school letterhead) and works only for that family (the email or mobile below), for
        that class, until the date. Corrections the school asked for and the admission fee after an
        offer are not affected.
      </p>
      <section className="ep-late__form" aria-labelledby="late-give">
        <h3 id="late-give">Give a passcode</h3>
        <div className="ep-late__grid">
          <label className="ep-field">
            <span className="ep-field__label">Class *</span>
            <select
              className="ep-select"
              value={form.classId}
              onChange={(e) => setForm({ ...form, classId: e.target.value })}
            >
              {classes.map((k) => (
                <option key={k.classId} value={k.classId}>
                  {k.className}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Family&rsquo;s email *</span>
            <input
              className="ep-input"
              type="email"
              maxLength={200}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Family&rsquo;s mobile</span>
            <input
              className="ep-input"
              inputMode="numeric"
              maxLength={10}
              value={form.mobile}
              onChange={(e) => setForm({ ...form, mobile: e.target.value.replace(/\D/g, '') })}
            />
            <span className="ep-field__help">If they sign in with a mobile number</span>
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Child&rsquo;s name</span>
            <input
              className="ep-input"
              maxLength={120}
              value={form.childName}
              onChange={(e) => setForm({ ...form, childName: e.target.value })}
            />
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Works until *</span>
            <input
              className="ep-input"
              type="date"
              min={inDays(0)}
              value={form.validUntil}
              onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
            />
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Note (for the office)</span>
            <input
              className="ep-input"
              maxLength={300}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </label>
        </div>
        <div className="ep-form-actions">
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            disabled={
              pending || !form.classId || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())
            }
            onClick={give}
          >
            {pending ? 'Sending…' : 'Send passcode'}
          </button>
        </div>
      </section>
      {msg ? (
        <p
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
        >
          {msg.text}
        </p>
      ) : null}
      <section aria-labelledby="late-list">
        <h3 id="late-list">Passcodes given ({rows.length})</h3>
        {rows.length === 0 ? (
          <p className="ep-field__help">None yet.</p>
        ) : (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Passcodes given">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Late-entry passcodes</caption>
              <thead>
                <tr>
                  <th scope="col">Family</th>
                  <th scope="col">Class</th>
                  <th scope="col">Until</th>
                  <th scope="col">Status</th>
                  <th scope="col">Given</th>
                  <th scope="col">
                    <span className="ep-sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.email}
                      <div className="ep-field__help">
                        {[p.mobile, p.childName, p.note].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td>{p.className}</td>
                    <td>{dmy(p.validUntil)}</td>
                    <td>
                      <Badge tone={STATE[p.state].tone}>{STATE[p.state].label}</Badge>
                      {p.usedAt ? (
                        <div className="ep-field__help">
                          used {dmy(p.usedAt)}
                          {p.usedBy ? ` by ${p.usedBy}` : ''}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {dmy(p.createdAt)}
                      {p.createdBy ? <div className="ep-field__help">{p.createdBy}</div> : null}
                    </td>
                    <td>
                      {p.state === 'sent' || p.state === 'used' ? (
                        <span className="ep-late__acts">
                          <button
                            type="button"
                            className="ep-btn ep-btn--ghost ep-btn--sm"
                            disabled={pending}
                            aria-label={`Send a new passcode to ${p.email}`}
                            onClick={() => act(p.id, 'resend')}
                          >
                            Resend
                          </button>
                          <button
                            type="button"
                            className="ep-btn ep-btn--ghost ep-btn--sm"
                            disabled={pending}
                            aria-label={`Revoke the passcode of ${p.email}`}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Revoke the passcode of ${p.email}? It stops working at once.`,
                                )
                              )
                                act(p.id, 'revoke');
                            }}
                          >
                            Revoke
                          </button>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
