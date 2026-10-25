'use client';
import { useState, useTransition } from 'react';
import { CheckList } from '@/components/comms/CheckList';
import { saveEnquiryDesk } from '@/lib/admission-enquiry-actions';

/**
 * How the enquiry desk takes the website's enquiries (docs/design/43, part 3): given to a counsellor on
 * arrival (the one with the fewest open enquiries), and acknowledged to the family with its number.
 */
export function EnquiryDeskEditor({
  initial,
  counsellors,
  canEdit,
}: {
  initial: { autoAssign: boolean; counsellors: string[]; acknowledge: boolean; channels: string[] };
  counsellors: Array<{ id: string; name: string }>;
  canEdit: boolean;
}) {
  const [autoAssign, setAutoAssign] = useState(initial.autoAssign);
  const [chosen, setChosen] = useState<string[]>(initial.counsellors);
  const [acknowledge, setAcknowledge] = useState(initial.acknowledge);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const by = [
    initial.channels.includes('email') ? 'email' : '',
    initial.channels.includes('sms') ? 'SMS' : '',
    initial.channels.includes('whatsapp') ? 'WhatsApp' : '',
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <section className="ep-card ep-as__card" aria-labelledby="as-desk">
      <h2 id="as-desk" className="ep-as__h">
        Enquiry desk
      </h2>
      <p className="ep-field__help" style={{ margin: 0 }}>
        How enquiries from the website are taken. A counsellor finds the ones given to them under
        Enquiries with Counsellor: Me, and answers with Reply to family on the enquiry.
      </p>
      <label className="ep-check">
        <input
          type="checkbox"
          checked={autoAssign}
          disabled={!canEdit}
          onChange={(e) => setAutoAssign(e.target.checked)}
        />{' '}
        Give each website enquiry to a counsellor on arrival (the one with the fewest open
        enquiries)
      </label>
      {autoAssign ? (
        <CheckList
          id="as-desk-who"
          legend="Counsellors (none: everyone who takes enquiries)"
          options={counsellors.map((k) => ({ value: k.id, label: k.name }))}
          value={chosen}
          onChange={(v) => (canEdit ? setChosen(v) : undefined)}
          empty="Nobody has the enquiry permission yet."
        />
      ) : null}
      <label className="ep-check">
        <input
          type="checkbox"
          checked={acknowledge}
          disabled={!canEdit}
          onChange={(e) => setAcknowledge(e.target.checked)}
        />{' '}
        Acknowledge each website enquiry to the family with its number
        {by ? ` (by ${by}, as the sign-in codes go)` : ''}
      </label>
      {msg ? (
        <p className={`ep-alert ep-alert--${msg.tone}`} role="status" style={{ margin: 0 }}>
          {msg.text}
        </p>
      ) : null}
      {canEdit ? (
        <div className="ep-form-actions">
          <button
            type="button"
            className="ep-btn ep-btn--secondary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await saveEnquiryDesk({
                  autoAssign,
                  counsellors: autoAssign ? chosen : [],
                  acknowledge,
                });
                setMsg(
                  r.ok
                    ? { tone: 'success', text: 'Enquiry desk saved.' }
                    : { tone: 'danger', text: r.error },
                );
              })
            }
          >
            Save the enquiry desk
          </button>
        </div>
      ) : null}
    </section>
  );
}
