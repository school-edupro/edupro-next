import ExcelJS from 'exceljs';
import { MASTERS } from '@edupro/db';
import { parseCsv, readSheet, sheetName } from './sheet';

describe('sheetName: a title Excel accepts as a sheet name', () => {
  it('turns the refused characters into a dash and keeps 31 characters at most', () => {
    expect(sheetName('HSN / SAC codes')).toBe('HSN - SAC codes');
    expect(sheetName('Templates (Excel import / export)')).toBe('Templates (Excel import - expor');
    expect(sheetName('Fees: paid? [all] *')).toBe('Fees - paid - all');
    expect(sheetName("'Quoted'")).toBe('Quoted');
    expect(sheetName(' / ')).toBe('Sheet');
    expect(sheetName('', 'Report')).toBe('Report');
    expect(sheetName('x'.repeat(40))).toHaveLength(31);
  });

  it('gives every master a sheet ExcelJS can make (the upload template and the Excel export)', () => {
    for (const def of MASTERS) {
      const name = sheetName(def.title);
      expect(() => new ExcelJS.Workbook().addWorksheet(name)).not.toThrow();
      expect(name.length).toBeLessThanOrEqual(31);
    }
  });
});

describe('a CSV saved from a spreadsheet', () => {
  it('splits commas, keeps quoted commas and quotes, takes CRLF and a BOM', () => {
    expect(
      parseCsv(
        '\uFEFFEmpId,Date,Reason\r\nE1,2026-11-02,"Device down, fixed"\r\nE2,2026-11-03,"Said ""ok"""\n',
      ),
    ).toEqual([
      ['EmpId', 'Date', 'Reason'],
      ['E1', '2026-11-02', 'Device down, fixed'],
      ['E2', '2026-11-03', 'Said "ok"'],
    ]);
  });
  it('is not a CSV: binary bytes, or a single column', () => {
    expect(parseCsv('PK\u0003\u0004\u0000binary')).toBeNull();
    expect(parseCsv('just one line of words')).toBeNull();
  });
  it('is read like an Excel sheet, by header', async () => {
    const csv = Buffer.from('EmpId,Date,DayType\nE1,2026-11-02,P\n').toString('base64');
    const rows = await readSheet(
      csv,
      ['Date'],
      ['Employee', 'EmpId', 'DayType'],
      [['Employee', 'EmpId']],
    );
    expect(rows).toEqual([
      { row: 2, cells: { Date: '2026-11-02', Employee: '', EmpId: 'E1', DayType: 'P' } },
    ]);
  });
});
