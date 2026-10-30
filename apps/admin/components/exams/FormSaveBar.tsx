'use client';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The Save bar of a sheet saved as a form (docs/design/66): it stays at the foot of the screen, says
 * whether anything is unsaved, and asks before the page is left with unsaved changes (choosing another
 * section included). Put it inside the form, with the submit buttons as its children.
 */
export function FormSaveBar({ children, note }: { children: ReactNode; note?: ReactNode }) {
  const t = useTranslations('examHub.setup');
  const bar = useRef<HTMLDivElement>(null);
  const leaving = useRef(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    const form = bar.current?.closest('form');
    if (!form) return;
    const mark = () => setDirty(true);
    const sent = () => {
      leaving.current = true;
      setDirty(false);
    };
    form.addEventListener('input', mark);
    form.addEventListener('change', mark);
    form.addEventListener('submit', sent);
    return () => {
      form.removeEventListener('input', mark);
      form.removeEventListener('change', mark);
      form.removeEventListener('submit', sent);
    };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    leaving.current = false;
    const warn = (e: BeforeUnloadEvent) => {
      if (!leaving.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  return (
    <div ref={bar} className="ep-savebar">
      <p className="ep-savebar__status" data-dirty={dirty ? 'true' : 'false'} role="status">
        {dirty ? t('dirty') : t('clean')}
        {note ? <> · {note}</> : null}
      </p>
      <div className="ep-savebar__actions">{children}</div>
    </div>
  );
}
