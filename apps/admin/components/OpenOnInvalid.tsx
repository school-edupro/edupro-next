'use client';
import { useEffect } from 'react';

/**
 * A form whose parts fold away: when the browser stops a save at a field inside a closed part (a required name, a
 * number out of range), the part opens so the field and its message show instead of nothing happening.
 */
export function OpenOnInvalid({ formId }: { formId: string }) {
  useEffect(() => {
    const form = document.getElementById(formId);
    if (!form) return;
    const open = (e: Event) => {
      let el = (e.target as HTMLElement | null)?.parentElement ?? null;
      while (el && el !== form) {
        if (el instanceof HTMLDetailsElement) el.open = true;
        el = el.parentElement;
      }
    };
    form.addEventListener('invalid', open, true);
    return () => form.removeEventListener('invalid', open, true);
  }, [formId]);
  return null;
}
