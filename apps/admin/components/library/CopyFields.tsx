'use client';
import { FormRow, InputField, SelectField } from '@edupro/ui';
import type { BookSetup } from '@/lib/library-books';

/** A copy's fields as the form holds them (text until sent). */
export interface CopyState {
  libraryId: string;
  count: string;
  typed: boolean;
  accessionNos: string;
  accessionedOn: string;
  shelfId: string;
  rack: string;
  barcode: string;
  acquisition: '' | 'Purchase' | 'Donation';
  vendorId: string;
  donor: string;
  billNo: string;
  billDate: string;
  poNo: string;
  price: string;
  remarks: string;
}

const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export function emptyCopy(setup: BookSetup): CopyState {
  return {
    libraryId: setup.libraries[0]?.id ?? '',
    count: '1',
    typed: false,
    accessionNos: '',
    accessionedOn: today(),
    shelfId: '',
    rack: '',
    barcode: '',
    acquisition: 'Purchase',
    vendorId: '',
    donor: '',
    billNo: '',
    billDate: '',
    poNo: '',
    price: '',
    remarks: '',
  };
}

/** What the API takes: empty answers left out; new copies carry the count or the numbers typed. */
export function copyPayload(s: CopyState, mode: 'new' | 'edit') {
  const out: Record<string, unknown> = { libraryId: s.libraryId };
  const put = (k: string, v: string) => {
    if (v.trim()) out[k] = v.trim();
  };
  put('accessionedOn', s.accessionedOn);
  put('shelfId', s.shelfId);
  if (s.shelfId) put('rack', s.rack);
  put('barcode', s.barcode);
  if (s.acquisition) out.acquisition = s.acquisition;
  if (s.acquisition === 'Purchase') {
    put('vendorId', s.vendorId);
    put('billNo', s.billNo);
    put('billDate', s.billDate);
    put('poNo', s.poNo);
  }
  if (s.acquisition === 'Donation') put('donor', s.donor);
  if (s.price.trim()) out.price = Number(s.price);
  put('remarks', s.remarks);
  if (mode === 'new') {
    if (s.typed)
      out.accessionNos = s.accessionNos
        .split(/[\s,;]+/)
        .map((x) => x.trim())
        .filter(Boolean);
    else out.count = Number(s.count) || 1;
  }
  return out;
}

/**
 * Where a copy is and how it came: the library, how many copies (numbered from the series, or the
 * numbers typed), the shelf and its rack, the barcode (one copy), purchase from a vendor with the bill
 * or a donation, the price and the date of accession.
 */
