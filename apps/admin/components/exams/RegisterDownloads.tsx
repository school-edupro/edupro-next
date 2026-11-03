'use client';
import { Dialog } from '@edupro/ui';
import { useEffect, useState } from 'react';

type Paper = 'A4' | 'A3' | 'Legal' | 'Letter';
const KEY = 'edupro:register-paper';

/**
 * A register's downloads (docs/design/68): PDF or Excel of what is on screen, or of every section; a
 * PDF first asks the paper, which way round and "fit to page width" (remembered on this computer).
 */
export function RegisterDownloads({
  id,
  place = '',
  view = 'marks',
  exam = null,
  subject = null,
  report = 'register',
  extra = {},
  target,
}: {
  id?: string;
  place?: string;
  view?: string;
  exam?: string | null;
  subject?: string | null;
  /** a report instead of the register (docs/design/68, phase 2) */
  report?: string;
  extra?: Record<string, string>;
  /** another register's files (docs/design/69): the route, what is shown, and what "all sections" sets */
  target?: { path: string; query: Record<string, string>; all: Record<string, string> };
}) {
  const [open, setOpen] = useState<null | 'one' | 'all'>(null);
  const [paper, setPaper] = useState<Paper>('Legal');
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape');
  const [fit, setFit] = useState(true);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as {
        paper?: Paper;
        orientation?: 'landscape' | 'portrait';
        fit?: boolean;
      } | null;
      if (saved?.paper) setPaper(saved.paper);
      if (saved?.orientation) setOrientation(saved.orientation);
      if (typeof saved?.fit === 'boolean') setFit(saved.fit);
    } catch {
      /* no saved choice */
    }
  }, []);
  const where = place ? place.replace(':', '') : 'first';
  const file = (format: 'pdf' | 'xlsx', all: boolean, more: Record<string, string> = {}) => {
    if (target)
      return `${target.path}/${format}?${new URLSearchParams({
        ...target.query,
        ...(all ? target.all : {}),
        ...more,
      }).toString()}`;
    const q = new URLSearchParams({
      ...(exam ? { exam } : {}),
      ...(subject ? { subject } : {}),
      ...(all ? { all: '1' } : {}),
      ...(report !== 'register' ? { report } : {}),
      ...extra,
      ...more,
    });
    return `/api/exam-register/${id ?? ''}/${format}/${where}/${view}?${q.toString()}`;
  };
  const print = () => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ paper, orientation, fit }));
    } catch {
      /* not remembered */
    }
    window.open(
      file('pdf', open === 'all', { paper, orientation, fit: fit ? '1' : '0' }),
      '_blank',
      'noopener',
    );
    setOpen(null);
  };
  return (
    <>
      <details className="ep-mr-menu">
        <summary className="ep-btn ep-btn--secondary ep-btn--sm">Download ▾</summary>
        <div className="ep-mr-menu__list">
          <button type="button" onClick={() => setOpen('one')}>
            PDF
          </button>
          <a href={file('xlsx', false)}>Excel</a>
          <button type="button" onClick={() => setOpen('all')}>
            All sections · PDF (a section a page)
          </button>
          <a href={file('xlsx', true)}>All sections · Excel</a>
        </div>
      </details>
      <Dialog
        open={open !== null}
        title="PDF print settings"
        onClose={() => setOpen(null)}
        size="sm"
        primary={{ label: 'Print', onClick: print }}
      >
        <label className="ep-field">
          <span className="ep-field__label">Paper size</span>
          <select
            className="ep-select"
            data-native
            value={paper}
            onChange={(e) => setPaper(e.target.value as Paper)}
          >
            <option value="A4">A4</option>
            <option value="A3">A3</option>
            <option value="Legal">Legal</option>
            <option value="Letter">Letter</option>
          </select>
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Orientation</span>
          <select
            className="ep-select"
            data-native
            value={orientation}
            onChange={(e) => setOrientation(e.target.value as 'landscape' | 'portrait')}
          >
            <option value="landscape">Landscape</option>
            <option value="portrait">Portrait</option>
          </select>
        </label>
        <label className="ep-check">
          <input
            className="ep-check__input"
            type="checkbox"
            checked={fit}
            onChange={(e) => setFit(e.target.checked)}
          />
          <span className="ep-check__box" aria-hidden="true" /> Fit to page width (smaller letters
          for a wide register)
        </label>
      </Dialog>
    </>
  );
}
