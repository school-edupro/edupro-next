import { Card, PageHeader } from '@edupro/ui';
import { getMe } from '@/lib/api';

export default async function DashboardPage() {
  const me = await getMe();
  const school = me.memberships.find((m) => m.schoolId === me.school?.id);
  return (
    <>
      <PageHeader
        kicker="Overview"
        title={`Welcome, ${me.user.displayName}`}
        description={school ? school.schoolName : 'Select a school to begin'}
      />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 'var(--sp-4)',
        }}
      >
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
      <Card title="Administration" style={{ marginTop: 'var(--sp-5)' }}>
        <p>
          Navigation on the left is generated from your effective permissions. Sprint 2 adds role
          administration, assignments with data scopes, delegations, members, years, settings and
          the school profile. Module screens follow sprint by sprint.
        </p>
      </Card>
    </>
  );
}
