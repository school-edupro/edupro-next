import { getTranslations } from 'next-intl/server';

export const AREAS = ['marks', 'indicators', 'remarks', 'attendance', 'health'] as const;

/** The areas an exam (or an exam type) takes, as ticks named `areas` (docs/design/66). */
export async function AreaTicks({
  idPrefix,
  value,
  disabled,
}: {
  idPrefix: string;
  value: string[];
  disabled?: boolean;
}) {
  const t = await getTranslations('examHub.areas');
  return (
    <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="ep-field__label">{t('legend')}</legend>
      <div style={{ display: 'flex', gap: 'var(--sp-2) var(--sp-4)', flexWrap: 'wrap' }}>
        {AREAS.map((a) => (
          <label key={a} className="ep-check" htmlFor={`${idPrefix}-${a}`}>
            <input
              id={`${idPrefix}-${a}`}
              className="ep-check__input"
              type="checkbox"
              name="areas"
              value={a}
              defaultChecked={value.includes(a)}
              disabled={disabled}
            />
            <span className="ep-check__box" aria-hidden="true" /> {t(a)}
          </label>
        ))}
      </div>
      <span className="ep-field__help">{t('help')}</span>
    </fieldset>
  );
}

/** "Marks · Remarks", or "Everything" when the exam takes every area. */
export async function areaWords(areas: string[]): Promise<string> {
  const t = await getTranslations('examHub.areas');
  return areas.length === AREAS.length
    ? t('all')
    : AREAS.filter((a) => areas.includes(a))
        .map((a) => t(a))
        .join(' · ');
}
