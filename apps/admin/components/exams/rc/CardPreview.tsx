'use client';
import { Badge, Button, Drawer } from '@edupro/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { holdInline } from '@/lib/report-card-actions';

export interface PreviewStudent {
  id: string;
  name: string;
  heldReason: string | null;
}

/**
 * The cards of the students chosen on a Cards line in a wide side panel (docs/design/65): the card as it
 * prints, the previous and next student without leaving it, print, open in a new tab, and Hold / Show
 * again with a reason (the families of a held card do not see it).
 */
export function CardPreview({
  releaseId,
  students: given,
  open,
  onClose,
  canHold,
}: {
  releaseId: string;
  students: PreviewStudent[];
  open: boolean;
  onClose: () => void;
  canHold: boolean;
}) {
  const t = useTranslations('rcRelease');
  const [students, setStudents] = useState(given);
  const [i, setI] = useState(0);
  const [holding, setHolding] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (open) {
      setStudents(given);
      setI(0);
      setHolding(false);
      setError(null);
    }
  }, [open, given]);
  const s = students[i];
  const src = s
    ? `/api/report-cards/preview?releaseId=${releaseId}&studentId=${s.id}`
    : 'about:blank';
  const go = (n: number) => {
    setI(n);
    setHolding(false);
    setReason('');
    setError(null);
  };
  const hold = async (held: boolean) => {
    if (!s) return;
    if (held && reason.trim().length < 3) {
      setError(t('holdReasonShort'));
      return;
    }
    setBusy(true);
    const r = await holdInline(releaseId, s.id, held, held ? reason : '');
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setStudents((xs) =>
      xs.map((x) => (x.id === s.id ? { ...x, heldReason: held ? reason.trim() : null } : x)),
    );
    setHolding(false);
    setReason('');
    setError(null);
  };
  return (
    <Drawer
      open={open}
      title={s ? t('position', { name: s.name, i: i + 1, n: students.length }) : t('preview')}
      onClose={onClose}
      width="xl"
      footer={
        <div className="ep-rcw-panel-foot">
          {canHold && s ? (
            <div className="ep-rcw-panel-hold" role="group" aria-label={t('holdGroup')}>
              {s.heldReason ? (
                <>
                  <Badge tone="warning">{t('heldBadge', { reason: s.heldReason })}</Badge>
                  <Button size="sm" variant="ghost" loading={busy} onClick={() => void hold(false)}>
                    {t('showAgain')}
                  </Button>
                </>
              ) : holding ? (
                <>
                  <label className="ep-sr-only" htmlFor="rcw-hold-reason">
                    {t('holdReason')}
                  </label>
                  <input
                    id="rcw-hold-reason"
                    className="ep-input"
                    value={reason}
                    maxLength={300}
                    placeholder={t('holdPlaceholder')}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <Button size="sm" loading={busy} onClick={() => void hold(true)}>
                    {t('holdConfirm')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setHolding(false)}>
                    {t('cancel')}
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setHolding(true)}>
                  {t('hold')}
                </Button>
              )}
              {error ? (
                <span className="ep-field__error" role="alert">
                  {error}
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="ep-rcw-panel-nav">
            <Button variant="secondary" size="sm" disabled={i === 0} onClick={() => go(i - 1)}>
              {t('prev')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={i >= students.length - 1}
              onClick={() => go(i + 1)}
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
          </div>
        </div>
      }
    >
      {open && s ? (
        <iframe
          ref={frame}
          className="ep-rcw-preview"
          title={t('frameTitle', { name: s.name })}
          src={src}
        />
      ) : null}
    </Drawer>
  );
}
