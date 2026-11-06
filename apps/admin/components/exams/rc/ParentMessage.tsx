import { Badge, Card } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';

/** GET /exams/report-cards/releases/:id/parent-message (docs/design/81) */
export interface ParentMessageData {
  sample: { name: string; class: string } | null;
  told: number;
  channels: Array<{
    channel: 'email' | 'sms';
    templateId: string | null;
    state: 'ready' | 'off' | 'needs_dlt';
    format: 'text' | 'html';
    subject: string | null;
    body: string;
  }>;
}

const TONE = { ready: 'success', off: 'neutral', needs_dlt: 'warning' } as const;

/**
 * The release's "Message to parents" (docs/design/81): what the families get when a class is published —
 * the e-mail as it arrives (a sandboxed frame), the SMS's words — each with whether it goes out, filled
 * for a pupil of the release; the wording is edited under Communication → Templates.
 */
export async function ParentMessage({
  data,
  canOpenTemplates,
}: {
  data: ParentMessageData;
  /** comms.template.view: the "Edit the template" links */
  canOpenTemplates: boolean;
}) {
  const t = await getTranslations('rcRelease');
  return (
    <Card elevated title={t('pmTitle')} style={{ marginTop: 'var(--sp-4)' }}>
      <p style={{ marginTop: 0 }}>{t('pmIntro', { told: data.told })}</p>
      <p className="ep-field__help">
        {data.sample
          ? t('pmFor', { name: data.sample.name, cls: data.sample.class })
          : t('pmSample')}
      </p>
      {data.channels.map((c) => {
        const label = c.channel === 'email' ? t('pmEmail') : t('pmSms');
        return (
          <section
            key={c.channel}
            aria-labelledby={`pm-${c.channel}`}
            style={{ marginTop: 'var(--sp-4)' }}
          >
            <h3 id={`pm-${c.channel}`} className="ep-cdash__h3" style={{ marginTop: 0 }}>
              {label} <Badge tone={TONE[c.state]}>{t(`pmState_${c.state}`)}</Badge>
            </h3>
            {c.subject ? (
              <p>
                <span className="ep-kicker">{t('pmSubject')}</span> <strong>{c.subject}</strong>
              </p>
            ) : null}
            {c.format === 'html' ? (
              <iframe
                className="ep-tpl__frame"
                title={t('pmFrame', { channel: label })}
                sandbox=""
                srcDoc={c.body}
              />
            ) : (
              <p className="ep-compose__text">{c.body}</p>
            )}
            <p className="ep-field__help">
              {c.templateId ? (
                canOpenTemplates ? (
                  <a href={`/comms/templates/${c.templateId}`}>{t('pmEdit', { channel: label })}</a>
                ) : (
                  t('pmEditWho')
                )
              ) : (
                t('pmFirstPublish')
              )}
            </p>
          </section>
        );
      })}
    </Card>
  );
}
