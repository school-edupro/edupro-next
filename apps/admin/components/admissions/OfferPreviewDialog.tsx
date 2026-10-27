'use client';
import { Dialog } from '@edupro/ui';
import { useEffect, useState, useTransition } from 'react';
import { previewOffer, type OfferPreview } from '@/lib/admission-process-actions';

/**
 * Before an offer goes (docs/design/56): the email as the family will see it, its subject, opening and
 * closing words changeable for this family; the SMS and WhatsApp texts shown as they go (the
 * school's approved templates, not changed here). Send makes the offer with the email as changed.
 */
export function OfferPreviewDialog({
  id,
  open,
  pending,
  onClose,
  onSend,
}: {
  id: string;
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onSend: (message: { subject?: string; intro?: string; note?: string }) => void;
}) {
  const [data, setData] = useState<OfferPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [intro, setIntro] = useState('');
  const [note, setNote] = useState('');
  // the words as the school's template has them: only what differs is sent as a change
  const [base, setBase] = useState<{ subject: string; intro: string; note: string } | null>(null);
  const [loading, start] = useTransition();

  const load = (edits: { subject?: string; intro?: string; note?: string }, first = false) =>
    start(async () => {
      const r = await previewOffer(id, edits);
      if (!r.ok) return setError(r.error);
      setError(null);
      setData(r.data);
      if (first) {
        setBase({
          subject: r.data.email.subject,
          intro: r.data.email.intro,
          note: r.data.email.note,
        });
        setSubject(r.data.email.subject);
        setIntro(r.data.email.intro);
        setNote(r.data.email.note);
      }
    });
  useEffect(() => {
    if (open) load({}, true);
  }, [open, id]);

  const changed = () =>
    base
      ? {
          ...(subject.trim() !== base.subject ? { subject: subject.trim() } : {}),
          ...(intro.trim() !== base.intro ? { intro: intro.trim() } : {}),
          ...(note.trim() !== base.note ? { note: note.trim() } : {}),
        }
      : {};
  return (
    <Dialog
      open={open}
      size="lg"
      title="Offer admission: the message to the family"
      onClose={onClose}
      primary={{
        label: pending ? 'Sending…' : 'Send the offer',
        loading: pending,
        onClick: () => {
          if (subject.trim().length < 3 || intro.trim().length < 3) {
            setError('The subject and the message need a few words.');
            return;
          }
          onSend(changed());
        },
      }}
    >
      {!data ? (
        <p style={{ margin: 0 }}>{loading ? 'Making the preview…' : (error ?? '')}</p>
      ) : (
        <div className="ep-offer">
          <p className="ep-field__help" style={{ margin: 0 }}>
            Admission fee {`₹${data.amount.toLocaleString('en-IN')}`}. Change the words of the email
            for this family if needed; the facts (candidate, class, fee, pay-by date) stay as they
            are.
          </p>
          <section aria-labelledby="offer-email" className="ep-offer__part">
            <h3 id="offer-email" className="ep-offer__h">
              Email{' '}
              {data.email.on
                ? `to ${data.email.to ?? ''}`
                : '(not sent: no email or the template is off)'}
            </h3>
            <label className="ep-field">
              <span className="ep-field__label">Subject</span>
              <input
                className="ep-input"
                maxLength={200}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </label>
            <label className="ep-field">
              <span className="ep-field__label">Message</span>
              <textarea
                className="ep-input"
                rows={3}
                maxLength={2000}
                value={intro}
                onChange={(e) => setIntro(e.target.value)}
              />
            </label>
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">The facts in the email</caption>
              <tbody>
                {data.email.rows.map(([k, v]) => (
                  <tr key={k}>
                    <th scope="row">{k}</th>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <label className="ep-field">
              <span className="ep-field__label">Closing line</span>
              <textarea
                className="ep-input"
                rows={2}
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <div>
              <button
                type="button"
                className="ep-btn ep-btn--secondary ep-btn--sm"
                disabled={loading}
                onClick={() => load(changed())}
              >
                {loading ? 'Updating…' : 'Update the preview'}
              </button>
            </div>
            <iframe
              title="The email as the family will see it"
              className="ep-offer__frame"
              sandbox="allow-same-origin"
              srcDoc={data.email.html}
            />
          </section>
          <section aria-labelledby="offer-sms" className="ep-offer__part">
            <h3 id="offer-sms" className="ep-offer__h">
              SMS {data.sms.on ? `to ${data.sms.to ?? ''}` : '(not sent)'} and WhatsApp
              {data.whatsapp.on ? '' : ' (not sent)'}
            </h3>
            <p className="ep-field__help" style={{ margin: 0 }}>
              These follow the school&apos;s approved templates (DLT / WhatsApp), so they go as
              written; change them in Communication → Templates.
            </p>
            {data.sms.text ? <p className="ep-offer__text">{data.sms.text}</p> : null}
            {data.whatsapp.text && data.whatsapp.text !== data.sms.text ? (
              <p className="ep-offer__text">{data.whatsapp.text}</p>
            ) : null}
          </section>
          {error ? (
            <p className="ep-alert ep-alert--danger" role="alert" style={{ margin: 0 }}>
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
