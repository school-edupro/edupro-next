'use client';
import { Button } from '@edupro/ui';

/** Opens the browser's print box; the page is laid out as a print sheet. */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button type="button" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
