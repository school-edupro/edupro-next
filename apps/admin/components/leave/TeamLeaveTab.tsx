import { TeamLeaveTab as Shared } from '@edupro/ui';
import type { ComponentProps } from 'react';
import { FileLinks } from '@/components/FileLinks';
import { decideLeave, decideLeaveCancel } from '@/lib/leave-actions';

/** Reporties Leave (docs/design/85), shared with the staff website (docs/design/99): the admin's actions. */
export function TeamLeaveTab(p: Omit<ComponentProps<typeof Shared>, 'actions' | 'fileLink'>) {
  return (
    <Shared
      {...p}
      actions={{ decide: decideLeave, decideCancel: decideLeaveCancel }}
      fileLink={(id, label) => <FileLinks href={`/api/files/${id}/download`} label={label} />}
    />
  );
}
