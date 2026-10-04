import { Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { RideForm } from '@/components/transport/RideForm';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { applyTransport } from '../actions';

interface Options {
  settings: { oneWayPercent: number; twoStopRule: 'higher' | 'pick' | 'sum' };
  routes: Array<{
    id: string;
    code: string;
    name: string;
    vehicle: string | null;
    stops: Array<{
      id: string;
      name: string;
      pickupTime: string | null;
      dropTime: string | null;
      slab: string | null;
      amount: number | null;
    }>;
  }>;
  months: string[];
  thisMonth: string;
  riding: boolean;
  students: Array<{ id: string; name: string; section: string | null }>;
  canApply: boolean;
}

/**
 * A guardian asks for school transport, a step at a time: which child, then the service (pick, drop or
 * both), the route and the stoppage (which brings the slab and the monthly charge) and the months.
 */
export default async function ApplyTransportPage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  const wanted = /^\d+$/.test(sp.student ?? '') ? sp.student! : '';
  let options: Options;
  try {
    options = await bff.api.fetch<Options>(
      `/transport/requests/mine/options${wanted ? `?studentId=${wanted}` : ''}`,
    );
    if (!wanted && options.students.length === 1)
      options = await bff.api.fetch<Options>(
        `/transport/requests/mine/options?studentId=${options.students[0]!.id}`,
      );
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && (error.status === 403 || error.status === 404))
      redirect('/transport');
    throw error;
  }
  const student =
    options.students.find((s) => s.id === wanted) ??
    (options.students.length === 1 ? options.students[0]! : null);
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'School bus')}
        title={t(lang, 'Transport request')}
        description={t(
          lang,
          'The transport in-charge and then the fee department approve the request. The transport fee follows the approval.',
        )}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/transport">
            {t(lang, 'Back to transport')}
          </a>
        }
      />
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail || sp.error}
        </div>
      ) : null}
      {!options.canApply ? (
        <Card>
          {t(lang, 'Please ask the transport office to make this request for your child.')}
        </Card>
      ) : (
        <>
          <Card title={`1. ${t(lang, 'Child')}`} style={{ marginBottom: 'var(--sp-3)' }}>
            <div className="ep-choices">
              {options.students.map((s) => (
                <a
                  key={s.id}
                  className="ep-choice"
                  href={`/transport/apply?student=${s.id}`}
                  aria-current={student?.id === s.id ? 'true' : undefined}
                >
                  <strong>{s.name}</strong>
                  <span>{s.section ?? ''}</span>
                </a>
              ))}
            </div>
          </Card>
          {student ? (
            <Card title={`2. ${t(lang, 'Service, stoppage and months')}`}>
              {options.routes.length === 0 ? (
                <p className="ep-field__help" style={{ margin: 0 }}>
                  {t(lang, 'The school has not published its bus routes yet.')}
                </p>
              ) : (
                <RideForm
                  action={applyTransport}
                  studentId={student.id}
                  returnTo=""
                  routes={options.routes}
                  months={options.months}
                  thisMonth={options.thisMonth}
                  settings={options.settings}
                  riding={options.riding}
                  submitLabel={t(lang, 'Send request')}
                />
              )}
            </Card>
          ) : null}
        </>
      )}
    </main>
  );
}
