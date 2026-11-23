import { MyLeaveTab as Shared } from '@edupro/ui';
import type { ComponentProps } from 'react';
import { FileLinks } from '@/components/FileLinks';
import { askCancelLeave, withdrawLeave } from '@/lib/leave-actions';

/** My Leave (docs/design/85), shared with the staff website (docs/design/99): the admin's actions and file links. */
export function MyLeaveTab(p: Omit<ComponentProps<typeof Shared>, 'actions' | 'fileLink'>) {
  return (
    <Shared
      {...p}
      actions={{ withdraw: withdrawLeave, askCancel: askCancelLeave }}
      fileLink={(id, label) => <FileLinks href={`/api/files/${id}/download`} label={label} />}
    />
  );
}
