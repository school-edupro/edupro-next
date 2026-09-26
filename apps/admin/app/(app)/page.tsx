import { Card, PageHeader } from '@edupro/ui';
import { getMe } from '@/lib/api';

export default async function DashboardPage() {
  const me = await getMe();
  const school = me.memberships.find((m) => m.schoolId === me.school?.id);
  return (
    <>
      <PageHeader kicker="Overview" title={`Welcome, ${me.user.displayName}`} description={school ? school.schoolName : 'Select a school to begin'} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--sp-4)' }}>
        <Card elevated>
          <div className="ep-kpi">
            <span className="ep-kpi__value">{me.memberships.length}</span>
            <span className="ep-kpi__label">Schools</span>
          </div>
        </Card>
        <Card elevated>
          <div className="ep-kpi">
            <span className="ep-kpi__value">{me.permissions.length}</span>
            <span className="ep-kpi__label">Permissions</span>
          </div>
        </Card>
        <Card elevated>
          <div className="ep-kpi">
            <span className="ep-kpi__value">{me.academicYear ? 'Active' : 'None'}</span>
            <span className="ep-kpi__label">Academic year</span>
          </div>
        </Card>
      </div>
      <Card title="Sprint 0 foundation" style={{ marginTop: 'var(--sp-5)' }}>
        <p>
          You are signed in through the BFF with a school and year context. Navigation on the left is generated from your
          effective permissions. Module screens arrive sprint by sprint; the first is Classes and sections.
        </p>
      </Card>
    </>
  );
}
