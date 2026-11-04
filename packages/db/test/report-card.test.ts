import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUTS,
  READY_MADE_TEMPLATES,
  HPC_TEMPLATES,
  HPC_V1_LAYOUT,
  TEST_SLIP_TEMPLATES,
  reportCardBody,
  reportCardDocument,
} from '../src/report-card-html';
import { sampleReportCardData } from '../src/report-card-data';
import { LEARNING_RECORD_SET, learningRecordRows } from '../src/learning-record';
import { lrAreaPlan, lrPages, type LrSection } from '../src/learning-record-html';

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

describe('the ready-made cards (docs/design/65, part 4)', () => {
  const card = (code: string, band: Parameters<typeof sampleReportCardData>[0]) => {
    const t = READY_MADE_TEMPLATES.find((x) => x.code === code)!;
    return reportCardDocument(
      { layout: t.layout, bodyHtml: null, stylesCss: '', pageWidth: '210mm', pageHeight: '297mm' },
      [{ data: sampleReportCardData(band) }],
    );
  };

  it('has a card for each class group, each with a band', () => {
    expect(READY_MADE_TEMPLATES.map((t) => [t.code, t.band])).toEqual([
      ['lr_i_ii', 'primary'],
      ['lr_iii_v', 'primary'],
      ['rc_vi_viii', 'middle'],
      ['rc_ix', 'secondary'],
      ['rc_x', 'secondary'],
      ['rc_xi', 'senior'],
      ['rc_xii', 'senior'],
    ]);
  });

  it('VI-VIII: Term 1 and Term 2 side by side from the term results, signatures, seal, key', () => {
    const html = card('rc_vi_viii', 'middle');
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
    const html = card('lr_iii_v', 'primary');
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
    const html = card('rc_ix', 'secondary');
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

describe('the holistic progress card (docs/design/65, part 5)', () => {
  // the first layout's sections still print (a school's own copy may keep them)
  const doc = (data = sampleReportCardData('pre_primary')) =>
    reportCardDocument(
      {
        layout: HPC_V1_LAYOUT,
        bodyHtml: null,
        stylesCss: '',
        pageWidth: '210mm',
        pageHeight: '297mm',
      },
      [{ data }],
    );

  it('prints domains, goals as headings and competencies with the level', () => {
    const html = doc();
    expect(HPC_TEMPLATES[0]!.band).toBe('pre_primary');
    expect(html).toContain('<h2>My progress</h2>');
    expect(html).toContain('<th class="ctr">Level</th>');
    expect(html).toContain('<td class="goal" colspan="3">Listening skills</td>');
    expect(html).toContain('<td class="sub">Comprehension</td>');
    expect(html).toContain('<span><strong>A*</strong> Outstanding</span>');
  });

  it('prints the three voices and the portfolio; nothing without the HPC', () => {
    const html = doc();
    expect(html).toContain('<div class="k">All about me</div>');
    expect(html).toContain('She reads picture books at home every evening.');
    expect(html).toContain('<figcaption>My drawing of a tree</figcaption>');
    const none = doc({ ...sampleReportCardData('pre_primary'), hpc: null });
    expect(none).not.toContain('My progress');
    expect(none).not.toContain('All about me');
  });
});

describe('the learning record on A4 (docs/design/73)', () => {
  const t = HPC_TEMPLATES[0]!;
  const like = {
    layout: t.layout,
    bodyHtml: null,
    stylesCss: '',
    pageWidth: '210mm',
    pageHeight: '297mm',
  };
  const pages = (html: string) => html.split('<section class="lr-page').length - 1;

  it('is six whole A4 pages a pupil, with no page break between two pupils', () => {
    const d = sampleReportCardData('pre_primary');
    const one = reportCardDocument(like, [{ data: d }]);
    expect(pages(one)).toBe(6);
    const two = reportCardDocument(like, [{ data: d }, { data: d }]);
    expect(pages(two)).toBe(12);
    expect(two).not.toContain('<div class="page-break"></div>');
    expect(one).toContain('.page:has(.lr-page) { padding: 0 !important; }');
  });

  it('the cover: the school, the session, the title and the boxes', () => {
    const html = reportCardDocument(like, [{ data: sampleReportCardData('pre_primary') }]);
    expect(html).toContain('<div class="l">Session 2026-27</div>');
    expect(html).toContain(
      '<div class="ti">Learning curve</div><div class="ca">(Progress record)</div>',
    );
    expect(html).toContain('<div class="box">My name is<b>Aarav Sharma</b></div>');
    expect(html).toContain('<div class="box">I am a shining star of<b>VI-A</b></div>');
    expect(html).toContain('<div class="box">I was born on<b>12-06-2014</b></div>');
    // the pupil's name at the top of every page after the cover
    expect(html.split('<div class="lr-who">Aarav Sharma&nbsp;&nbsp;A2481</div>').length - 1).toBe(
      5,
    );
  });

  it('the subjects: Term I and Term II, the skill groups, the subject remarks by term', () => {
    const html = reportCardDocument(like, [{ data: sampleReportCardData('pre_primary') }]);
    expect(html).toContain(
      '<th style="width:25mm">Term I grade</th><th style="width:25mm">Term II grade</th>',
    );
    expect(html).toContain('<tr class="grp"><td class="side" rowspan="19">');
    expect(html).toContain(
      '<td class="n">Listening skills</td><td class="g"></td><td class="g"></td>',
    );
    expect(html).toContain(
      '<div class="h">English remarks</div><div class="t">Reads simple sentences',
    );
    // Term II is not filled yet: its remark box and grades are blank
    expect(html).toContain(
      '</div><div class="tag">Term I</div><div class="t"></div><div class="tag">Term II</div>',
    );
    // English and Mathematics on one page, Hindi, EVS and General knowledge on the next (GK by initials)
    const subjects = html.split('<h2 class="lr-title">Scholastic area</h2>');
    expect(subjects).toHaveLength(3);
    expect(subjects[1]).toContain('>English<');
    expect(subjects[1]).toContain('>Mathematics<');
    expect(subjects[2]).toContain('>Hindi<');
    expect(subjects[2]).toContain('>GK<');
  });

  it('the co-scholastic page, the record page and the evaluation key', () => {
    const html = reportCardDocument(like, [{ data: sampleReportCardData('pre_primary') }]);
    const co = html
      .split('<h2 class="lr-title">Co-scholastic area</h2>')[1]!
      .split('</section>')[0]!;
    expect(co).toContain('Personal and social traits');
    expect(co).toContain('Horse riding');
    expect(co).not.toContain('remarks');
    expect(html).toContain('<div class="val">121</div>');
    expect(html).toContain('<div class="val">109 / 123</div>');
    expect(html).toContain('<div class="by">– Meera Joshi, Anita Rao</div>');
    expect(html).toContain('Celebration of special days');
    expect(html).toContain(
      '<tr><td class="gr">A*</td><td>Outstanding</td><td class="rg">91 – 100 %</td></tr>',
    );
    expect(html).toContain(
      '<tr><td class="gr">D</td><td>Scope for improvement</td><td class="rg">50 % and below</td></tr>',
    );
  });

  it('keeps an area whole on a page; one longer than a page has a page of its own', () => {
    const item = (n: number) => ({
      code: `X${String(n)}`,
      name: `Skill ${String(n)}`,
      kind: 'level' as const,
      description: null,
      levels: [],
      note: null,
      descriptor: null,
      children: [],
    });
    const area = (name: string, n: number) => ({
      area: name,
      items: Array.from({ length: n }, (_, i) => item(i)),
    });
    const p = lrPages([area('A', 20), area('B', 8), area('C', 5), area('D', 40)], true);
    expect(p.map((x) => x.map((a) => a.area))).toEqual([['A', 'B'], ['C'], ['D']]);
  });

  it('any set: the observation and written areas are co-scholastic, the rest the subjects', () => {
    const d = sampleReportCardData('pre_primary');
    const lvl = (code: string, kind: 'level' | 'text' = 'level') => ({
      code,
      name: code,
      kind,
      description: null,
      levels: [],
      note: null,
      descriptor: null,
      children: [],
    });
    d.hpc = {
      ...d.hpc!,
      areas: [
        { area: 'Language and literacy development · English', items: [lvl('EN1')] },
        { area: 'Positive learning habits', items: [lvl('LH1')] },
        { area: 'Self assessment', items: [lvl('SA1', 'text')] },
      ],
      scales: [{ levels: ['Rarely', 'Always'], areas: ['Positive learning habits'] }],
    };
    const plan = lrAreaPlan(d.hpc, t.layout.sections as LrSection[]);
    const by = (type: string) =>
      [...plan.entries()]
        .filter(([s]) => s.type === type)
        .flatMap(([, list]) => list.map((a) => a.area));
    expect(by('lr_co_scholastic')).toEqual(['Positive learning habits', 'Self assessment']);
    expect(by('lr_subjects')).toEqual(['Language and literacy development · English']);
  });

  it('the ready-made set: codes unique, every skill under its group', () => {
    const rows = learningRecordRows();
    expect(new Set(rows.map((r) => r.code)).size).toBe(rows.length);
    expect(rows.filter((r) => r.area === 'English')).toHaveLength(19);
    expect(rows.every((r) => !r.parentCode || rows.some((x) => x.code === r.parentCode))).toBe(
      true,
    );
    expect(LEARNING_RECORD_SET.grades).toEqual(['A*', 'A', 'B*', 'B', 'C', 'D']);
  });
});

describe('remarks by category and promotion (docs/design/65, part 7)', () => {
  const remarks = (section: Parameters<typeof reportCardBody>[1]['sections'][number]) => {
    const d = sampleReportCardData('middle');
    d.remarkItems = [
      { code: 'ENG', category: 'English', subject: 'English', text: 'Reads with expression.' },
      { code: 'GEN', category: 'General', subject: null, text: 'A helpful classmate.' },
    ];
    return reportCardBody(d, { sections: [section] });
  };

  it('prints the general remark and each category, or some categories only', () => {
    const all = remarks({ type: 'remarks' });
    expect(all).toContain('<strong>English:</strong> Reads with expression.');
    expect(all).toContain('<strong>General:</strong> A helpful classmate.');
    const english = remarks({
      type: 'remarks',
      title: 'English remarks',
      categories: ['ENG'],
      general: false,
    });
    expect(english).toContain('Reads with expression.');
    expect(english).not.toContain('A helpful classmate.');
    expect(english).not.toContain(sampleReportCardData('middle').remarks[0]!.remark);
  });

  it('labels a retained student’s line as Promotion', () => {
    const d = sampleReportCardData('middle');
    d.promotedTo = 'Retained in Class VII';
    const html = reportCardBody(d, { sections: [{ type: 'promotion' }] });
    expect(html).toContain(
      '<div class="k">Promotion</div><div class="v">Retained in Class VII</div>',
    );
    d.promotedTo = 'Class VIII, subject to compartment';
    expect(reportCardBody(d, { sections: [{ type: 'promotion' }] })).toContain(
      '<div class="k">Promoted to</div>',
    );
  });
});

describe('the periodic-test slip (an exam card, 1 Nov 2026)', () => {
  const slip = TEST_SLIP_TEMPLATES.find((t) => t.band === 'middle')!;
  const one = () => {
    const d = sampleReportCardData('middle');
    // an exam card carries one test: PT1 only
    return {
      ...d,
      exams: d.exams.slice(0, 1),
      subjects: d.subjects.map((r) => ({ ...r, cells: r.cells.slice(0, 1) })),
    };
  };

  it('has a slip for each band from Class I, none for pre-primary', () => {
    expect(TEST_SLIP_TEMPLATES.map((t) => t.band)).toEqual([
      'primary',
      'middle',
      'secondary',
      'senior',
    ]);
    expect(slip.name).toBe('Periodic test slip (VI-VIII)');
  });

  it('one test: maximum, marks obtained and grade per subject, then total, percentage, grade', () => {
    const html = reportCardBody(one(), slip.layout);
    expect(html).toContain('Maximum marks');
    expect(html).toContain('Marks obtained');
    expect(html).toContain('Mathematics');
    expect(html).toContain('Percentage');
    // a test is not a result: no rank, no pass or fail, no term columns
    expect(html).not.toContain('Rank');
    expect(html).not.toContain('PASS');
    expect(html).not.toContain('Term total');
  });

  it('several tests: a marks and grade column each, then the total', () => {
    const d = sampleReportCardData('middle');
    const html = reportCardBody(d, slip.layout);
    for (const e of d.exams) expect(html).toContain(`${e.code} (`);
    expect(html).not.toContain('Marks obtained');
    expect(html).toContain('<th class="num">Total</th>');
  });
});
