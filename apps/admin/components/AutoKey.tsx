'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * Fills a master's automatic key as the fields it is made of are picked (an item's code from its
 * category and sub-category: STAT-PAPER-0004). The user may type over it. A code left as filled is
 * sent blank, so the server gives the next free one at the moment of saving (someone else may have
 * taken this number meanwhile); a code typed by hand is kept.
 */
export function AutoKey({
  master,
  field,
  from,
}: {
  master: string;
  field: string;
  from: string[];
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [filled, setFilled] = useState('');
  const fromKey = from.join(',');
  useEffect(() => {
    const form = anchor.current?.closest('form');
    const box = form?.querySelector<HTMLInputElement>(`[name="f:${field}"]`);
    if (!form || !box) return;
    const keys = fromKey.split(',');
    let last = box.value.trim() === '' ? '' : null; // null: the form opened with a typed code
    let asked = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const typedByHand = () => box.value.trim() !== '' && box.value !== last;
    const refresh = () => {
      clearTimeout(timer);
      // a little later: a picker that clears another box (category → sub-category) has re-rendered
      timer = setTimeout(() => {
        if (typedByHand()) return;
        const parts = keys.map(
          (k) =>
            [k, form.querySelector<HTMLInputElement>(`[name="f:${k}"]`)?.value.trim() ?? ''] as [
              string,
              string,
            ],
        );
        const n = (asked += 1);
        const show = (value: string) => {
          box.value = value;
          last = value;
          setFilled(value);
        };
        if (!parts[0]?.[1]) {
          show('');
          return;
        }
        fetch(
          `/api/masters/${master}/next-key?${new URLSearchParams(parts.filter(([, v]) => v)).toString()}`,
        )
          .then(async (res) => (res.ok ? ((await res.json()) as { value: string | null }) : null))
          .then((r) => {
            // a later pick asked again, or the user typed meanwhile: leave it
            if (!r || n !== asked || typedByHand()) return;
            show(r.value ?? '');
          })
          .catch(() => {
            // the box stays as it is: an empty code is given on saving
          });
      }, 250);
    };
    const onEvent = (e: Event) => {
      const t = e.target as HTMLInputElement | null;
      if (!t) return;
      if (keys.some((k) => t.name === `f:${k}` || t.id === `f-${k}-parent`)) refresh();
      // the user emptied the code box: fill it again from the picks
      if (t === box && box.value.trim() === '') {
        last = '';
        refresh();
      }
    };
    form.addEventListener('input', onEvent);
    form.addEventListener('change', onEvent);
    if (last === '') refresh();
    return () => {
      form.removeEventListener('input', onEvent);
      form.removeEventListener('change', onEvent);
      clearTimeout(timer);
    };
  }, [master, field, fromKey]);
  return (
    <span ref={anchor} hidden>
      <input type="hidden" name="autokey_field" value={field} />
      <input type="hidden" name="autokey" value={filled} />
    </span>
  );
}
