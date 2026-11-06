import { Badge, Card } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { ConfirmAction } from '@/components/ConfirmAction';
import { tellParents } from '@/lib/report-card-actions';

interface ChannelCount {
  told: number;
  waiting: number;
  noAddress: number;
}
interface Counts {
  pupils: number;
  held: number;
  withheld: number;
  email: ChannelCount;
  sms: ChannelCount;
}

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
  /** docs/design/82: per published class, who is told and who waits, by channel */
  classes: Array<Counts & { classId: string; code: string }>;
  total: Counts;
}

const TONE = { ready: 'success', off: 'neutral', needs_dlt: 'warning' } as const;

/**
 * The release's "Message to parents" (docs/design/81, 82): publishing sends nothing; here the principal
 * sends the message to the families of a published class (or every one) not told yet, on the channels
 * ticked, class by class with who is told and who waits. Below, the e-mail as it arrives (a sandboxed
 * frame) and the SMS's words, filled for a pupil of the release; the wording is edited under
 * Communication → Templates.
 */
export async function ParentMessage({
  data,
  releaseId,
  back,
  canSend,
  canOpenTemplates,
}: {
  data: ParentMessageData;
  releaseId: string;
  /** the Publish tab, to come back to */
  back: string;
  /** exams.result.publish: the Send buttons */
  canSend: boolean;
  /** comms.template.view: the "Edit the template" links */
  canOpenTemplates: boolean;
}) {
  const t = await getTranslations('rcRelease');
  const state = (ch: 'email' | 'sms') => data.channels.find((c) => c.channel === ch)?.state;
  const ticks = (k: Counts) => [
    {
      value: 'email',
      label:
        state('email') === 'off'
          ? t('pmTickOff', { channel: t('pmEmail') })
          : k.email.waiting
            ? t('pmTickEmail', { n: k.email.waiting })
            : t('pmTickNone', { channel: t('pmEmail'), told: k.email.told }),
      disabled: state('email') !== 'ready' || !k.email.waiting,
      checked: true,
    },
    {
      value: 'sms',
      label:
        state('sms') === 'off'
          ? t('pmTickOff', { channel: t('pmSms') })
          : state('sms') === 'needs_dlt'
            ? t('pmTickSmsDlt')
            : k.sms.waiting
              ? t('pmTickSms', { n: k.sms.waiting })
              : t('pmTickNone', { channel: t('pmSms'), told: k.sms.told }),
      disabled: state('sms') !== 'ready' || !k.sms.waiting,
      checked: true,
    },
  ];
  const sendable = (k: Counts) => ticks(k).some((x) => !x.disabled);
  // nothing to send now: who still waits on a channel that is not ready (the SMS without its DLT id)
  const blocked = (k: Counts) => {
    const wait = (['email', 'sms'] as const).filter((ch) => k[ch].waiting && state(ch) !== 'ready');
    return wait.length
      ? wait
          .map((ch) =>
            t('pmWaitsOn', {
              n: k[ch].waiting,
              channel: ch === 'email' ? t('pmEmail') : t('pmSms'),
              why: state(ch) === 'needs_dlt' ? t('pmWhyDlt') : t('pmWhyOff'),
            }),
          )
          .join(' ')
      : t('pmAllTold');
  };
  const send = (k: Counts, classId: string | null, what: string, label: string) => (
    <ConfirmAction
      action={tellParents}
      fields={{ id: releaseId, back, ...(classId ? { classId } : {}) }}
      label={label}
      title={t('pmSendTitle', { what })}
      confirmLabel={t('pmSendConfirm')}
      variant={classId ? 'secondary' : 'primary'}
      choices={{ name: 'channels', legend: t('pmChannels'), items: ticks(k) }}
      blocked={sendable(k) ? undefined : blocked(k)}
    >
      {t('pmSendBody')}
    </ConfirmAction>
  );
  const cell = (c: ChannelCount, none: string) => (
    <>
      {t('pmToldWaiting', { told: c.told, waiting: c.waiting })}
      {c.noAddress ? <span className="ep-mr-col__desc">{none}</span> : null}
    </>
  );
  return (
    <Card elevated title={t('pmTitle')} style={{ marginTop: 'var(--sp-4)' }}>
      <p style={{ marginTop: 0 }}>{t('pmIntro', { told: data.told })}</p>
      {data.classes.length ? (
        <>
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label={t('pmClassesCaption')}
          >
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">{t('pmClassesCaption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('pmClass')}</th>
                  <th scope="col">{t('pmPupils')}</th>
                  <th scope="col">{t('pmEmailCol')}</th>
                  <th scope="col">{t('pmSmsCol')}</th>
                  {canSend ? (
                    <th scope="col">
                      <span className="ep-sr-only">{t('actions')}</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {data.classes.map((k) => (
                  <tr key={k.classId}>
                    <th scope="row">{k.code}</th>
                    <td>
                      {k.pupils}
                      {k.held || k.withheld ? (
                        <span className="ep-mr-col__desc">
                          {t('pmHeld', { held: k.held, fee: k.withheld })}
                        </span>
                      ) : null}
                    </td>
                    <td>{cell(k.email, t('pmNoEmail', { n: k.email.noAddress }))}</td>
                    <td>{cell(k.sms, t('pmNoMobile', { n: k.sms.noAddress }))}</td>
                    {canSend ? (
                      <td>{send(k, k.classId, k.code, t('pmSendClass', { cls: k.code }))}</td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* a div: the Send button is a form (not allowed inside a paragraph) */}
          <div style={{ margin: 'var(--sp-3) 0' }}>
            {!canSend
              ? t('pmSendWho')
              : sendable(data.total)
                ? data.classes.length > 1
                  ? send(data.total, null, t('pmEvery'), t('pmSendAll'))
                  : null
                : blocked(data.total)}
          </div>
        </>
      ) : (
        <p className="ep-field__help">{t('pmNoClass')}</p>
      )}
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
