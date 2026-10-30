'use client';
import { useEffect, useRef } from 'react';

/**
 * Put inside a GET form: choosing another option or day sends the form at once, so what is on screen and
 * what the page shows below never drift apart (no need to press the button after each change).
 */
export function AutoSubmit() {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = marker.current?.closest('form');
    if (!form) return;
    const send = (e: Event) => {
      const el = e.target;
      if (el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && el.type === 'date'))
        if (form.checkValidity()) form.requestSubmit();
    };
    form.addEventListener('change', send);
    return () => form.removeEventListener('change', send);
  }, []);
  return <span ref={marker} hidden />;
}
