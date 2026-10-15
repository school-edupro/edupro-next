import { FeeReceiptSheet, type FeeReceipt } from '@edupro/ui';

export type Receipt = FeeReceipt;

/** The fee, hostel or misc receipt (shared with the parent app in @edupro/ui), with the school's logo. */
export function ReceiptCopy({ r, label }: { r: Receipt; label: string }) {
  const logo = r.letterhead?.logoFileId;
  return <FeeReceiptSheet r={r} label={label} logoSrc={logo ? `/api/files/${logo}/view` : null} />;
}
