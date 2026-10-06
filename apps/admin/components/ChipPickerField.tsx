'use client';
import { useState } from 'react';
import { ChipPicker, type ChipOption } from '@/components/ChipPicker';

/** A chip picker that keeps its own choices: for a form posted to a server action (hidden fields under `name`). */
export function ChipPickerField({
  name,
  label,
  options,
  initial = [],
  help,
}: {
  name: string;
  label: string;
  options: ChipOption[];
  initial?: string[];
  help?: string;
}) {
  const [value, setValue] = useState<string[]>(initial);
  return (
    <ChipPicker
      name={name}
      label={label}
      options={options}
      value={value}
      onChange={setValue}
      help={help}
    />
  );
}
