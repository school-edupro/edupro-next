export interface TemplateStatus {
  code: string;
  channel: string;
  name: string;
  active: boolean;
  ready: boolean;
}
const CHANNELS: Array<[string, string]> = [
  ['sms', 'SMS'],
  ['whatsapp', 'WhatsApp'],
  ['email', 'Email'],
];

/**
 * The "Message templates" block of a module's set-up: which of its messages can go out on SMS, WhatsApp
 * and email. A message goes out on a channel only when its template is ready (SMS needs the DLT template
 * id, WhatsApp the approved template name); the wording and those ids are kept under Communication →
 * Templates. A module whose emails have a built-in design says so in the Email column.
 */
export function MessageTemplates({
  templates,
  search,
  builtInEmail,
}: {
  templates: TemplateStatus[];
  /** What to search for under Communication → Templates. */
  search: string;
  /** This module's emails are designed in the product (details card, QR, PDF), not from a template. */
  builtInEmail?: string;
}) {
  const names = new Map<string, string>();
  for (const t of templates) if (!names.has(t.code)) names.set(t.code, t.name);
  return (
    <section
      className="ep-card"
      aria-labelledby={`mt-${search}`}
      style={{ marginTop: 'var(--sp-4)' }}
    >
      <h2 id={`mt-${search}`} className="ep-cdash__h3" style={{ marginTop: 0 }}>
        Message templates
      </h2>
      <p className="ep-field__help">
        A message goes out on a channel only when its template is ready: SMS needs the DLT template
        id, WhatsApp the approved template name. Edit the wording and add these under Communication
        → Templates (search “{search}”). The school’s own SMS, WhatsApp and mail gateways under
        Communication → Providers send them.
      </p>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Message templates">
        <table className="ep-table ep-table--dense">
          <caption className="ep-sr-only">Which messages are ready per channel</caption>
          <thead>
            <tr>
              <th scope="col">Message</th>
              {CHANNELS.map(([ch, label]) => (
                <th key={ch} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...names.entries()].map(([code, name]) => (
              <tr key={code}>
                <th scope="row">{name}</th>
                {CHANNELS.map(([ch]) => {
                  const t = templates.find((x) => x.code === code && x.channel === ch);
                  return (
                    <td key={ch}>
                      {!t
                        ? ch === 'email' && builtInEmail
                          ? builtInEmail
                          : '—'
                        : t.ready
                          ? 'Ready'
                          : t.active
                            ? ch === 'sms'
                              ? 'Needs the DLT id'
                              : 'Needs the approved name'
                            : 'Switched off'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        <a
          className="ep-btn ep-btn--secondary ep-btn--sm"
          href={`/comms/templates?q=${encodeURIComponent(search)}`}
        >
          Open the templates
        </a>
      </p>
    </section>
  );
}
