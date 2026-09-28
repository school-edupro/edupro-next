import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUTS, reportCardBody, reportCardDocument } from '../src/report-card-html';
import { sampleReportCardData } from '../src/report-card-data';

/**
 * Sprint 17 visual-diff harness: the rendered HTML of each band's default layout against the sample
 * pupil is snapshotted; a change in the renderer or a layout shows up as a diff to review.
 */
describe('report-card renderer', () => {
  for (const band of ['primary', 'middle', 'secondary', 'senior'] as const) {
    it(`renders the ${band} default layout`, () => {
      const html = reportCardBody(sampleReportCardData(band), DEFAULT_LAYOUTS[band]);
      expect(html).toContain('Aarav Sharma');
      expect(html).toContain('Mathematics');
      expect(html).toMatchSnapshot();
    });
  }

  it('prints the withheld notice instead of marks', () => {
    const html = reportCardBody(sampleReportCardData('middle'), DEFAULT_LAYOUTS.middle, {
      withheld: 'Report card withheld: fee dues pending.',
    });
    expect(html).toContain('withheld');
    expect(html).not.toContain('Mathematics');
  });

  it('a batch document has a page break between pupils and a custom body replaces the layout', () => {
    const t = {
      layout: {},
      bodyHtml: null,
      stylesCss: '',
      pageWidth: '210mm',
      pageHeight: '297mm',
    };
    const two = reportCardDocument(t, [
      { data: sampleReportCardData('primary') },
      { data: sampleReportCardData('primary') },
    ]);
    expect(two.match(/<div class="page-break">/g)).toHaveLength(1);
    const custom = reportCardDocument(
      { ...t, bodyHtml: '<h1>{{student.name}}</h1><p>{{term.pct}}</p>' },
      [{ data: sampleReportCardData('senior') }],
    );
    expect(custom).toContain('<h1>Aarav Sharma</h1>');
    expect(custom).not.toContain('Scholastic areas');
  });
});
