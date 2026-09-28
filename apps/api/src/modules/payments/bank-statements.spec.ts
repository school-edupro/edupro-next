import { parseBankDate, readBankCsv } from './bank-statements.service';

describe('bank statement CSV (Sprint 15)', () => {
  it('reads Indian bank formats: dd/mm/yyyy, lakh separators, debit/credit columns, preamble rows', () => {
    const csv = [
      'Account Name,EDUPRO SCHOOL',
      'Account No,XXXX1234',
      '',
      'Txn Date,Value Date,Description,Ref No./Cheque No.,Debit,Credit,Balance',
      '09/04/2026,09/04/2026,CLG CHQ DEP,CHQ001,,"6,000.00","1,06,000.00"',
      '10-Apr-2026,10-Apr-2026,NEFT CR,NEFT447712,,1500,107500.00',
      '11/04/2026,,BANK CHARGES,,25.00,,107475.00',
      ',,Closing balance,,,,107475.00',
    ].join('\n');
    const lines = readBankCsv(csv);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({
      lineNo: 1,
      txnDate: '2026-04-09',
      reference: 'CHQ001',
      credit: 6000,
      debit: 0,
      balance: 106000,
    });
    expect(lines[1]).toMatchObject({
      txnDate: '2026-04-10',
      valueDate: '2026-04-10',
      credit: 1500,
    });
    expect(lines[2]).toMatchObject({ debit: 25, credit: 0, reference: null });
  });

  it('accepts a single amount column with a Dr/Cr type column', () => {
    const csv = 'Date,Particulars,Amount,Dr/Cr\n2026-04-09,UPI CR,999,CR\n2026-04-10,ATM,200,DR';
    const lines = readBankCsv(csv);
    expect(lines.map((l) => [l.credit, l.debit])).toEqual([
      [999, 0],
      [0, 200],
    ]);
  });

  it('refuses a file without a date or amount column', () => {
    expect(() => readBankCsv('a,b\n1,2')).toThrow(/header/);
    expect(parseBankDate('31/12/2026')).toBe('2026-12-31');
    expect(parseBankDate('5-Jan-27')).toBe('2027-01-05');
    expect(parseBankDate('nonsense')).toBeNull();
  });
});
