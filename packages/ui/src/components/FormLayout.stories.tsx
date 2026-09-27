import type { Meta, StoryObj } from '@storybook/react';
import { expect, within } from '@storybook/test';
import { Button } from './Button';
import { InputField, SelectField } from './Field';
import { FormActions, FormRow, FormSection } from './FormLayout';

const meta: Meta = {
  title: 'Layout/FormLayout',
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};
export default meta;

export const StudentForm: StoryObj = {
  render: () => (
    <form onSubmit={(e) => e.preventDefault()} style={{ maxWidth: 880 }}>
      <FormSection
        title="Identity"
        description="Admission number is unique per school and cannot change later."
      >
        <FormRow columns={3}>
          <InputField id="adm" label="Admission no" required defaultValue="A1042" />
          <InputField id="name" label="Full name" required />
          <InputField id="dob" label="Date of birth" type="date" />
        </FormRow>
        <FormRow columns={2}>
          <SelectField
            id="sec"
            label="Section"
            options={[
              { value: 'VI-A', label: 'VI-A' },
              { value: 'VI-B', label: 'VI-B' },
            ]}
          />
          <SelectField
            id="cat"
            label="Category"
            options={[
              { value: 'GEN', label: 'General' },
              { value: 'OBC', label: 'OBC' },
            ]}
          />
        </FormRow>
      </FormSection>
      <FormSection title="Guardian">
        <FormRow columns={2}>
          <InputField id="gname" label="Guardian name" />
          <InputField id="gmobile" label="Mobile" pattern="[6-9][0-9]{9}" help="10 digits" />
        </FormRow>
      </FormSection>
      <FormActions align="end">
        <Button type="button" variant="secondary">
          Cancel
        </Button>
        <Button type="submit">Save student</Button>
      </FormActions>
    </form>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('group', { name: 'Identity' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Save student' })).toBeInTheDocument();
  },
};

export const DenseRows: StoryObj = {
  render: () => (
    <FormSection title="Fee heads">
      <FormRow columns={4}>
        <InputField id="h1" label="Tuition" type="number" defaultValue="12000" />
        <InputField id="h2" label="Transport" type="number" defaultValue="3000" />
        <InputField id="h3" label="Library" type="number" defaultValue="500" />
        <InputField id="h4" label="Lab" type="number" defaultValue="800" />
      </FormRow>
    </FormSection>
  ),
};
