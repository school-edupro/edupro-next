'use client';
import { useEffect } from 'react';

/**
 * The header's menus (details.ep-hmenu) behave as menus: one open at a time, closed by a click outside or
 * Escape (focus back on its button); "/" anywhere outside a field puts the cursor in the search box.
 */
export function HeaderKeys() {
  useEffect(() => {
    const menus = () => [...document.querySelectorAll<HTMLDetailsElement>('details.ep-hmenu')];
    const onToggle = (e: Event) => {
      const d = e.target as HTMLDetailsElement;
      if (d.open) for (const m of menus()) if (m !== d) m.open = false;
    };
    const onClick = (e: MouseEvent) => {
      for (const m of menus()) if (m.open && !m.contains(e.target as Node)) m.open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        for (const m of menus())
          if (m.open) {
            m.open = false;
            m.querySelector('summary')?.focus();
          }
        return;
      }
      const el = e.target as HTMLElement | null;
      const typing =
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable);
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const box = document.querySelector<HTMLInputElement>('.ep-header__search-input');
        if (box) {
          e.preventDefault();
          box.focus();
        }
      }
    };
    for (const m of menus()) m.addEventListener('toggle', onToggle);
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      for (const m of menus()) m.removeEventListener('toggle', onToggle);
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  return null;
}
