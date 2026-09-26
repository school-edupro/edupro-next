import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './Button';

const meta: Meta<typeof Button> = {
  title: 'Core/Button',
  component: Button,
  tags: ['autodocs'],
  args: { children: 'Save changes' },
};
export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = {};
export const Accent: Story = { args: { variant: 'accent', children: 'Collect fee' } };
export const Secondary: Story = { args: { variant: 'secondary', children: 'Cancel' } };
export const Ghost: Story = { args: { variant: 'ghost', children: 'View audit' } };
export const Danger: Story = { args: { variant: 'danger', children: 'Reverse receipt' } };
export const Small: Story = { args: { size: 'sm', children: 'Edit' } };
export const Loading: Story = { args: { loading: true, children: 'Posting' } };
export const Disabled: Story = { args: { disabled: true } };
