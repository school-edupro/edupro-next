import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Checkbox } from './Checkbox';
import { InputField, SelectField } from './Field';
import { RadioGroup } from './Radio';
import { Switch } from './Switch';

const meta: Meta = { title: 'Forms/Fields', tags: ['autodocs'] };
export default meta;

export const Input: StoryObj = {
  render: () => <InputField id="code" label="Class code" required help="Short code such as VI" placeholder="VI" />,
};

export const InputWithError: StoryObj = {
  render: () => <InputField id="code2" label="Class code" required error="Class code already exists" defaultValue="VI" />,
};

export const Select: StoryObj = {
  render: () => (
    <SelectField
      id="board"
      label="Board"
      options={[
        { value: 'CBSE', label: 'CBSE' },
        { value: 'ICSE', label: 'ICSE' },
        { value: 'STATE', label: 'State board' },
      ]}
    />
  ),
};

export const CheckboxStory: StoryObj = {
  name: 'Checkbox',
  render: () => <Checkbox id="consent" label="Parent has given consent" help="Recorded with timestamp and IP" />,
};

export const Radios: StoryObj = {
  render: () => (
    <RadioGroup
      name="lateFee"
      legend="Late fee mode"
      defaultValue="daywise"
      options={[
        { value: 'daywise', label: 'Day-wise', help: 'Per day after the due date' },
        { value: 'slab', label: 'Slab-wise', help: 'Fixed amounts after each slab date' },
      ]}
    />
  ),
};

export const SwitchStory: StoryObj = {
  name: 'Switch',
  render: function Render() {
    const [on, setOn] = useState(true);
    return <Switch id="sms" label="Send absent SMS" checked={on} onChange={setOn} help="Uses the DLT template" />;
  },
};
