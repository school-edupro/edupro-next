'use client';
import { useEffect, useRef, useState } from 'react';

const read = (form: HTMLFormElement, name: string) => {
  const el = form.elements.namedItem(name);
  return el instanceof HTMLInputElement && el.value !== '' ? Number(el.value) : null;
};

/**
 * A figure worked out from two boxes of the same form as they are typed (docs/design/66): attendance %
 * (days present of working days) or BMI (weight in kg, height in cm).
 */
export function LiveCalc({
  kind,
  a,
  b,
  initial,
}: {
  kind: 'pct' | 'bmi';
  /** the box names: days present and working days, or weight and height */
  a: string;
  b: string;
  initial: string;
}) {
  const span = useRef<HTMLSpanElement>(null);
  const [text, setText] = useState(initial);
  useEffect(() => {
    const form = span.current?.closest('form');
    if (!form) return;
    const work = (e: Event) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement) || (el.name !== a && el.name !== b)) return;
      const x = read(form, a);
      const y = read(form, b);
      if (x === null || !y) return setText('');
      const v = kind === 'pct' ? (x * 100) / y : x / ((y / 100) * (y / 100));
      setText(Number.isFinite(v) ? String(Math.round(v * 10) / 10) : '');
    };
    form.addEventListener('input', work);
    return () => form.removeEventListener('input', work);
  }, [a, b, kind]);
  return <span ref={span}>{text}</span>;
}
