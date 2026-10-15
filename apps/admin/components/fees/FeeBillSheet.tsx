import { FeeBillSheet as Sheet, type FeeBillView } from '@edupro/ui';

export type { FeeBillView };

/** The annual fee bill (in @edupro/ui, shared with the parent portal) with the admin's logo address. */
export function FeeBillSheet({ b }: { b: FeeBillView }) {
  const logo = b.letterhead.logoFileId;
  return <Sheet b={b} logoSrc={logo ? `/api/files/${logo}/view` : null} />;
}
