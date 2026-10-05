import type { ReactNode } from 'react';

export interface SheetSection {
  title: string;
  rows: Array<[string, string | null | undefined]>;
}

/**
 * One clinic record on screen the way its printed card reads: the school band, who it is about with the
 * key facts on one line, the findings section by section in two columns, the remarks and the signature.
 * Empty values and empty sections are left out.
 */
export function RecordSheet({
  school,
  doc,
  name,
  badge,
  facts,
  sections,
  children,
  remarksTitle,
  remarks,
  attention = false,
  attentionText,
  signedBy,
  signLabel = 'Signature',
  note,
}: {
  school: string;
  /** What this document is, under the school name. */
  doc: string;
  name: string;
  badge?: ReactNode;
  facts: Array<[string, string | null | undefined]>;
  sections: SheetSection[];
  /** Extra blocks between the sections and the remarks (a medicines table, a form). */
  children?: ReactNode;
  remarksTitle?: string;
  remarks?: string | null;
  attention?: boolean;
  attentionText?: string;
  signedBy?: string | null;
  signLabel?: string;
  note?: string | null;
}) {
  return (
    <article className="ep-sheet">
      <header className="ep-sheet__band">
        <p className="ep-sheet__school">{school}</p>
        <p className="ep-sheet__doc">{doc}</p>
      </header>
      <div className="ep-sheet__body">
        <div className="ep-sheet__who">
          <h2 className="ep-sheet__name">{name}</h2>
          {badge}
        </div>
        <dl className="ep-sheet__facts">
          {facts
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
        </dl>
        {sections
          .map((s) => ({ ...s, rows: s.rows.filter(([, v]) => v && String(v).trim()) }))
          .filter((s) => s.rows.length)
          .map((s) => (
            <section key={s.title} className="ep-sheet__sec" aria-label={s.title}>
              <h3>{s.title}</h3>
              <dl className="ep-sheet__grid">
                {s.rows.map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        {children}
        {remarks ? (
          <section
            className="ep-sheet__sec ep-sheet__remarks"
            data-attention={attention ? 'true' : 'false'}
            aria-label={remarksTitle ?? 'Remarks'}
          >
            <h3>{remarksTitle ?? 'Remarks'}</h3>
            <p>{remarks}</p>
            {attention && attentionText ? (
              <p>
                <strong>{attentionText}</strong>
              </p>
            ) : null}
          </section>
        ) : null}
        {signedBy || note ? (
          <footer className="ep-sheet__foot">
            <span>{note ?? ''}</span>
            {signedBy ? (
              <span className="ep-sheet__sign">
                <strong>{signedBy}</strong>
                {signLabel}
              </span>
            ) : null}
          </footer>
        ) : null}
      </div>
    </article>
  );
}
