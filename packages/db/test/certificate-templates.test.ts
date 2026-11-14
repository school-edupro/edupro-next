import { describe, expect, it } from 'vitest';
import {
  CERTIFICATE_BLOCK_CSS,
  certificateBlocks,
  certificateImageIds,
} from '../src/certificate-blocks';
import { CERTIFICATE_TEMPLATES, readyTemplate } from '../src/certificate-templates';
import { renderTemplate } from '../src/template-engine';

const data = {
  school: {
    name: 'Sample <School>',
    addressLine: '1 Road, Town',
    affiliationNo: '123',
    board: 'CBSE',
  },
  cert: {
    number: 'BON/2026-27/00001',
    issuedOn: '14-11-2026',
    purpose: 'Bank',
    duplicate: true,
    copyNo: 2,
  },
  student: {
    name: 'Asha "A" Test',
    fatherName: 'Ravi',
    motherName: 'Meena',
    admissionNo: 'A1',
    classLabel: 'Class VIII – A',
    left: false,
    pronoun: 'she',
    pronounObj: 'her',
    pronounSubjCap: 'She',
    pronounPossCap: 'Her',
    childOf: 'daughter',
    dob: '09-03-2013',
    dobWords: 'Ninth March two thousand thirteen',
  },
  employee: { name: 'Tara', code: 'T1', designation: 'PGT', honorific: 'Ms.', pronoun: 'she' },
  fields: { country: 'Japan', basis: 'birth certificate', forWhat: 'the olympiad' },
  text: { conduct: 'good', fromDate: '01-12-2026', toDate: '10-12-2026' },
  fees: { year: '2026-27', heads: [{ name: 'Tuition', amount: '1,000.00' }], total: '1,000.00' },
  signs: [
    {
      title: 'Prepared by',
      name: 'Office <clerk>',
      empId: 'E1',
      designation: 'Clerk',
      at: 'Issued on 14-11-2026 09:40 AM',
      fileId: '77',
    },
    { title: 'Checked by' },
    { title: 'Principal', name: 'Prem', fileId: '78' },
  ],
  footerNote: 'Seal <required>',
};

describe('certificate blocks', () => {
  it('escapes every value it prints and places the images and the duplicate mark', () => {
    const b = certificateBlocks(data, {
      logo: 'data:image/png;base64,AA',
      images: { '77': 'data:image/png;base64,BB' },
    });
    expect(b.letterhead).toContain('Sample &lt;School&gt;');
    expect(b.letterhead).toContain('Affiliation no. 123 (CBSE)');
    expect(b.letterhead).toContain('src="data:image/png;base64,AA"');
    expect(b.signatures).toContain('Office &lt;clerk&gt;');
    expect(b.signatures).toContain('Emp. ID E1 · Clerk');
    expect(b.signatures).toContain('src="data:image/png;base64,BB"');
    // the principal's image was not loaded: the box is left to sign by hand
    expect(b.signatures.match(/<img/g)).toHaveLength(1);
    expect(b.duplicate).toContain('DUPLICATE (copy 2)');
    expect(b.footer).toContain('Seal &lt;required&gt;');
    expect(b.qr).toBe('');
    expect(certificateImageIds(data)).toEqual(['77', '78']);
    expect(CERTIFICATE_BLOCK_CSS).toContain('.eb-signs');
  });

  it('prints the QR when there is one', () => {
    const b = certificateBlocks(data, {
      qr: { image: '<svg id="q"></svg>', url: 'https://x.test/verify/abc' },
    });
    expect(b.footer).toContain('<svg id="q"></svg>');
    expect(b.footer).toContain('https://x.test/verify/abc');
  });
});

describe('the template engine and the ready templates', () => {
  it('inserts only blocks.* unescaped', () => {
    const out = renderTemplate('{{{blocks.a}}}|{{x}}|{{{x}}}', {
      blocks: { a: '<b>ok</b>' },
      x: '<i>',
    });
    expect(out.startsWith('<b>ok</b>|&lt;i&gt;|')).toBe(true);
    expect(out).not.toContain('<i>');
  });

  it('every ready template renders with nothing left unfilled and escapes the data', () => {
    expect(CERTIFICATE_TEMPLATES).toHaveLength(23);
    const blocks = certificateBlocks(data);
    for (const t of CERTIFICATE_TEMPLATES) {
      const html = renderTemplate(t.bodyHtml, { ...data, blocks });
      expect(html, t.code).not.toMatch(/{{|}}/);
      expect(html, t.code).toContain('eb-head');
      expect(html, t.code).toContain('eb-signs');
      expect(html, t.code).toContain('DUPLICATE');
      if (t.bodyHtml.includes('student.name'))
        expect(html, t.code).toContain('Asha &quot;A&quot; Test');
    }
    expect(readyTemplate('cert_tc')?.typeCode).toBe('TC');
    expect(CERTIFICATE_TEMPLATES.filter((t) => t.variantOf).map((t) => t.code)).toEqual([
      'cert_bonafide_father',
    ]);
  });
});
