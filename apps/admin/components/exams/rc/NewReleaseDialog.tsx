'use client';
import { Button, Dialog } from '@edupro/ui';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { createRelease } from '@/lib/report-card-actions';
import { CARD_KINDS } from '@/lib/report-card-release';

/** an exam's code as a card code: capitals, digits and _ only, at most 12 */
const codeOf = (examCode: string) =>
  examCode
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 12);

/**
 * A new report card in one dialog (docs/design/65): its kind (an exam card such as PT1, a term card or
 * an annual card), its code and name, the exams whose marks it carries, and the fee-due rule; the design
 * of each class is set on the next screen. An exam card takes its code and name from the first exam
 * ticked until they are typed.
 */
export function NewReleaseDialog({
  exams,
  openAtStart,
}: {
  exams: Array<{ id: string; code: string; name: string }>;
  openAtStart: boolean;
}) {
  const t = useTranslations('rcRelease');
  const [open, setOpen] = useState(openAtStart);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<(typeof CARD_KINDS)[number]>('term');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [typed, setTyped] = useState({ code: false, name: false });
  const form = useRef<HTMLFormElement>(null);
  const tick = (id: string, on: boolean) => {
    if (kind !== 'exam' || !on) return;
    const e = exams.find((x) => x.id === id);
    if (!e) return;
    if (!typed.code && !code) setCode(codeOf(e.code));
    if (!typed.name && !name) setName(e.name);
  };
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {t('newRelease')}
      </Button>
      <Dialog
        open={open}
        title={t('newTitle')}
        onClose={() => setOpen(false)}
        size="lg"
        primary={{
          label: t('makeRelease'),
          loading: busy,
          onClick: () => {
            if (!form.current?.reportValidity()) return;
            setBusy(true);
            form.current.requestSubmit();
          },
        }}
      >
        <form ref={form} action={createRelease} className="ep-rcw-setup">
          <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="ep-field__label">{t('kindReq')}</legend>
            <div className="ep-mr-tiles">
              {CARD_KINDS.map((k) => (
                <label key={k} className="ep-mr-tile">
                  <input
                    type="radio"
                    name="kind"
                    value={k}
                    checked={kind === k}
                    onChange={() => setKind(k)}
                  />
                  <span>
                    {t(`kind_${k}`)}
                    <small>{t(`kindHelp_${k}`)}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="ep-rcw-pair">
            <label className="ep-field">
              <span className="ep-field__label">{t('codeReq')}</span>
              <input
                className="ep-input"
                name="termCode"
                required
                pattern="[A-Za-z0-9_]{1,12}"
                placeholder={t(`codePlaceholder_${kind}`)}
                maxLength={12}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setTyped((x) => ({ ...x, code: true }));
                }}
              />
              <span className="ep-field__help">{t(`codeHelp_${kind}`)}</span>
            </label>
            <label className="ep-field">
              <span className="ep-field__label">{t('nameReq')}</span>
              <input
                className="ep-input"
                name="name"
                required
                minLength={2}
                maxLength={120}
                placeholder={t(`namePlaceholder_${kind}`)}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setTyped((x) => ({ ...x, name: true }));
                }}
              />
            </label>
          </div>
          <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="ep-field__label">{t('examsCarryReq')}</legend>
            <div className="ep-mr-tiles">
              {exams.map((e) => (
                <label key={e.id} className="ep-mr-tile">
                  <input
                    type="checkbox"
                    name="examIds"
                    value={e.id}
                    onChange={(ev) => tick(e.id, ev.target.checked)}
                  />
                  <span>
                    {e.code}
                    <small>{e.name}</small>
                  </span>
                </label>
              ))}
            </div>
            <span className="ep-field__help">{t(`examsHelp_${kind}`)}</span>
          </fieldset>
          <div className="ep-rcw-setup__fee">
            <label className="ep-check">
              <input className="ep-check__input" type="checkbox" name="hideDefaulters" />
              <span className="ep-check__box" aria-hidden="true" /> {t('hideDefaulters')}
            </label>
            <label className="ep-field">
              <span className="ep-field__label">{t('feeAbove')}</span>
              <input
                className="ep-input"
                name="defaulterMin"
                type="number"
                min={0}
                step={1}
                defaultValue={0}
              />
            </label>
          </div>
        </form>
      </Dialog>
    </>
  );
}
