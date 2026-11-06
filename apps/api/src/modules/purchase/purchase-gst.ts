/**
 * The GST of a Purchase Order (docs/design/83, part 4). A registered (regular) vendor in the school's
 * state charges CGST + SGST (half each), one in another state IGST; an unregistered or composition
 * vendor charges none. A reverse-charge line (its SAC notified, e.g. an advocate's legal services): the
 * vendor charges none and the school pays the GST itself — shown apart, not in the vendor's total. An
 * exempt line: no GST. Amounts are rounded to the paisa per line; the total to the rupee (round-off).
 */
export type GstStatus = 'regular' | 'composition' | 'unregistered';
export type Supply = 'intra' | 'inter';

export interface TaxIn {
  quantity: number;
  rate: number;
  discountPct?: number;
  gstRate: number;
  reverseCharge?: boolean;
  exempt?: boolean;
}
export interface Tax {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  /** paid by the school under reverse charge (not in `total`) */
  rcm: number;
  /** what the vendor is paid for the line */
  total: number;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Intra-state when the vendor's state is the school's (or either is not known). */
export function supplyOf(schoolState: string | null, vendorState: string | null): Supply {
  return schoolState && vendorState && schoolState !== vendorState ? 'inter' : 'intra';
}

export function taxOf(l: TaxIn, vendor: GstStatus, supply: Supply): Tax {
  const taxable = r2(l.quantity * l.rate * (1 - (l.discountPct ?? 0) / 100));
  const none = { taxable, cgst: 0, sgst: 0, igst: 0, rcm: 0, total: taxable };
  if (l.exempt || !l.gstRate) return none;
  if (l.reverseCharge) return { ...none, rcm: r2((taxable * l.gstRate) / 100) };
  if (vendor !== 'regular') return none;
  if (supply === 'intra') {
    const half = r2((taxable * l.gstRate) / 200);
    return { taxable, cgst: half, sgst: half, igst: 0, rcm: 0, total: r2(taxable + 2 * half) };
  }
  const igst = r2((taxable * l.gstRate) / 100);
  return { taxable, cgst: 0, sgst: 0, igst, rcm: 0, total: r2(taxable + igst) };
}

export interface Totals {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  rcm: number;
  roundOff: number;
  total: number;
}

/** The PO's totals from its lines' and charges' taxes: the vendor's total rounded to the rupee. */
export function totalsOf(parts: Tax[]): Totals {
  const sum = (k: keyof Tax) => r2(parts.reduce((a, p) => a + p[k], 0));
  const gross = r2(sum('taxable') + sum('cgst') + sum('sgst') + sum('igst'));
  const total = Math.round(gross);
  return {
    taxable: sum('taxable'),
    cgst: sum('cgst'),
    sgst: sum('sgst'),
    igst: sum('igst'),
    rcm: sum('rcm'),
    roundOff: r2(total - gross),
    total,
  };
}

/** The GST summary by HSN / SAC and rate (as the invoice and the PDF show it). */
export function gstSummary(
  lines: Array<{ hsn: string | null; gstRate: number; reverseCharge: boolean; tax: Tax }>,
) {
  const m = new Map<
    string,
    {
      hsn: string | null;
      gstRate: number;
      reverseCharge: boolean;
      taxable: number;
      cgst: number;
      sgst: number;
      igst: number;
      rcm: number;
    }
  >();
  for (const l of lines) {
    const key = `${l.hsn ?? '-'}|${String(l.gstRate)}|${l.reverseCharge ? 'r' : ''}`;
    const cur = m.get(key) ?? {
      hsn: l.hsn,
      gstRate: l.gstRate,
      reverseCharge: l.reverseCharge,
      taxable: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      rcm: 0,
    };
    cur.taxable = r2(cur.taxable + l.tax.taxable);
    cur.cgst = r2(cur.cgst + l.tax.cgst);
    cur.sgst = r2(cur.sgst + l.tax.sgst);
    cur.igst = r2(cur.igst + l.tax.igst);
    cur.rcm = r2(cur.rcm + l.tax.rcm);
    m.set(key, cur);
  }
  return [...m.values()].sort(
    (a, b) => (a.hsn ?? '').localeCompare(b.hsn ?? '') || a.gstRate - b.gstRate,
  );
}
