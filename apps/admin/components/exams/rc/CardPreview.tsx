'use client';
import { Button, Drawer } from '@edupro/ui';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

/**
 * A student's report card in a wide side panel (docs/design/65): the card as it prints, the previous and
 * next student of the list without leaving it, print, and open in a new tab.
 */
export function CardPreview({
  releaseId,
  students,
  at,
}: {
  releaseId: string;
  students: Array<{ id: string; name: string }>;
  at: number;
}) {
  const t = useTranslations('rcRelease');
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(at);
  const frame = useRef<HTMLIFrameElement>(null);
  const s = students[i];
  const src = s
    ? `/api/report-cards/preview?releaseId=${releaseId}&studentId=${s.id}`
    : 'about:blank';
  return (
    <>
      <button
        type="button"
        className="ep-btn ep-btn--ghost ep-btn--sm"
        onClick={() => {
          setI(at);
          setOpen(true);
        }}
        aria-label={t('previewOf', { name: students[at]?.name ?? '' })}
      >
        {t('preview')}
      </button>
      <Drawer
        open={open}
        title={s ? t('position', { name: s.name, i: i + 1, n: students.length }) : t('preview')}
        onClose={() => setOpen(false)}
        width="xl"
        footer={
          <span style={{ display: 'flex', gap: 'var(--sp-2)', width: '100%' }}>
            <Button
              variant="secondary"
              size="sm"
              disabled={i === 0}
              onClick={() => setI((n) => n - 1)}
            >
              {t('prev')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={i >= students.length - 1}
              onClick={() => setI((n) => n + 1)}
            >
              {t('next')}
            </Button>
            <span style={{ flex: 1 }} />
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={src}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('newTab')}
            </a>
            <Button size="sm" onClick={() => frame.current?.contentWindow?.print()}>
              {t('print')}
            </Button>
          </span>
        }
      >
        {open ? (
          <iframe
            ref={frame}
            className="ep-rcw-preview"
            title={t('frameTitle', { name: s?.name ?? '' })}
            src={src}
          />
        ) : null}
      </Drawer>
    </>
  );
}