export function CopyFields({
  setup,
  value,
  onChange,
  mode,
  materialTypeId,
  idPrefix,
}: {
  setup: BookSetup;
  value: CopyState;
  onChange: (next: CopyState) => void;
  mode: 'new' | 'edit';
  materialTypeId?: string;
  idPrefix: string;
}) {
  const set = (patch: Partial<CopyState>) => onChange({ ...value, ...patch });
  const shelves = setup.shelves.filter((s) => s.libraryId === value.libraryId);
  const racks = shelves.find((s) => s.id === value.shelfId)?.racks ?? [];
  const next = setup.series.find(
    (x) => x.libraryId === value.libraryId && x.materialTypeId === materialTypeId,
  )?.next;
  const id = (k: string) => `${idPrefix}-${k}`;
  const many =
    mode === 'new' &&
    (value.typed ? value.accessionNos.trim().split(/[\s,;]+/).length > 1 : Number(value.count) > 1);
  return (
    <>
      <FormRow columns={3}>
        <SelectField
          id={id('library')}
          label="Library"
          required
          value={value.libraryId}
          onChange={(e) => set({ libraryId: e.target.value, shelfId: '', rack: '' })}
          options={setup.libraries.map((l) => ({ value: l.id, label: `${l.name} (${l.code})` }))}
        />
        {mode === 'new' && !value.typed ? (
          <InputField
            id={id('count')}
            label="Number of copies"
            type="number"
            min={1}
            max={200}
            required
            value={value.count}
            onChange={(e) => set({ count: e.target.value })}
            help={
              materialTypeId
                ? next
                  ? `Numbered from ${next} (Library setup → Accession numbers)`
                  : 'No accession series for this library and type: type the numbers'
                : 'Pick the material type to see the numbers'
            }
          />
        ) : null}
        {mode === 'new' && value.typed ? (
          <InputField
            id={id('typed')}
            label="Accession numbers"
            required
            maxLength={2000}
            value={value.accessionNos}
            onChange={(e) => set({ accessionNos: e.target.value })}
            help="As written on the copies, separated by commas or spaces"
          />
        ) : null}
        <InputField
          id={id('on')}
          label="Date of accession"
          type="date"
          max={today()}
          value={value.accessionedOn}
          onChange={(e) => set({ accessionedOn: e.target.value })}
        />
      </FormRow>
      {mode === 'new' ? (
        <label className="ep-check" htmlFor={id('type')}>
          <input
            id={id('type')}
            type="checkbox"
            checked={value.typed}
            onChange={(e) => set({ typed: e.target.checked })}
          />{' '}
          Type the accession numbers instead (copies already numbered)
        </label>
      ) : null}
      <FormRow columns={3}>
        <SelectField
          id={id('shelf')}
          label="Shelf"
          value={value.shelfId}
          onChange={(e) => set({ shelfId: e.target.value, rack: '' })}
          options={[
            { value: '', label: shelves.length ? '—' : 'No shelf in this library yet' },
            ...shelves.map((s) => ({
              value: s.id,
              label: `${s.code}${s.name ? ` · ${s.name}` : ''}`,
            })),
          ]}
        />
        <SelectField
          id={id('rack')}
          label="Rack"
          value={value.rack}
          disabled={!racks.length}
          onChange={(e) => set({ rack: e.target.value })}
          options={[{ value: '', label: '—' }, ...racks.map((r) => ({ value: r, label: r }))]}
        />
        <InputField
          id={id('barcode')}
          label="Barcode"
          maxLength={40}
          pattern="[A-Za-z0-9/\-]*"
          value={value.barcode}
          disabled={many}
          onChange={(e) => set({ barcode: e.target.value })}
          help={
            many ? 'For one copy at a time' : 'If the copy carries one besides its accession number'
          }
        />
      </FormRow>
      <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="ep-field__label">How it came</legend>
        <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
          {(['Purchase', 'Donation'] as const).map((a) => (
            <label key={a} className="ep-check" htmlFor={id(`acq-${a}`)}>
              <input
                id={id(`acq-${a}`)}
                type="radio"
                name={id('acq')}
                checked={value.acquisition === a}
                onChange={() => set({ acquisition: a })}
              />{' '}
              {a}
            </label>
          ))}
        </div>
      </fieldset>
      {value.acquisition === 'Purchase' ? (
        <FormRow columns={4}>
          <SelectField
            id={id('vendor')}
            label="Vendor"
            value={value.vendorId}
            onChange={(e) => set({ vendorId: e.target.value })}
            options={[
              { value: '', label: '—' },
              ...setup.vendors.map((v) => ({ value: v.id, label: `${v.name} (${v.code})` })),
            ]}
          />
          <InputField
            id={id('bill')}
            label="Bill no."
            maxLength={40}
            value={value.billNo}
            onChange={(e) => set({ billNo: e.target.value })}
          />
          <InputField
            id={id('billdate')}
            label="Bill date"
            type="date"
            max={value.accessionedOn || today()}
            value={value.billDate}
            onChange={(e) => set({ billDate: e.target.value })}
          />
          <InputField
            id={id('po')}
            label="Purchase order no."
            maxLength={40}
            value={value.poNo}
            onChange={(e) => set({ poNo: e.target.value })}
          />
        </FormRow>
      ) : null}
      {value.acquisition === 'Donation' ? (
        <InputField
          id={id('donor')}
          label="Donated by"
          maxLength={120}
          value={value.donor}
          onChange={(e) => set({ donor: e.target.value })}
        />
      ) : null}
      <FormRow columns={2}>
        <InputField
          id={id('price')}
          label="Price (₹)"
          type="number"
          min={0}
          step="0.01"
          value={value.price}
          onChange={(e) => set({ price: e.target.value })}
          help={mode === 'new' ? 'Empty: the title’s price' : undefined}
        />
        <InputField
          id={id('remarks')}
          label="Remarks"
          maxLength={300}
          value={value.remarks}
          onChange={(e) => set({ remarks: e.target.value })}
        />
      </FormRow>
    </>
  );
}
