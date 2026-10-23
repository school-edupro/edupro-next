'use client';
import { Badge } from '@edupro/ui';
import { useState, useTransition } from 'react';
import { saveEnquirySources } from '@/lib/admission-enquiry-actions';

type Source = {
  id?: string;
  name: string;
  status: 'active' | 'inactive';
  used: number;
  key: string;
};

/** Where enquiries come from (walk-in, website, newspaper …), for the enquiry desk and its report. */
export function EnquirySourcesEditor({
  initial,
  canEdit,
}: {
  initial: Array<{ id: string; name: string; status: string; used: number }>;
  canEdit: boolean;
}) {
  const [list, setList] = useState<Source[]>(() =>
    initial.map((s) => ({
      ...s,
      status: s.status === 'inactive' ? 'inactive' : 'active',
      key: s.id,
    })),
  );
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <section className="ep-card ep-as__card" aria-labelledby="as-sources">
      <h2 id="as-sources" className="ep-as__h">
        Enquiry sources
      </h2>
      <p className="ep-field__help" style={{ margin: 0 }}>
        Where families heard of the school. The enquiry conversion report counts registrations and
        admissions by these.
      </p>
      <ul className="ep-pe__list">
        {list.map((s, i) => (
          <li key={s.key} className="ep-as__cathead">
            <input
              className="ep-input"
              aria-label="Source name"
              value={s.name}
              maxLength={60}
              disabled={!canEdit}
              onChange={(e) =>
                setList((cur) => cur.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
              }
            />
            {s.used ? <span className="ep-kicker">{s.used} enquiries</span> : null}
            {s.status === 'inactive' ? <Badge tone="neutral">Off</Badge> : null}
            {canEdit ? (
              <button
                type="button"
                className="ep-btn ep-btn--ghost ep-btn--sm"
                onClick={() =>
                  setList((cur) =>
                    cur.map((x, j) =>
                      j === i ? { ...x, status: x.status === 'active' ? 'inactive' : 'active' } : x,
                    ),
                  )
                }
              >
                {s.status === 'active' ? 'Switch off' : 'Switch on'}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {msg ? (
        <p
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
        >
          {msg.text}
        </p>
      ) : null}
      {canEdit ? (
        <div className="ep-form-actions">
          <button
            type="button"
            className="ep-btn ep-btn--secondary"
            onClick={() =>
              setList((cur) => [
                ...cur,
                { name: 'New source', status: 'active', used: 0, key: `n${String(Date.now())}` },
              ])
            }
          >
            Add a source
          </button>
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await saveEnquirySources(
                  list.map(({ id, name, status }) => ({ ...(id ? { id } : {}), name, status })),
                );
                if (r.ok) {
                  setList(
                    r.data.map((s) => ({
                      ...s,
                      status: s.status === 'inactive' ? 'inactive' : 'active',
                      key: s.id,
                    })),
                  );
                  setMsg({ tone: 'success', text: 'Sources saved.' });
                } else setMsg({ tone: 'danger', text: r.error });
              })
            }
          >
            Save sources
          </button>
        </div>
      ) : null}
    </section>
  );
}
