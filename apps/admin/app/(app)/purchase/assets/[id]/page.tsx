import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { AssetEditForm, AssetMoveForm } from '@/components/purchase/AssetForms';
import { ApiError, apiFetch } from '@/lib/api';
import { ASSET_CONDITION, ASSET_STATUS, type AssetDetail, type AssetLists } from '@/lib/purchase';
import { acknowledgeAsset, cancelAssetMove } from '@/lib/purchase-actions';

const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(iso.length === 10 ? `${iso}T00:00:00+05:30` : iso))
    : '—';
const money = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const KIND: Record<string, string> = {
  received: 'Received',
  imported: 'Imported from the old register',
  issued: 'Issued',
  back_to_store: 'Back to the store',
  store_transfer: 'Store transfer',
  custody: 'Custody',
  repair_out: 'Sent for repair',
  repair_back: 'Back from repair',
  lost: 'Lost',
  found: 'Found',
  returned: 'Returned to the vendor',
  written_off: 'Written off',
  disposed: 'Disposed of',
};

/**
 * One asset (docs/design/84, part 9): its tag and QR label, where it came from and what it cost, its
 * book value year by year, where it is and who keeps it, warranty and insurance, every movement; the
 * office changes its details and records custody, repair, lost and found.
 */
export default async function AssetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const a = await apiFetch<AssetDetail>(`/purchase/assets/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const lists = a.can.move ? await apiFetch<AssetLists>('/purchase/asset-lists') : null;
  const st = ASSET_STATUS[a.status] ?? { label: a.statusLabel, tone: 'neutral' as const };
  const pending = a.movements.find((m) => m.status === 'pending');
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Purchase', href: '/purchase' },
          { label: 'Assets', href: '/purchase/assets' },
          { label: a.tag },
        ]}
      />
      <PageHeader
        kicker={`Purchase · Asset · ${a.category}`}
        title={a.tag}
        description={`${a.item}${a.serialNo ? ` · S/N ${a.serialNo}` : ''}`}
        actions={
          <FileLinks
            href={`/api/purchase/asset-labels?ids=${a.id}`}
            label={`QR label of ${a.tag}`}
          />
        }
      />
      <Notice params={sp} />
      <section className="ep-card" aria-labelledby="as-st">
        <h2 id="as-st" className="ep-card__title">
          Status <Badge tone={st.tone}>{st.label}</Badge>
        </h2>
        <dl className="ep-facts">
          <div>
            <dt>Where</dt>
            <dd>{[a.store ?? a.department, a.location].filter(Boolean).join(' · ') || '—'}</dd>
          </div>
          <div>
            <dt>Kept by</dt>
            <dd>{a.custodian ? `${a.custodian} (${a.custodianCode ?? ''})` : '—'}</dd>
          </div>
          <div>
            <dt>Cost · book value</dt>
            <dd>
              {money(a.cost)} · <strong>{money(a.bookValue)}</strong>
            </dd>
          </div>
          <div>
            <dt>Came from</dt>
            <dd>
              {a.receipt ? (
                <>
                  <a
                    href={`/purchase/receipts/${a.receiptId ?? ''}`}
                    style={{ textDecoration: 'underline' }}
                  >
                    {a.receipt}
                  </a>
                  {a.order ? ` · ${a.order}` : ''}
                  {a.vendor ? ` · ${a.vendor}` : ''}
                </>
              ) : (
                (a.sourceNote ?? '—')
              )}
            </dd>
          </div>
          <div>
            <dt>Acquired · put to use</dt>
            <dd>
              {when(a.acquiredOn)} · {when(a.putToUseOn)}
            </dd>
          </div>
          <div>
            <dt>Condition</dt>
            <dd>{ASSET_CONDITION[a.condition]}</dd>
          </div>
          <div>
            <dt>Warranty · insurance</dt>
            <dd>
              {a.warrantyUntil ? `until ${when(a.warrantyUntil)}` : 'no warranty noted'}
              {a.insurer
                ? ` · ${a.insurer}${a.policyNo ? ` ${a.policyNo}` : ''}${a.insuranceRenewal ? `, renew ${when(a.insuranceRenewal)}` : ''}`
                : ''}
            </dd>
          </div>
          {a.leftOn ? (
            <div>
              <dt>Off the books</dt>
              <dd>
                {when(a.leftOn)}
                {a.bookValueAtExit !== null ? ` at ${money(a.bookValueAtExit)}` : ''}
              </dd>
            </div>
          ) : null}
        </dl>
        {pending ? (
          <div
            style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'center' }}
          >
            <p style={{ margin: 0 }}>
              Waiting for {pending.toCustodian ?? 'the new custodian'} to acknowledge the custody
              change.
            </p>
            {a.can.acknowledge ? (
              <ConfirmAction
                action={acknowledgeAsset}
                fields={{ movementId: pending.id, assetId: a.id }}
                label="Acknowledge: I have it"
                title={`Take ${a.tag} into your care?`}
                confirmLabel="Acknowledge"
                variant="primary"
              >
                {`You confirm you have ${a.item} (${a.tag}).`}
              </ConfirmAction>
            ) : null}
            {a.can.acknowledgeOnPaper && !a.can.acknowledge ? (
              <>
                <ConfirmAction
                  action={acknowledgeAsset}
                  fields={{ movementId: pending.id, assetId: a.id, onPaper: '1' }}
                  label="Record the signed handover"
                  title="Record the signed handover?"
                  confirmLabel="Record it"
                  variant="secondary"
                  reason={{ label: 'Who signed for it' }}
                >
                  For a custodian who does not sign in: the handover they signed.
                </ConfirmAction>
                <ConfirmAction
                  action={cancelAssetMove}
                  fields={{ movementId: pending.id, assetId: a.id }}
                  label="Cancel the change"
                  title="Cancel the custody change?"
                  confirmLabel="Cancel it"
                  variant="ghost"
                >
                  It stays with whoever keeps it now.
                </ConfirmAction>
              </>
            ) : null}
          </div>
        ) : null}
      </section>

      {a.can.move && lists ? (
        <section className="ep-card" aria-labelledby="as-move">
          <h2 id="as-move" className="ep-card__title">
            Record a movement
          </h2>
          <p style={{ marginTop: 0 }} className="ep-field__help">
            Issues, returns, store transfers and write-offs are recorded by the store and by
            condemnation; these are the rest.
          </p>
          <AssetMoveForm asset={a} lists={lists} />
        </section>
      ) : null}

      {a.can.edit ? (
        <section className="ep-card" aria-labelledby="as-edit">
          <h2 id="as-edit" className="ep-card__title">
            Details
          </h2>
          <AssetEditForm asset={a} />
        </section>
      ) : null}

      {a.depreciation.length ? (
        <section className="ep-card" aria-labelledby="as-dep">
          <h2 id="as-dep" className="ep-card__title">
            Depreciation
          </h2>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="as-dep">
            <table className="ep-table">
              <thead>
                <tr>
                  <th scope="col">Year</th>
                  <th scope="col">Method</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Opening
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Depreciation
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Closing
                  </th>
                </tr>
              </thead>
              <tbody>
                {a.depreciation.map((d) => (
                  <tr key={d.fy}>
                    <td>
                      {d.fy}
                      <span className="ep-mr-col__desc">{d.days} days</span>
                    </td>
                    <td>{d.method === 'slm' ? 'Straight line' : 'Written-down value'}</td>
                    <td style={{ textAlign: 'right' }}>{money(d.opening)}</td>
                    <td style={{ textAlign: 'right' }}>{money(d.depreciation)}</td>
                    <td style={{ textAlign: 'right' }}>{money(d.closing)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="ep-card" aria-labelledby="as-moves">
        <h2 id="as-moves" className="ep-card__title">
          Movements
        </h2>
        <ul className="ep-purch-checks">
          {a.movements.map((m) => (
            <li key={m.id}>
              <strong>{KIND[m.kind] ?? m.kind}</strong> · {when(m.movedOn)}
              {m.doc ? ` · ${m.doc}` : ''}
              {m.toDepartment ? ` · to ${m.toDepartment}` : ''}
              {m.toStore ? ` · ${m.toStore}` : ''}
              {m.toLocation ? ` · ${m.toLocation}` : ''}
              {m.toCustodian ? ` · kept by ${m.toCustodian}` : ''}
              {m.vendor ? ` · ${m.vendor}` : ''}
              {m.cost !== null ? ` · ${money(m.cost)}` : ''}
              {m.note ? ` · ${m.note}` : ''}
              {m.by ? ` · by ${m.by}` : ''}
              {m.status === 'pending' ? (
                <>
                  {' '}
                  <Badge tone="warning">Waiting for acknowledgement</Badge>
                </>
              ) : null}
              {m.status === 'cancelled' ? (
                <>
                  {' '}
                  <Badge tone="neutral">Cancelled</Badge>
                </>
              ) : null}
              {m.acknowledgedAt ? ` · acknowledged by ${m.acknowledgedBy ?? ''}` : ''}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
