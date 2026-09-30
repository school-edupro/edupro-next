import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  istStamp,
  reportToHtml,
  reportToXlsx,
  type BuiltReport,
} from '../src/renderers/report-builder';
import type { ReportSpec } from '@edupro/db';

// a 1x1 transparent PNG
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const spec = (
  paper: 'A4' | 'A3',
  orientation: ReportSpec['options']['orientation'],
): ReportSpec => ({
  columns: [{ key: 'admission_no' }, { key: 'full_name', label: 'Name' }],
  filters: [],
  sort: [],
  options: { paper, orientation },
});

const built = (withLogo: boolean): BuiltReport => ({
  result: {
    columns: [
      { key: 'admission_no', header: 'Adm No', type: 'text', width: 12 },
      { key: 'full_name', header: 'Name', type: 'text', width: 24 },
    ],
    rows: [
      { admission_no: 'A1', full_name: 'ASHA <b>' },
      { admission_no: 'A2', full_name: 'RAVI' },
    ],
    total: 2,
    filtersText: ['Religion is one of Hindu, Sikh'],
  },
  letterhead: {
    name: 'Delhi Public School, Noida',
    address: 'Sector 30, Noida, Uttar Pradesh, 201303',
    affiliation: 'CBSE Affiliation No. 2130176',
    contact: '0120-1234567',
    logo: withLogo
      ? { dataUri: `data:image/png;base64,${PNG}`, extension: 'png', base64: PNG }
      : null,
  },
  meta: {
    title: 'Class list',
    academicYear: '2026-27',
    generatedAt: new Date('2026-09-30T15:11:00Z'),
    requestedBy: 'Asha Admin',
  },
});

describe('report builder letterhead', () => {
  it('formats the generation time in IST', () => {
    expect(istStamp(new Date('2026-09-30T15:11:00Z'))).toBe('30-09-2026 20:41 IST');
  });

  it('writes the letterhead, filters, logo and print setup into Excel', async () => {
    const bytes = await reportToXlsx(built(true), spec('A3', 'auto'));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    const texts = [1, 2, 3, 4, 5, 6].map((r) => String(ws.getCell(r, 1).value ?? ''));
    expect(texts).toEqual([
      'Delhi Public School, Noida',
      'Sector 30, Noida, Uttar Pradesh, 201303',
      'CBSE Affiliation No. 2130176 · 0120-1234567',
      'Class list',
      'Academic year 2026-27 · Generated 30-09-2026 20:41 IST by Asha Admin · 2 students',
      'Filters: Religion is one of Hindu, Sikh',
    ]);
    expect(ws.getRow(8).values).toEqual([undefined, 'Adm No', 'Name']);
    expect(ws.getCell(10, 2).value).toBe('RAVI');
    expect(ws.getImages()).toHaveLength(1);
    expect(ws.pageSetup.paperSize).toBe(8);
    expect(ws.pageSetup.orientation).toBe('portrait'); // 2 columns: auto stays portrait
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 8 });
  });

  it('builds the PDF page with the logo, escaped cells and page numbers', () => {
    const html = reportToHtml(built(true), spec('A4', 'landscape'));
    expect(html).toContain('size: A4 landscape');
    expect(html).toContain('<img src="data:image/png;base64,');
    expect(html).toContain('ASHA &lt;b&gt;');
    expect(html).toContain('counter(pages)');
    expect(html).toContain('Filters: Religion is one of Hindu, Sikh');
    expect(reportToHtml(built(false), spec('A4', 'auto'))).not.toContain('<img');
  });
});
