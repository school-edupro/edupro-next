'use client';
import { Badge, Dialog } from '@edupro/ui';
import { useEffect, useRef, useState, useTransition } from 'react';
import type { OfferPreview } from '@/lib/admission-process-actions';

type Words = { subject: string; intro: string; note: string };
type Tab = 'email' | 'sms' | 'whatsapp';

/**
 * Before an offer goes (docs/design/56): who hears and how, the email's words on the left (changeable
 * for this family), the message as the family will see it on the right (it follows the words as they
 * are typed); SMS and WhatsApp as they go (the school's approved templates, not changed here).
 */
export function OfferPreviewDialog({
  id,
  open,
  pending,
  onClose,
  onSend,
  fetchPreview,
  batch,
  lead,
  sendLabel,
}: {
  /** the registration previewed (in a batch: the first family, as the sample) */
  id: string;
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onSend: (message: Partial<Words>) => void;
  fetchPreview: (
    edits: Partial<Words>,
  ) => Promise<{ ok: true; data: OfferPreview } | { ok: false; error: string }>;
  /** offers made together (the Excel sheet, the Selection page): the words name each family with {{name}}, {{class}}… */
  batch?: { names: string[] };
  /** a line above the message (a draw: its seed and who waits) */
  lead?: string;
  /** the send button's words (a draw: "Draw and send …") */
  sendLabel?: string;
}) {
  const [data, setData] = useState<OfferPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [words, setWords] = useState<Words>({ subject: '', intro: '', note: '' });
  // the school's own words: only what differs is sent as a change
  const [base, setBase] = useState<Words | null>(null);
  const [tab, setTab] = useState<Tab>('email');
  const [loading, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const changes = (w: Words): Partial<Words> =>
    base
      ? Object.fromEntries(
          (Object.keys(w) as Array<keyof Words>)
            .filter((k) => w[k].trim() !== base[k])
            .map((k) => [k, w[k].trim()]),
        )
      : {};
  const load = (edits: Partial<Words>, first = false) =>
    start(async () => {
      const r = await fetchPreview(edits);
      if (!r.ok) return setError(r.error);
      setError(null);
      setData(r.data);
      if (first) {
        // a batch edits the words with the family's facts as {{…}}, filled in for each family
        const w = batch
          ? {
              subject: r.data.templates.subject,
              intro: r.data.templates.intro,
              note: r.data.templates.note,
            }
          : {
              subject: r.data.email.subject,
              intro: r.data.email.intro,
              note: r.data.email.note,
            };
        setBase(w);
        setWords(w);
      }
    });
  useEffect(() => {
    if (open) load({}, true);
  }, [open, id]);
  // the preview follows the typing (a moment after it stops)
  const edit = (k: keyof Words, v: string) => {
    const next = { ...words, [k]: v };
    setWords(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => load(changes(next)), 600);
  };
  const reset = () => {
    if (!base) return;
    setWords(base);
    load({});
  };
  const edited = Object.keys(changes(words)).length > 0;
  const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;
  const payBy = data?.email.rows.find(([k]) => k === 'Pay by')?.[1];

  return (
    <Dialog
      open={open}
      size="xl"
      title={
        batch
          ? `Offer admission to ${String(batch.names.length)} ${batch.names.length === 1 ? 'family' : 'families'}: the message`
          : 'Offer admission: the message to the family'
      }
      onClose={onClose}
      primary={{
        label: pending
          ? 'Sending…'
          : sendLabel
            ? sendLabel
            : batch
              ? `Apply and send ${String(batch.names.length)} offer${batch.names.length === 1 ? '' : 's'}`
              : 'Send the offer',
        loading: pending,
        onClick: () => {
          if (words.subject.trim().length < 3 || words.intro.trim().length < 3) {
            setError('The subject and the message need a few words.');
            return;
          }
          onSend(changes(words));
        },
      }}
    >
      {!data ? (
        <p style={{ margin: 0 }} role="status">
          {error ?? 'Making the preview…'}
        </p>
      ) : (
        <div className="ep-offer">
          {lead ? (
            <p className="ep-alert ep-alert--info" role="status" style={{ margin: 0 }}>
              {lead}
            </p>
          ) : null}
          {batch ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              <strong>Goes to:</strong> {batch.names.slice(0, 8).join(', ')}
              {batch.names.length > 8 ? ` and ${String(batch.names.length - 8)} more` : ''}. The
              preview shows the first family; each gets their own name, class, fee and pay-by date.
            </p>
          ) : null}
          <div className="ep-offer__to" aria-label="Who hears">
            <span className="ep-field__label" style={{ margin: 0 }}>
              {batch ? 'First family' : 'Goes to'}
            </span>
            {(
              [
                ['Email', data.email.on, data.email.to],
                ['SMS', data.sms.on, data.sms.to],
                ['WhatsApp', data.whatsapp.on, data.whatsapp.to],
              ] as const
            ).map(([label, on, to]) => (
              <span key={label} className="ep-offer__chip" data-off={!on}>
                <strong>{label}</strong> {on ? to : 'not sent'}
              </span>
            ))}
            <span className="ep-field__help" style={{ margin: 0 }}>
              Admission fee {rupees(data.amount)}
              {payBy ? ` · pay by ${payBy}` : ''}
            </span>
          </div>

          <div className="ep-offer__grid">
            <section className="ep-offer__edit" aria-labelledby="offer-words">
              <h3 id="offer-words" className="ep-offer__h">
                The email&apos;s words {edited ? <Badge tone="info">Changed</Badge> : null}
              </h3>
              <p className="ep-field__help" style={{ margin: 0 }}>
                {batch ? (
                  <>
                    The same words for every family; write{' '}
                    {data.templates.fields.map((f, i) => (
                      <span key={f}>
                        {i ? ', ' : ''}
                        <code>{`{{${f}}}`}</code>
                      </span>
                    ))}{' '}
                    where each family&apos;s own fact goes. The school&apos;s template stays as it
                    is.
                  </>
                ) : (
                  <>
                    For this family only; the school&apos;s template stays as it is. The candidate,
                    class, fee and pay-by date are filled in and cannot be changed.
                  </>
                )}
              </p>
              <label className="ep-field">
                <span className="ep-field__label">Subject</span>
                <input
                  className="ep-input"
                  maxLength={200}
                  value={words.subject}
                  onChange={(e) => edit('subject', e.target.value)}
                />
              </label>
              <label className="ep-field">
                <span className="ep-field__label">Message</span>
                <textarea
                  className="ep-input"
                  rows={5}
                  maxLength={2000}
                  value={words.intro}
                  onChange={(e) => edit('intro', e.target.value)}
                />
              </label>
              <label className="ep-field">
                <span className="ep-field__label">Closing line</span>
                <textarea
                  className="ep-input"
                  rows={3}
                  maxLength={1000}
                  value={words.note}
                  onChange={(e) => edit('note', e.target.value)}
                />
              </label>
              {edited ? (
                <div>
                  <button type="button" className="ep-btn ep-btn--ghost ep-btn--sm" onClick={reset}>
                    Back to the school&apos;s words
                  </button>
                </div>
              ) : null}
              {error ? (
                <p className="ep-alert ep-alert--danger" role="alert" style={{ margin: 0 }}>
                  {error}
                </p>
              ) : null}
            </section>

            <section aria-labelledby="offer-preview">
              <h3 id="offer-preview" className="ep-sr-only">
                Preview
              </h3>
              <div className="ep-offer__tabs" role="tablist" aria-label="Preview of">
                {(
                  [
                    ['email', 'Email'],
                    ['sms', 'SMS'],
                    ['whatsapp', 'WhatsApp'],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    id={`offer-tab-${k}`}
                    aria-selected={tab === k}
                    aria-controls={`offer-panel-${k}`}
                    className={`ep-btn ep-btn--sm ${tab === k ? 'ep-btn--primary' : 'ep-btn--ghost'}`}
                    onClick={() => setTab(k)}
                  >
                    {label}
                  </button>
                ))}
                <span
                  className="ep-field__help"
                  style={{ margin: 0, alignSelf: 'center' }}
                  aria-live="polite"
                >
                  {loading ? 'Updating…' : ''}
                </span>
              </div>
              {tab === 'email' ? (
                <div role="tabpanel" id="offer-panel-email" aria-labelledby="offer-tab-email">
                  <p className="ep-field__help" style={{ marginTop: 0 }}>
                    <strong>Subject:</strong> {data.email.subject}
                  </p>
                  <iframe
                    title="The email as the family will see it"
                    className="ep-offer__frame"
                    sandbox="allow-same-origin"
                    srcDoc={data.email.html}
                  />
                </div>
              ) : (
                <div
                  role="tabpanel"
                  id={`offer-panel-${tab}`}
                  aria-labelledby={`offer-tab-${tab}`}
                  className="ep-offer__phone"
                >
                  <p className="ep-offer__bubble">
                    {(tab === 'sms' ? data.sms.text : data.whatsapp.text) ||
                      'No template is set for this message.'}
                  </p>
                  <p className="ep-field__help" style={{ marginBottom: 0 }}>
                    {(tab === 'sms' ? data.sms.on : data.whatsapp.on)
                      ? `To ${data.sms.to ?? ''}. `
                      : 'Not sent: no mobile number, or the template is off. '}
                    It follows the school&apos;s approved {tab === 'sms' ? 'DLT' : 'WhatsApp'}{' '}
                    template, so it goes as written; change it in Communication → Templates.
                  </p>
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </Dialog>
  );
}
