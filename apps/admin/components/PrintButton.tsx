'use client';
import { Button } from '@edupro/ui';

/** Opens the browser's print box for a page laid out as a print sheet. */
export function PrintButton({ label = 'Print' }: { label?: string }) {
  return (
    <Button type="button" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
