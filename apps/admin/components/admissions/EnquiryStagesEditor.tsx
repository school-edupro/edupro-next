'use client';
import { Badge } from '@edupro/ui';
import { useState, useTransition } from 'react';
import { saveEnquiryStages } from '@/lib/admission-enquiry-actions';
import type { EnquiryStage } from '@/lib/admission-enquiry';

type Row = EnquiryStage & { key: string };
const KIND: Record<EnquiryStage['kind'], string> = {
  open: 'Being worked',
  started: 'Form begun (by itself)',
  registered: 'Registered (by itself)',
  admitted: 'Admitted (by itself)',
  lost: 'Lost (asks why)',
};

/**
 * The stages of a lead (docs/design/45, part 1): the school's own names and order; open stages can be
 * added and removed, the four the registration and Lost use are kept (renamed at most).
 */
export function EnquiryStagesEditor({
  initial,
  canEdit,
}: {
  initial: EnquiryStage[];
  canEdit: boolean;
}) {
  const [list, setList] = useState<Row[]>(() => initial.map((s) => ({ ...s, key: s.id })));
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const move = (i: number, by: -1 | 1) =>
    setList((cur) => {
      const j = i + by;
      if (j < 0 || j >= cur.length) return cur;
      const out = [...cur];
      [out[i], out[j]] = [out[j]!, out[i]!];
      return out;
    });
  return (
    <section className="ep-card ep-as__card" aria-labelledby="as-stages-lead">
      <h2 id="as-stages-lead" className="ep-as__h">
        Lead stages
      </h2>
      <p className="ep-field__help" style={{ margin: 0 }}>
        The columns of the enquiry board, in this order. A lead moves through the open stages by
        hand; &ldquo;started&rdquo;, &ldquo;registered&rdquo; and &ldquo;admitted&rdquo; follow the
        family&rsquo;s registration by themselves; Lost asks for a reason.
      </p>
      <ol className="ep-pe__list">
        {list.map((s, i) => (
          <li key={s.key} className="ep-as__cathead">
            <input
              className="ep-input"
              aria-label={`Stage ${String(i + 1)} name`}
              value={s.name}
              maxLength={60}
              disabled={!canEdit}
              onChange={(e) =>
                setList((cur) => cur.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
              }
            />
            <Badge tone={s.kind === 'open' ? 'info' : s.kind === 'lost' ? 'neutral' : 'success'}>
              {KIND[s.kind]}
            </Badge>
            {s.leads ? <span className="ep-kicker">{s.leads} leads</span> : null}
            {s.status === 'inactive' ? <Badge tone="neutral">Off</Badge> : null}
            {canEdit ? (
              <span className="ep-as__catacts">
                <button
                  type="button"
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  aria-label={`Move ${s.name} up`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  aria-label={`Move ${s.name} down`}
                  disabled={i === list.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
                {s.kind === 'open' ? (
                  <button
                    type="button"
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    aria-label={`Remove ${s.name}`}
                    onClick={() => setList((cur) => cur.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                ) : null}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
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
              setList((cur) => {
                // a new open stage goes before "Registration started"
                const at = cur.findIndex((x) => x.kind !== 'open');
                const row: Row = {
                  id: '',
                  code: '',
                  name: 'New stage',
                  kind: 'open',
                  status: 'active',
                  leads: 0,
                  key: `n${String(Date.now())}`,
                };
                return at < 0 ? [...cur, row] : [...cur.slice(0, at), row, ...cur.slice(at)];
              })
            }
          >
            Add a stage
          </button>
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await saveEnquiryStages(
                  list.map(({ id, name, kind, status }) => ({
                    ...(id ? { id } : {}),
                    name,
                    kind,
                    status,
                  })),
                );
                if (r.ok) {
                  setList(r.data.map((s) => ({ ...s, key: s.id })));
                  setMsg({ tone: 'success', text: 'Stages saved.' });
                } else setMsg({ tone: 'danger', text: r.error });
              })
            }
          >
            Save stages
          </button>
        </div>
      ) : null}
    </section>
  );
}
