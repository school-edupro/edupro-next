import { gstSummary, supplyOf, taxOf, totalsOf } from './purchase-gst';

describe('purchase GST (docs/design/83, part 4)', () => {
  const chair = { quantity: 10, rate: 1000, gstRate: 18 };

  it('splits CGST + SGST in the school’s state, IGST outside it, none from an unregistered vendor', () => {
    expect(supplyOf('27', '27')).toBe('intra');
    expect(supplyOf('27', '29')).toBe('inter');
    expect(supplyOf(null, '29')).toBe('intra');
    expect(taxOf(chair, 'regular', 'intra')).toEqual({
      taxable: 10000,
      cgst: 900,
      sgst: 900,
      igst: 0,
      rcm: 0,
      total: 11800,
    });
    expect(taxOf(chair, 'regular', 'inter')).toMatchObject({ cgst: 0, igst: 1800, total: 11800 });
    expect(taxOf(chair, 'unregistered', 'intra')).toMatchObject({ cgst: 0, igst: 0, total: 10000 });
    expect(taxOf(chair, 'composition', 'inter')).toMatchObject({ igst: 0, total: 10000 });
  });

  it('reverse charge: the vendor charges none, the school pays it; exempt: none at all', () => {
    const legal = { quantity: 1, rate: 25000, gstRate: 18, reverseCharge: true };
    expect(taxOf(legal, 'unregistered', 'intra')).toEqual({
      taxable: 25000,
      cgst: 0,
      sgst: 0,
      igst: 0,
      rcm: 4500,
      total: 25000,
    });
    expect(taxOf({ ...chair, exempt: true }, 'regular', 'intra')).toMatchObject({
      rcm: 0,
      total: 10000,
    });
  });

  it('applies the discount before tax and rounds the total to the rupee', () => {
    const a = taxOf({ quantity: 3, rate: 33.33, discountPct: 10, gstRate: 12 }, 'regular', 'intra');
    expect(a).toMatchObject({ taxable: 89.99, cgst: 5.4, sgst: 5.4, total: 100.79 });
    const t = totalsOf([a, taxOf({ quantity: 1, rate: 500, gstRate: 18 }, 'regular', 'intra')]);
    expect(t).toEqual({
      taxable: 589.99,
      cgst: 50.4,
      sgst: 50.4,
      igst: 0,
      rcm: 0,
      roundOff: 0.21,
      total: 691,
    });
  });

  it('sums the GST by HSN and rate', () => {
    const s = gstSummary([
      { hsn: '9403', gstRate: 18, reverseCharge: false, tax: taxOf(chair, 'regular', 'intra') },
      { hsn: '9403', gstRate: 18, reverseCharge: false, tax: taxOf(chair, 'regular', 'intra') },
      {
        hsn: '4802',
        gstRate: 12,
        reverseCharge: false,
        tax: taxOf({ ...chair, gstRate: 12 }, 'regular', 'intra'),
      },
    ]);
    expect(s.map((x) => [x.hsn, x.gstRate, x.taxable, x.cgst])).toEqual([
      ['4802', 12, 10000, 600],
      ['9403', 18, 20000, 1800],
    ]);
  });
});
