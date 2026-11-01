'use client';
import { Button, Dialog } from '@edupro/ui';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { createRelease } from '@/lib/report-card-actions';

/**
 * A new term release in one dialog (docs/design/65): the term and its name, the exams whose marks the
 * cards carry, and the fee-due rule; the template of each class is set on the next screen.
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
  const form = useRef<HTMLFormElement>(null);
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
          <div className="ep-rp__row">
            <label className="ep-field">
              <span className="ep-field__label">{t('term')}</span>
              <input
                className="ep-input"
                name="termCode"
                required
                pattern="[A-Za-z0-9_]{1,12}"
                placeholder="T1"
                maxLength={12}
              />
              <span className="ep-field__help">{t('termHelp')}</span>
            </label>
            <label className="ep-field">
              <span className="ep-field__label">{t('nameReq')}</span>
              <input
                className="ep-input"
                name="name"
                required
                minLength={2}
                maxLength={120}
                placeholder="Term I (2026-27)"
              />
            </label>
          </div>
          <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="ep-field__label">{t('examsCarryReq')}</legend>
            <div className="ep-mr-tiles">
              {exams.map((e) => (
                <label key={e.id} className="ep-mr-tile">
                  <input type="checkbox" name="examIds" value={e.id} />
                  <span>
                    {e.code}
                    <small>{e.name}</small>
                  </span>
                </label>
              ))}
            </div>
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
