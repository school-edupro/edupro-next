'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { FormActions, FormRow, FormSection } from '@edupro/ui';
import { ChipPicker } from '@/components/ChipPicker';
import { saveStore } from '@/lib/purchase-actions';
import type { Store, StoreFormLists } from '@/lib/purchase';

/**
 * A store's details and keepers (docs/design/84, part 6): its code and name, the department it
 * belongs to, where it is, the employees who keep it, active or not (a store holding stock stays
 * active; the main store always does).
 */
export function StoreForm({ store, lists }: { store: Store | null; lists: StoreFormLists }) {
  const router = useRouter();
  const [v, setV] = useState({
    code: store?.code ?? '',
    name: store?.name ?? '',
    departmentId: store?.departmentId ?? '',
    location: store?.location ?? '',
    status: store?.status ?? 'active',
  });
  const [keepers, setKeepers] = useState<string[]>(store?.keepers.map((k) => k.id) ?? []);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV((cur) => ({ ...cur, [k]: e.target.value }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await saveStore(store?.id ?? null, {
            code: v.code,
            name: v.name,
            departmentId: v.departmentId || null,
            location: v.location || undefined,
            keeperIds: keepers,
            status: v.status,
          });
          if (r.ok) {
            router.push(
              `/purchase/stores/${r.id}?ok=1&detail=${encodeURIComponent(store ? 'Store saved' : 'Store added')}`,
            );
            return;
          }
          setError(r.error);
        });
      }}
      noValidate
    >
      <FormSection title={store ? 'The store' : 'A new sub-store'}>
        <FormRow columns={3}>
          <label className="ep-field" htmlFor="sf-code">
            <span className="ep-field__label" data-required="true">
              Code
            </span>
            <input
              id="sf-code"
              className="ep-input"
              maxLength={20}
              value={v.code}
              onChange={set('code')}
              placeholder="e.g. CHEMLAB"
            />
          </label>
          <label className="ep-field" htmlFor="sf-name">
            <span className="ep-field__label" data-required="true">
              Name
            </span>
            <input
              id="sf-name"
              className="ep-input"
              maxLength={80}
              value={v.name}
              onChange={set('name')}
              placeholder="e.g. Chemistry lab store"
            />
          </label>
          <label className="ep-field" htmlFor="sf-dept">
            <span className="ep-field__label">Department</span>
            <select
              id="sf-dept"
              className="ep-select"
              value={v.departmentId}
              onChange={set('departmentId')}
            >
              <option value="">None</option>
              {lists.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        </FormRow>
        <FormRow columns={2}>
          <label className="ep-field" htmlFor="sf-loc">
            <span className="ep-field__label">Where it is</span>
            <input
              id="sf-loc"
              className="ep-input"
              maxLength={200}
              value={v.location}
              onChange={set('location')}
              placeholder="Block, floor, room"
            />
          </label>
          {store && store.kind === 'sub' ? (
            <label className="ep-field" htmlFor="sf-status">
              <span className="ep-field__label">Status</span>
              <select
                id="sf-status"
                className="ep-select"
                value={v.status}
                onChange={set('status')}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive (holds no stock)</option>
              </select>
            </label>
          ) : (
            <span />
          )}
        </FormRow>
        <ChipPicker
          label="Keepers"
          options={lists.employees.map((e) => ({
            value: e.id,
            label: `${e.name} (${e.code})${e.designation ? ` · ${e.designation}` : ''}`,
          }))}
          value={keepers}
          onChange={setKeepers}
          help="The employees who receive, issue and count stock in this store. Give them the Store keeper role (Access → Users)."
        />
      </FormSection>
      {error ? (
        <p className="ep-field__error" role="alert">
          {error}
        </p>
      ) : null}
      <FormActions>
        <a
          className="ep-btn ep-btn--ghost"
          href={store ? `/purchase/stores/${store.id}` : '/purchase/stores'}
        >
          Cancel
        </a>
        <button type="submit" className="ep-btn ep-btn--primary" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </FormActions>
    </form>
  );
}
