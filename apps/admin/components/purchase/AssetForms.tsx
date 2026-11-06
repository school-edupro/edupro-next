'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { moveAsset, saveAsset } from '@/lib/purchase-actions';
import { ASSET_CONDITION, type AssetDetail, type AssetLists } from '@/lib/purchase';

/** An asset's details: make, model, serial, place, condition, the day put to use, warranty, insurance. */
export function AssetEditForm({ asset }: { asset: AssetDetail }) {
  const router = useRouter();
  const [v, setV] = useState({
    description: asset.description ?? '',
    make: asset.make ?? '',
    model: asset.model ?? '',
    serialNo: asset.serialNo ?? '',
    location: asset.location ?? '',
    condition: asset.condition,
    putToUseOn: asset.putToUseOn ?? '',
    warrantyUntil: asset.warrantyUntil ?? '',
    insurer: asset.insurer ?? '',
    policyNo: asset.policyNo ?? '',
    insuredValue: asset.insuredValue === null ? '' : String(asset.insuredValue),
    insuranceRenewal: asset.insuranceRenewal ?? '',
    note: asset.note ?? '',
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const field = (k: keyof typeof v, label: string, type = 'text', max = 120) => (
    <label className="ep-field" htmlFor={`ae-${k}`}>
      <span className="ep-field__label">{label}</span>
      <input
        id={`ae-${k}`}
        className="ep-input"
        type={type}
        maxLength={type === 'text' ? max : undefined}
        inputMode={k === 'insuredValue' ? 'decimal' : undefined}
        value={v[k]}
        onChange={(e) => setV({ ...v, [k]: e.target.value })}
      />
    </label>
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setMsg(null);
        const body = Object.fromEntries(
          Object.entries(v).map(([k, x]) => [k, x === '' ? null : x]),
        );
        start(async () => {
          const r = await saveAsset(asset.id, body);
          setMsg(r.ok ? { ok: true, text: 'Saved' } : { ok: false, text: r.error });
          if (r.ok) router.refresh();
        });
      }}
      noValidate
    >
      <div className="ep-form-row" data-columns="3">
        {field('description', 'Description', 'text', 300)}
        {field('make', 'Make', 'text', 80)}
        {field('model', 'Model', 'text', 80)}
        {field('serialNo', 'Serial number', 'text', 60)}
        {field('location', 'Room / place', 'text', 120)}
        <label className="ep-field" htmlFor="ae-condition">
          <span className="ep-field__label">Condition</span>
          <select
            id="ae-condition"
            className="ep-select"
            value={v.condition}
            onChange={(e) => setV({ ...v, condition: e.target.value as typeof v.condition })}
          >
            {Object.entries(ASSET_CONDITION).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        {field('putToUseOn', 'Put to use on', 'date')}
        {field('warrantyUntil', 'Warranty until', 'date')}
        {field('insurer', 'Insurer')}
        {field('policyNo', 'Policy number', 'text', 60)}
        {field('insuredValue', 'Insured value (₹)')}
        {field('insuranceRenewal', 'Insurance renewal', 'date')}
      </div>
      <label className="ep-field" htmlFor="ae-note">
        <span className="ep-field__label">Note</span>
        <input
          id="ae-note"
          className="ep-input"
          maxLength={1000}
          value={v.note}
          onChange={(e) => setV({ ...v, note: e.target.value })}
        />
      </label>
      {msg ? (
        <p
          className={msg.ok ? 'ep-alert ep-alert--success' : 'ep-alert ep-alert--danger'}
          role={msg.ok ? 'status' : 'alert'}
        >
          {msg.text}
        </p>
      ) : null}
      <div style={{ marginTop: 'var(--sp-3)' }}>
        <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm" disabled={pending}>
          Save the details
        </button>
      </div>
    </form>
  );
}

type Kind = 'custody' | 'repair_out' | 'repair_back' | 'lost' | 'found';
const KINDS: Record<Kind, string> = {
  custody: 'Change who keeps it, or where',
  repair_out: 'Sent for repair',
  repair_back: 'Back from repair',
  lost: 'Lost',
  found: 'Found',
};

/**
 * A movement of an asset: custody (department, place, custodian — waits for the new custodian's
 * acknowledgement when they sign in), repair out (vendor, when back) and back (cost), lost and found.
 */
export function AssetMoveForm({ asset, lists }: { asset: AssetDetail; lists: AssetLists }) {
  const router = useRouter();
  const choices = (Object.keys(KINDS) as Kind[]).filter((k) =>
    k === 'custody'
      ? asset.status === 'in_use'
      : k === 'repair_out' || k === 'lost'
        ? ['in_use', 'in_store'].includes(asset.status)
        : k === 'repair_back'
          ? asset.status === 'under_repair'
          : asset.status === 'lost',
  );
  const [kind, setKind] = useState<Kind>(choices[0] ?? 'lost');
  const [v, setV] = useState({
    departmentId: asset.departmentId ?? '',
    location: asset.location ?? '',
    custodianId: asset.custodianId ?? '',
    vendorId: '',
    expectedBack: '',
    cost: '',
    note: '',
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (!choices.length) return null;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setMsg(null);
        const body = {
          kind,
          note: v.note || undefined,
          ...(kind === 'custody'
            ? {
                departmentId: v.departmentId || null,
                location: v.location || undefined,
                custodianId: v.custodianId || null,
              }
            : {}),
          ...(kind === 'repair_out'
            ? { vendorId: v.vendorId || null, expectedBack: v.expectedBack || undefined }
            : {}),
          ...(kind === 'repair_back' ? { cost: v.cost || null } : {}),
        };
        start(async () => {
          const r = await moveAsset(asset.id, body);
          setMsg(r.ok ? { ok: true, text: r.detail ?? 'Recorded' } : { ok: false, text: r.error });
          if (r.ok) router.refresh();
        });
      }}
      noValidate
    >
      <div className="ep-form-row" data-columns="3">
        <label className="ep-field" htmlFor="am-kind">
          <span className="ep-field__label">What happened</span>
          <select
            id="am-kind"
            className="ep-select"
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
          >
            {choices.map((k) => (
              <option key={k} value={k}>
                {KINDS[k]}
              </option>
            ))}
          </select>
        </label>
        {kind === 'custody' ? (
          <>
            <label className="ep-field" htmlFor="am-dept">
              <span className="ep-field__label">Department</span>
              <select
                id="am-dept"
                className="ep-select"
                value={v.departmentId}
                onChange={(e) => setV({ ...v, departmentId: e.target.value })}
              >
                {lists.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field" htmlFor="am-cust">
              <span className="ep-field__label">Kept by</span>
              <select
                id="am-cust"
                className="ep-select"
                value={v.custodianId}
                onChange={(e) => setV({ ...v, custodianId: e.target.value })}
              >
                <option value="">Nobody in particular</option>
                {lists.staff.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ({x.code})
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field" htmlFor="am-loc">
              <span className="ep-field__label">Room / place</span>
              <input
                id="am-loc"
                className="ep-input"
                maxLength={120}
                value={v.location}
                onChange={(e) => setV({ ...v, location: e.target.value })}
              />
            </label>
          </>
        ) : null}
        {kind === 'repair_out' ? (
          <>
            <label className="ep-field" htmlFor="am-vendor">
              <span className="ep-field__label">Repairer</span>
              <select
                id="am-vendor"
                className="ep-select"
                value={v.vendorId}
                onChange={(e) => setV({ ...v, vendorId: e.target.value })}
              >
                <option value="">Not a listed vendor</option>
                {lists.vendors.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field" htmlFor="am-back">
              <span className="ep-field__label">Expected back</span>
              <input
                id="am-back"
                type="date"
                className="ep-input"
                value={v.expectedBack}
                onChange={(e) => setV({ ...v, expectedBack: e.target.value })}
              />
            </label>
          </>
        ) : null}
        {kind === 'repair_back' ? (
          <label className="ep-field" htmlFor="am-cost">
            <span className="ep-field__label">Repair cost (₹)</span>
            <input
              id="am-cost"
              className="ep-input"
              inputMode="decimal"
              value={v.cost}
              onChange={(e) => setV({ ...v, cost: e.target.value })}
            />
          </label>
        ) : null}
        <label className="ep-field" htmlFor="am-note">
          <span
            className="ep-field__label"
            data-required={['lost', 'repair_out'].includes(kind) ? 'true' : undefined}
          >
            Note
          </span>
          <input
            id="am-note"
            className="ep-input"
            maxLength={500}
            value={v.note}
            onChange={(e) => setV({ ...v, note: e.target.value })}
          />
        </label>
      </div>
      {msg ? (
        <p
          className={msg.ok ? 'ep-alert ep-alert--success' : 'ep-alert ep-alert--danger'}
          role={msg.ok ? 'status' : 'alert'}
        >
          {msg.text}
        </p>
      ) : null}
      <div style={{ marginTop: 'var(--sp-3)' }}>
        <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm" disabled={pending}>
          Record it
        </button>
      </div>
    </form>
  );
}
