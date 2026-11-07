/**
 * The purchase lists' filters and their files (docs/design/83, "As built — list filters and exports"):
 * department and dates on Purchase Indents, Requisitions and Orders; on PRs and POs also the Purchase
 * Indent they came from and the vendor. Excel and PDF of the list as filtered (every page).
 */
export interface ListFilterValues {
  departmentId?: string;
  from?: string;
  to?: string;
  indent?: string;
  vendorId?: string;
}

const ID = /^\d{1,18}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The filters from the address (anything malformed is left out). */
export function readListFilters(
  sp: Record<string, string | undefined>,
  withIndent: boolean,
): ListFilterValues {
  return {
    ...(sp.departmentId && ID.test(sp.departmentId) ? { departmentId: sp.departmentId } : {}),
    ...(sp.from && DAY.test(sp.from) ? { from: sp.from } : {}),
    ...(sp.to && DAY.test(sp.to) ? { to: sp.to } : {}),
    ...(withIndent && sp.indent?.trim() ? { indent: sp.indent.trim().slice(0, 40) } : {}),
    ...(withIndent && sp.vendorId && ID.test(sp.vendorId) ? { vendorId: sp.vendorId } : {}),
  };
}

export function ListFilterFields({
  prefix,
  values,
  departments,
  vendors,
  withIndent,
}: {
  prefix: string;
  values: ListFilterValues;
  departments: Array<{ id: string; name: string }>;
  vendors: Array<{ id: string; code: string; name: string }>;
  withIndent: boolean;
}) {
  return (
    <>
      {departments.length > 1 ? (
        <label className="ep-field" htmlFor={`${prefix}-dept`}>
          <span className="ep-field__label">Department</span>
          <select
            id={`${prefix}-dept`}
            name="departmentId"
            className="ep-select"
            defaultValue={values.departmentId ?? ''}
          >
            <option value="">Any</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="ep-field" htmlFor={`${prefix}-from`}>
        <span className="ep-field__label">From</span>
        <input
          id={`${prefix}-from`}
          name="from"
          type="date"
          className="ep-input"
          defaultValue={values.from ?? ''}
        />
      </label>
      <label className="ep-field" htmlFor={`${prefix}-to`}>
        <span className="ep-field__label">To</span>
        <input
          id={`${prefix}-to`}
          name="to"
          type="date"
          className="ep-input"
          defaultValue={values.to ?? ''}
        />
      </label>
      {withIndent ? (
        <label className="ep-field" htmlFor={`${prefix}-indent`}>
          <span className="ep-field__label">Purchase Indent</span>
          <input
            id={`${prefix}-indent`}
            name="indent"
            className="ep-input"
            maxLength={40}
            defaultValue={values.indent ?? ''}
            placeholder="PI number, e.g. 0001"
          />
        </label>
      ) : null}
      {withIndent && vendors.length ? (
        <label className="ep-field" htmlFor={`${prefix}-vendor`}>
          <span className="ep-field__label">Vendor</span>
          <select
            id={`${prefix}-vendor`}
            name="vendorId"
            className="ep-select"
            defaultValue={values.vendorId ?? ''}
          >
            <option value="">Any</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({v.code})
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </>
  );
}

/** Excel and PDF of the list as filtered: every page, with the school's letterhead. */
export function ExportButtons({
  doc,
  params,
}: {
  doc: 'indents' | 'requisitions' | 'orders';
  params: Record<string, string | undefined>;
}) {
  const href = (format: 'xlsx' | 'pdf') => {
    const u = new URLSearchParams({ doc, format });
    for (const [k, v] of Object.entries(params)) if (v) u.set(k, v);
    return `/api/purchase/list-file?${u.toString()}`;
  };
  return (
    <>
      <a
        className="ep-btn ep-btn--secondary ep-btn--sm"
        href={href('xlsx')}
        download
        title="Excel of this list as filtered (every page), with the item lines"
      >
        Excel
      </a>
      <a
        className="ep-btn ep-btn--secondary ep-btn--sm"
        href={href('pdf')}
        download
        title="PDF of this list as filtered (every page)"
      >
        PDF
      </a>
    </>
  );
}
