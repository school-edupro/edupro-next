'use client';
import { useEffect, useId, useState } from 'react';

export interface TourStep {
  title: string;
  body: string;
}
export interface TourLabels {
  show: string;
  next: string;
  back: string;
  done: string;
  skip: string;
  /** "{current} of {total}" already formatted by the server for the given numbers */
  stepOf: (current: number, total: number) => string;
}

const KEY = (id: string) => `edupro.tour.${id}`;

/**
 * Sprint 20: an in-app tour of the current screen. Opens on the first visit (remembered per browser in
 * localStorage) and replays from the header button. Plain dialog, keyboard reachable, no third-party
 * library; texts arrive translated from the server component that mounts it.
 */
export function Tour({
  id,
  steps,
  labels,
}: {
  id: string;
  steps: TourStep[];
  labels: Omit<TourLabels, 'stepOf'> & { stepOfTemplate: string };
}) {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const titleId = useId();
  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY(id))) setOpen(true);
    } catch {
      /* private mode: no auto-open */
    }
  }, [id]);
  if (steps.length === 0) return null;
  const close = () => {
    try {
      localStorage.setItem(KEY(id), new Date().toISOString());
    } catch {
      /* ignore */
    }
    setOpen(false);
    setI(0);
  };
  const step = steps[Math.min(i, steps.length - 1)]!;
  const last = i >= steps.length - 1;
  return (
    <>
      <button
        type="button"
        className="ep-header__icon-btn"
        onClick={() => {
          setI(0);
          setOpen(true);
        }}
        aria-label={labels.show}
        title={labels.show}
        data-tour-button={id}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5v.4" />
          <circle cx="12" cy="17" r=".6" fill="currentColor" />
        </svg>
      </button>
      {open ? (
        <div
          role="presentation"
          onClick={close}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 38, 93, 0.45)',
            zIndex: 60,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--sp-4)',
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
            }}
            className="ep-card ep-card--elevated"
            style={{ maxWidth: 480, width: '100%', padding: 'var(--sp-5)' }}
          >
            <div className="ep-kicker">
              {labels.stepOfTemplate
                .replace('{current}', String(i + 1))
                .replace('{total}', String(steps.length))}
            </div>
            <h2
              id={titleId}
              style={{ margin: 'var(--sp-1) 0 var(--sp-2)', fontSize: 'var(--fs-h3)' }}
            >
              {step.title}
            </h2>
            <p style={{ margin: '0 0 var(--sp-4)', color: 'var(--text-muted)' }}>{step.body}</p>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)' }}>
              <button type="button" className="ep-btn ep-btn--ghost ep-btn--sm" onClick={close}>
                {labels.skip}
              </button>
              <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
                {i > 0 ? (
                  <button
                    type="button"
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    onClick={() => setI(i - 1)}
                  >
                    {labels.back}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="ep-btn ep-btn--primary ep-btn--sm"
                  onClick={() => (last ? close() : setI(i + 1))}
                  autoFocus
                >
                  {last ? labels.done : labels.next}
                </button>
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
