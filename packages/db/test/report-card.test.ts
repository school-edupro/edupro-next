import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUTS,
  DPS_NOIDA_TEMPLATES,
  reportCardBody,
  reportCardDocument,
} from '../src/report-card-html';
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

describe('the DPS Noida cards (docs/design/65, part 4)', () => {
  const card = (code: string, band: Parameters<typeof sampleReportCardData>[0]) => {
    const t = DPS_NOIDA_TEMPLATES.find((x) => x.code === code)!;
    return reportCardDocument(
      { layout: t.layout, bodyHtml: null, stylesCss: '', pageWidth: '210mm', pageHeight: '297mm' },
      [{ data: sampleReportCardData(band) }],
    );
  };

  it('has a card for each class group, each with a band', () => {
    expect(DPS_NOIDA_TEMPLATES.map((t) => [t.code, t.band])).toEqual([
      ['dps_i_ii', 'primary'],
      ['dps_iii_v', 'primary'],
      ['dps_vi_viii', 'middle'],
      ['dps_ix', 'secondary'],
      ['dps_x', 'secondary'],
      ['dps_xi', 'senior'],
      ['dps_xii', 'senior'],
    ]);
  });

  it('VI-VIII: Term 1 and Term 2 side by side from the term results, signatures, seal, key', () => {
    const html = card('dps_vi_viii', 'middle');
    expect(html).toContain(
      '<th class="ctr" colspan="5">Term 1</th><th class="ctr" colspan="5">Term 2</th>',
    );
    expect(html).toContain('Periodic test (15)');
    expect(html).toContain('Half-yearly (80)');
    expect(html).toContain('Yearly (80)');
    // English term 1: 12.75 + 4.5 + 62 = 79.25, whole
    expect(html).toContain(
      '<td class="num">12.75</td><td class="num">4.5</td><td class="num">62</td><td class="num">79</td>',
    );
    expect(html).toContain('Promoted to');
    expect(html).toContain('Class VIII');
    expect(html).toContain('Meera Joshi');
    expect(html).toContain('School seal');
    expect(html).toContain(
      'Periodic test (15) + Subject enrichment (5) + Half-yearly (80) = Marks obtained (100)',
    );
    expect(html).toContain('AB Absent · ML Medical leave');
  });

  it('III-V: a cover page, then grades only; participation and the class teacher', () => {
    const html = card('dps_iii_v', 'primary');
    expect(html).toContain('<div class="cover">');
    expect(html).toContain('Learning curve');
    expect(html.indexOf('<div class="page-break">')).toBeGreaterThan(
      html.indexOf('<div class="cover">'),
    );
    // the marks table shows grades only (the key still says how the marks are made)
    const marks = html.slice(
      html.indexOf('<h2>Scholastic areas</h2>'),
      html.indexOf('<h2>Co-scholastic areas</h2>'),
    );
    expect(marks).not.toContain('Periodic test (15)');
    expect(html).toContain('<th class="ctr">Grade</th>');
    expect(html).toContain('Inter-house debate, science exhibition');
  });

  it('IX: the parts of the card, discipline on its own', () => {
    const html = card('dps_ix', 'secondary');
    for (const part of [
      'Part 1 · Scholastic areas',
      'Part 2 · Co-scholastic areas',
      'Part 3 · Discipline',
      'Part 4 · Participation',
      'Part 5 · Attendance',
    ])
      expect(html).toContain(part);
    const discipline = html.slice(
      html.indexOf('Part 3 · Discipline'),
      html.indexOf('Part 4 · Participation'),
    );
    expect(discipline).toContain('Discipline');
    expect(discipline).not.toContain('Health and physical education');
  });
});
