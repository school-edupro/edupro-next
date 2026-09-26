import type { Meta, StoryObj } from '@storybook/react';
import { Alert } from './Alert';
import { Badge, toneForStatus } from './Badge';
import { Breadcrumbs } from './Breadcrumbs';
import { Button } from './Button';
import { Card } from './Card';
import { DataTable } from './DataTable';
import { KpiTile } from './KpiTile';
import { PageHeader } from './PageHeader';
import { Tabs } from './Tabs';

const meta: Meta = { title: 'Layout/Page anatomy', tags: ['autodocs'] };
export default meta;

const rows = [
  { id: '1', code: 'VI', name: 'Class VI', status: 'active', students: 148 },
  { id: '2', code: 'VII', name: 'Class VII', status: 'active', students: 152 },
  { id: '3', code: 'XII', name: 'Class XII', status: 'inactive', students: 0 },
];

export const ListPage: StoryObj = {
  render: () => (
    <div style={{ padding: 'var(--sp-5)', background: 'var(--surface-subtle)' }}>
      <Breadcrumbs items={[{ label: 'Academics', href: '#' }, { label: 'Classes' }]} />
      <PageHeader kicker="Academics" title="Classes and sections" description="Master classes for this school." actions={<Button>New class</Button>} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--sp-4)', marginBottom: 'var(--sp-5)' }}>
        <KpiTile label="Classes" value={12} />
        <KpiTile label="Sections" value={38} delta={{ text: '+2 this year', tone: 'success' }} />
        <KpiTile label="Students" value="1,942" hint="Active enrolments" />
      </div>
      <Alert tone="info" title="Year 2026-27 is active">
        Sections are defined per academic year. Switch the year in the header to see previous sessions.
      </Alert>
      <Card style={{ marginTop: 'var(--sp-4)' }}>
        <Tabs
          ariaLabel="Class views"
          items={[
            {
              id: 'list',
              label: 'List',
              content: (
                <DataTable
                  columns={[
                    { key: 'code', header: 'Code', render: (r) => <strong>{r.code}</strong> },
                    { key: 'name', header: 'Name', render: (r) => r.name },
                    { key: 'students', header: 'Students', numeric: true, render: (r) => r.students },
                    { key: 'status', header: 'Status', render: (r) => <Badge tone={toneForStatus(r.status)}>{r.status}</Badge> },
                  ]}
                  rows={rows}
                  rowKey={(r) => r.id}
                />
              ),
            },
            { id: 'archived', label: 'Archived', content: <p>No archived classes.</p> },
          ]}
        />
      </Card>
    </div>
  ),
};
