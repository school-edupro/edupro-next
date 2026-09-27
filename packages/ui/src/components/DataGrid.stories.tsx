import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, within } from '@storybook/test';
import { Badge } from './Badge';
import { DataGrid } from './DataGrid';

interface Student {
  id: string;
  admissionNo: string;
  name: string;
  section: string;
  feeDue: number;
  status: 'active' | 'inactive';
}

const rows: Student[] = Array.from({ length: 57 }, (_, i) => ({
  id: String(i + 1),
  admissionNo: `A${String(1000 + i)}`,
  name:
    ['Aarav Sharma', 'Diya Patel', 'Ishaan Verma', 'Kavya Nair', 'Rohan Gupta', 'Ananya Iyer'][
      i % 6
    ]! + (i >= 6 ? ` ${i}` : ''),
  section: ['VI-A', 'VI-B', 'VII-A'][i % 3]!,
  feeDue: (i * 1375) % 12000,
  status: i % 7 === 0 ? 'inactive' : 'active',
}));

const meta: Meta<typeof DataGrid<Student>> = {
  title: 'Data/DataGrid',
  component: DataGrid<Student>,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    id: 'students-story',
    caption: 'Students',
    rows,
    rowKey: (r: Student) => r.id,
    pageSize: 10,
    columns: [
      { key: 'admissionNo', header: 'Admission no' },
      { key: 'name', header: 'Name' },
      { key: 'section', header: 'Section' },
      {
        key: 'feeDue',
        header: 'Fee due',
        numeric: true,
        render: (r: Student) => `₹${r.feeDue.toLocaleString('en-IN')}`,
      },
      {
        key: 'status',
        header: 'Status',
        render: (r: Student) => (
          <Badge tone={r.status === 'active' ? 'success' : 'danger'}>{r.status}</Badge>
        ),
      },
      { key: 'id', header: 'Internal id', hidden: true },
    ],
  },
};
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const SortsWhenAHeaderIsPressed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const header = await canvas.findByRole('button', { name: /fee due/i });
    await userEvent.click(header);
    const firstCell = canvasElement.querySelectorAll('tbody tr')[0]?.querySelectorAll('td')[3];
    await expect(firstCell?.textContent).toBe('₹0');
    await userEvent.click(header);
    const firstDesc = canvasElement.querySelectorAll('tbody tr')[0]?.querySelectorAll('td')[3];
    await expect(firstDesc?.textContent).not.toBe('₹0');
    const th = canvasElement.querySelectorAll('thead th')[3];
    await expect(th?.getAttribute('aria-sort')).toBe('descending');
  },
};

export const FiltersAsYouType: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('searchbox', { name: /search students/i }), 'Kavya');
    await expect(canvas.getByText(/rows? \(filtered from 57\)/)).toBeInTheDocument();
    await expect(canvasElement.querySelectorAll('tbody tr').length).toBeLessThan(11);
  },
};

export const ColumnChooserHidesAndShows: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvasElement.querySelectorAll('thead th').length).toBe(5);
    await userEvent.click(canvas.getByText('Columns'));
    await userEvent.click(canvas.getByLabelText('Section'));
    await expect(canvasElement.querySelectorAll('thead th').length).toBe(4);
    await userEvent.click(canvas.getByLabelText('Internal id'));
    await expect(canvasElement.querySelectorAll('thead th').length).toBe(5);
  },
};

export const DenseMode: Story = {
  args: { density: 'dense' },
};

export const Empty: Story = {
  args: { rows: [], emptyTitle: 'No students yet', emptyHint: <p>Admissions open on 1 April.</p> },
};
