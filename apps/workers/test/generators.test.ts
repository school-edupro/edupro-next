import { describe, expect, it } from 'vitest';
import { toTallyXml, toXml } from '../src/processors/generators';

describe('xml generators (Sprint 15)', () => {
  const rows = [
    {
      date: new Date('2026-04-08T00:00:00Z'),
      voucher_type: 'Receipt',
      voucher_no: 'TF/FY2026-27/000002',
      party: 'A1 - Bhanu',
      ledger_name: 'Tuition fee',
      amount: '6000.00',
      mode: 'cheque',
      instrument_no: 'CHQ001',
      bank_name: 'SBI',
      narration: 'Fee receipt TF/FY2026-27/000002 cheque CHQ001',
    },
    {
      date: new Date('2026-04-20T00:00:00Z'),
      voucher_type: 'Receipt',
      voucher_no: 'TF/FY2026-27/000003',
      party: 'A2 - Chirag',
      ledger_name: 'Tuition fee',
      amount: '6000.00',
      mode: 'cash',
      instrument_no: null,
      bank_name: null,
      narration: 'Fee receipt TF/FY2026-27/000003',
    },
    {
      date: new Date('2026-04-20T00:00:00Z'),
      voucher_type: 'Receipt',
      voucher_no: 'TF/FY2026-27/000003',
      party: 'A2 - Chirag',
      ledger_name: 'Late fee',
      amount: '100.00',
      mode: 'cash',
      instrument_no: null,
      bank_name: null,
      narration: 'Late fee on TF/FY2026-27/000003',
    },
  ];

  it('groups voucher lines into Tally receipt vouchers debiting cash or bank', () => {
    const xml = toTallyXml(rows, {
      company: 'Alpha Public School',
      cashLedger: 'Cash',
      bankLedger: 'HDFC Bank',
    }).toString('utf8');
    expect(xml).toContain('<TALLYREQUEST>Import Data</TALLYREQUEST>');
    expect(xml).toContain('<SVCURRENTCOMPANY>Alpha Public School</SVCURRENTCOMPANY>');
    expect((xml.match(/<VOUCHER /g) ?? []).length).toBe(2);
    expect(xml).toContain('<DATE>20260408</DATE>');
    expect(xml).toContain('<LEDGERNAME>HDFC Bank</LEDGERNAME>');
    expect(xml).toContain('<AMOUNT>-6000.00</AMOUNT>');
    expect(xml).toContain('<AMOUNT>-6100.00</AMOUNT>');
    expect(xml).toContain('<LEDGERNAME>Late fee</LEDGERNAME>');
    expect(xml).toContain('<PARTYLEDGERNAME>A1 - Bhanu</PARTYLEDGERNAME>');
  });

  it('renders any dataset as generic XML rows with escaping', () => {
    const xml = toXml(
      'Day & book',
      [
        { key: 'payer', header: 'Payer' },
        { key: 'amount', header: 'Amount', type: 'number' },
      ],
      [{ payer: 'R <B> & Co', amount: '10.00' }],
    ).toString('utf8');
    expect(xml).toContain('<report title="Day &amp; book">');
    expect(xml).toContain('<payer>R &lt;B&gt; &amp; Co</payer>');
    expect(xml).toContain('<amount>10</amount>');
  });
});
