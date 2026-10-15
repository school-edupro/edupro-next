import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { FeeSetupNav } from '@/components/fees/FeeSetupNav';
import {
  GatewayEditor,
  type GatewayFields,
  type GatewayRow,
} from '@/components/fees/GatewayEditor';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { saveGateway, saveGatewayRoutes } from '@/lib/gateway-actions';

const FEES = [
  ['school', 'Regular (school) fee'],
  ['hostel', 'Hostel fee'],
  ['misc', 'Misc fee'],
  ['admission', 'Admission fee'],
] as const;
const API_PUBLIC = process.env.PUBLIC_API_URL ?? 'https://<your API address>';

/**
 * Fee setup -> Payment gateways (0142): the school admin sets up the school's PayU, CCAvenue, Razorpay,
 * SBI ePay and Atom accounts with their test or live keys (kept encrypted, never shown again) and picks
 * which gateways take each fee. With more than one for a fee, the parent chooses.
 */
export default async function GatewaysPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const can = me.permissions.includes('payments.gateway.manage');
  let data: { data: GatewayRow[]; fields: GatewayFields } | null = null;
  let problem: string | null = null;
  if (can)
    try {
      data = await apiFetch<{ data: GatewayRow[]; fields: GatewayFields }>('/payments/gateways');
    } catch (error) {
      problem =
        error instanceof ApiError && error.problem.type === 'mfa-required'
          ? 'Setting up gateways needs a fresh strong sign-in: sign in again (One Auth with the second step, or the emailed code after One Auth).'
          : 'The gateways could not be read.';
    }
  const rows = data?.data ?? [];
  return (
    <>
      <PageHeader
        kicker="Fees · Setup"
        title="Payment gateways"
        description="The school's own gateway accounts for online fee payment, with their test or live keys, and which fee each takes. Only the school admin sets these up."
      />
      <FeeSetupNav current="/fees/gateways" />
      <Notice params={sp} />
      {!can ? (
        <Card>Only the school admin sets up payment gateways.</Card>
      ) : problem || !data ? (
        <p className="ep-alert ep-alert--warning" role="alert">
          {problem}
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--sp-5)' }}>
          <Card title="Which gateway takes which fee">
            {rows.filter((g) => g.active).length === 0 ? (
              <p>Add a gateway below first.</p>
            ) : (
              <form action={saveGatewayRoutes} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
                <div
                  className="ep-table-wrap"
                  tabIndex={0}
                  role="region"
                  aria-label="Gateways by fee"
                >
                  <table className="ep-table ep-table--dense">
                    <caption className="ep-sr-only">Gateways by fee</caption>
                    <thead>
                      <tr>
                        <th scope="col">Fee</th>
                        {rows
                          .filter((g) => g.active)
                          .map((g) => (
                            <th key={g.id} scope="col">
                              {g.label}
                              <div className="ep-field__help">
                                {data!.fields[g.provider].name} ·{' '}
                                {g.mode === 'live' ? 'Live' : 'Test'}
                              </div>
                            </th>
                          ))}
                      </tr>
                    </thead>
                    <tbody>
                      {FEES.map(([l, label]) => (
                        <tr key={l}>
                          <th scope="row">{label}</th>
                          {rows
                            .filter((g) => g.active)
                            .map((g) => (
                              <td key={g.id}>
                                <input
                                  type="checkbox"
                                  name={`route.${l}`}
                                  value={g.id}
                                  defaultChecked={g.ledgers.includes(l)}
                                  aria-label={`${label} through ${g.label}`}
                                />
                              </td>
                            ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="ep-field__help">
                  A fee with more than one gateway lets the parent choose (in the order of the
                  columns). A fee with none cannot be paid online.
                </p>
                <div>
                  <Button type="submit">Save</Button>
                </div>
              </form>
            )}
          </Card>

          {rows.map((g) => (
            <Card
              key={g.id}
              title={`${g.label} · ${data!.fields[g.provider].name}`}
              actions={
                <span style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                  <Badge tone={g.mode === 'live' ? 'success' : 'warning'}>
                    {g.mode === 'live' ? 'Live' : 'Test'}
                  </Badge>
                  <Badge tone={g.active ? 'info' : 'neutral'}>{g.active ? 'In use' : 'Off'}</Badge>
                </span>
              }
            >
              <form action={saveGateway}>
                <GatewayEditor fields={data!.fields} row={g} canEdit />
                <p style={{ marginTop: 'var(--sp-3)' }}>
                  <Button type="submit" variant="secondary">
                    Save {g.label}
                  </Button>
                </p>
              </form>
              {g.provider === 'razorpay' || g.provider === 'payu' ? (
                <p className="ep-field__help">
                  Webhook address to give {data!.fields[g.provider].name}:{' '}
                  <code>{`${API_PUBLIC}/api/v1/payments/${g.provider}/webhook?gw=${g.id}`}</code>
                </p>
              ) : null}
            </Card>
          ))}

          <Card title="Add a gateway">
            <form action={saveGateway}>
              <GatewayEditor fields={data.fields} canEdit />
              <p style={{ marginTop: 'var(--sp-3)' }}>
                <Button type="submit">Add gateway</Button>
              </p>
            </form>
            <p className="ep-field__help">
              Start in Test mode with the gateway’s sandbox keys, pay a small amount, then switch to
              Live with the live keys. The return address is set by the system for each payment.
            </p>
          </Card>
        </div>
      )}
    </>
  );
}
