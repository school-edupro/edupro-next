import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { Drawer } from './Drawer';
import { ToastProvider, useToast } from './Toast';

const meta: Meta = { title: 'Feedback/Overlays', tags: ['autodocs'] };
export default meta;

export const ConfirmDialog: StoryObj = {
  render: function Render() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button variant="danger" onClick={() => setOpen(true)}>
          Reverse receipt
        </Button>
        <Dialog
          open={open}
          title="Reverse receipt TF/FY2026-27/000012?"
          onClose={() => setOpen(false)}
          primary={{ label: 'Reverse', variant: 'danger', onClick: () => setOpen(false) }}
        >
          The receipt will be marked reversed and the demand reopened. This is recorded in the audit log and cannot be undone.
        </Dialog>
      </>
    );
  },
};

export const SideDrawer: StoryObj = {
  render: function Render() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Open student
        </Button>
        <Drawer open={open} title="Aarav Sharma, VI-A" onClose={() => setOpen(false)} footer={<Button onClick={() => setOpen(false)}>Done</Button>}>
          <p>Detail panels keep the list behind them visible.</p>
        </Drawer>
      </>
    );
  },
};

function ToastDemo() {
  const toast = useToast();
  return (
    <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
      <Button variant="secondary" onClick={() => toast.push('success', 'Receipt posted', 'TF/FY2026-27/000013')}>
        Success
      </Button>
      <Button variant="secondary" onClick={() => toast.push('warning', 'Year locks in 2 days')}>
        Warning
      </Button>
      <Button variant="secondary" onClick={() => toast.push('danger', 'Payment gateway unreachable', 'Retry in a minute')}>
        Danger
      </Button>
    </div>
  );
}

export const Toasts: StoryObj = {
  render: () => (
    <ToastProvider>
      <ToastDemo />
    </ToastProvider>
  ),
};
