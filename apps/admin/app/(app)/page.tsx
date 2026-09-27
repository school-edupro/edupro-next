import { Card, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { getMe } from '@/lib/api';

export default async function DashboardPage() {
  const [t, me] = await Promise.all([getTranslations('dashboard'), getMe()]);
  const school = me.memberships.find((m) => m.schoolId === me.school?.id);
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={t('welcome', { name: me.user.displayName })}
        description={school ? school.schoolName : t('selectSchool')}
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
            <span className="ep-kpi__label">{t('schools')}</span>
          </div>
        </Card>
        <Card elevated>
          <div className="ep-kpi">
            <span className="ep-kpi__value">{me.permissions.length}</span>
            <span className="ep-kpi__label">{t('permissions')}</span>
          </div>
        </Card>
        <Card elevated>
          <div className="ep-kpi">
            <span className="ep-kpi__value">{me.academicYear ? t('active') : t('none')}</span>
            <span className="ep-kpi__label">{t('academicYear')}</span>
          </div>
        </Card>
      </div>
      <Card title={t('adminTitle')} style={{ marginTop: 'var(--sp-5)' }}>
        <p>{t('adminText')}</p>
      </Card>
    </>
  );
}
