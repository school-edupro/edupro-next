import ExcelJS from 'exceljs';
import { MASTERS } from '@edupro/db';
import { sheetName } from './sheet';

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
