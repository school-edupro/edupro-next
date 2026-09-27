import {
  Badge,
  Button,
  Card,
  DataTable,
  InputField,
  PageHeader,
  SelectField,
  toneForStatus,
} from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { createCampus, updateSchool } from '@/lib/actions';
import { apiFetch } from '@/lib/api';
import type { Campus, School } from '@/lib/types';

export default async function SchoolPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const school = await apiFetch<School>('/platform/school');
  return (
    <>
      <PageHeader
        kicker="System"
        title="School profile"
        description={`${school.code} · ${school.board}`}
      />
      <Notice params={sp} />
      <Card title="Profile">
        <form
          action={updateSchool}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 'var(--sp-4)',
            alignItems: 'end',
          }}
        >
          <InputField id="s-name" name="name" label="Name" required defaultValue={school.name} />
          <InputField
            id="s-short"
            name="shortName"
            label="Short name"
            defaultValue={school.shortName ?? ''}
          />
          <InputField
            id="s-aff"
            name="affiliationNo"
            label="Affiliation number"
            defaultValue={school.affiliationNo ?? ''}
          />
          <SelectField
            id="s-board"
            name="board"
            label="Board"
            defaultValue={school.board}
            options={['CBSE', 'ICSE', 'STATE', 'IB', 'OTHER'].map((b) => ({ value: b, label: b }))}
          />
          <InputField id="s-tz" name="timezone" label="Timezone" defaultValue={school.timezone} />
          <InputField id="s-locale" name="locale" label="Locale" defaultValue={school.locale} />
          <div>
            <Button type="submit">Save profile</Button>
          </div>
        </form>
      </Card>
      <Card title="Campuses" style={{ marginTop: 'var(--sp-5)' }}>
        <DataTable<Campus>
          caption="Campuses"
          columns={[
            { key: 'code', header: 'Code', render: (c) => <strong>{c.code}</strong> },
            { key: 'name', header: 'Name', render: (c) => c.name },
            {
              key: 'geo',
              header: 'Location',
              render: (c) => (c.geo ? `${c.geo.lat}, ${c.geo.lng}` : ''),
            },
            {
              key: 'status',
              header: 'Status',
              render: (c) => <Badge tone={toneForStatus(c.status)}>{c.status}</Badge>,
            },
          ]}
          rows={school.campuses}
          rowKey={(c) => c.id}
        />
        <form
          action={createCampus}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 'var(--sp-4)',
            alignItems: 'end',
            marginTop: 'var(--sp-4)',
          }}
        >
          <InputField
            id="c-code"
            name="code"
            label="Campus code"
            required
            placeholder="ANNEX"
            pattern="[A-Za-z0-9_-]{1,20}"
          />
          <InputField id="c-name" name="name" label="Campus name" required />
          <div>
            <Button type="submit" variant="secondary">
              Add campus
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
