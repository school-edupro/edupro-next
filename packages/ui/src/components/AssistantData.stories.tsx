import type { Meta, StoryObj } from '@storybook/react';
import { expect, within } from '@storybook/test';
import { AssistantCard, type AssistantCardView } from './AssistantChat';

/**
 * docs/design/103: a data question's answer in the chatbot — the title, how it was worked out, figures, sentences, a
 * chart and the table. Made-up figures.
 */
const meta: Meta = {
  title: 'Chatbot/Data answer',
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};
export default meta;

const byClass: AssistantCardView = {
  kind: 'data',
  title: 'Fee collected by class',
  explain: 'From fee receipts that were not reversed or bounced, totalled by class.',
  figures: [
    { label: 'Collected', value: '₹4,82,300' },
    { label: 'Classes', value: '4' },
  ],
  text: ['Class VII collected the most (₹1,62,100).', 'Class VIII collected the least (₹58,000).'],
  chart: { type: 'bar', x: 'class', y: ['collected'] },
  columns: [
    { key: 'class', label: 'Class', type: 'text' },
    { key: 'collected', label: 'Collected', type: 'money' },
  ],
  rows: [
    { class: 'Class VI', collected: 148200 },
    { class: 'Class VII', collected: 162100 },
    { class: 'Class VIII', collected: 58000 },
    { class: 'Class IX', collected: 114000 },
  ],
  more: 0,
  checked: false,
};

/** Bars: one number per class. */
export const ByClass: StoryObj = {
  render: () => (
    <div style={{ maxWidth: 560 }}>
      <AssistantCard card={byClass} lang="en" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('Fee collected by class')).toBeInTheDocument();
    await expect(c.getByText('₹4,82,300')).toBeInTheDocument();
    await expect(c.getByText('Class VII collected the most (₹1,62,100).')).toBeInTheDocument();
    await expect(c.getByRole('table')).toBeInTheDocument();
    await expect(canvasElement.querySelector('svg')).not.toBeNull();
  },
};

/** A line over months, from a checked question (no AI model). */
export const MonthlyChecked: StoryObj = {
  render: () => (
    <div style={{ maxWidth: 560 }}>
      <AssistantCard
        lang="en"
        card={{
          kind: 'data',
          title: 'Absent pupils by month',
          explain: 'From day registers only; leave is not absence.',
          figures: [{ label: 'Most absent', value: 'Jul 2026' }],
          text: [],
          chart: { type: 'line', x: 'month', y: ['absent'] },
          columns: [
            { key: 'month', label: 'Month', type: 'date' },
            { key: 'absent', label: 'Absent', type: 'number' },
          ],
          rows: [
            { month: '2026-06-01', absent: 120 },
            { month: '2026-07-01', absent: 164 },
            { month: '2026-08-01', absent: 98 },
          ],
          more: 0,
          checked: true,
        }}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('From a checked question')).toBeInTheDocument();
  },
};

/** No rows: says so, no chart, no table. */
export const NoRecords: StoryObj = {
  render: () => (
    <AssistantCard
      lang="hi"
      card={{ ...byClass, rows: [], figures: [], text: [], title: 'शुल्क' }}
    />
  ),
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('इस प्रश्न से कोई अभिलेख नहीं मिला।'),
    ).toBeInTheDocument();
    await expect(canvasElement.querySelector('svg')).toBeNull();
  },
};
