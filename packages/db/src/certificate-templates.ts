/**
 * The ready certificate templates (docs/design/87, phase A): the transfer certificate in the CBSE layout with all its
 * fields, bonafide, character and date of birth. Each prints the school's letterhead (the logo when the school has
 * one), the number (and the TC's book and Sl. No.), the fields frozen at issue, DUPLICATE on a duplicate, and the
 * signature lines. The data is the certificate's frozen `data` (see certificate-data.ts in the API) plus `logo`.
 */
export interface CertificateTemplate {
  code: string;
  name: string;
  kind: 'transfer_certificate' | 'bonafide' | 'certificate';
  /** the certificate type it is the default of */
  typeCode: string;
  pageWidth: string;
  pageHeight: string;
  stylesCss: string;
  bodyHtml: string;
}

const CSS = `
body { font-family: 'Source Sans 3', 'Segoe UI', Arial, sans-serif; color: #0b1f3a; font-size: 11pt; }
.cert { position: relative; }
.head { display: flex; align-items: center; gap: 6mm; border-bottom: 2px solid #0b1f3a; padding-bottom: 4mm; }
.head img { height: 22mm; }
.head .t { flex: 1; text-align: center; }
.head h1 { font-family: Poppins, Arial, sans-serif; font-size: 18pt; margin: 0; }
.head .sub { font-size: 9pt; color: #5b6676; margin-top: 1mm; }
.ids { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2mm 6mm; font-size: 9pt; margin: 3mm 0; }
h2 { text-align: center; font-family: Poppins, Arial, sans-serif; font-size: 14pt; letter-spacing: 0.06em; text-transform: uppercase; margin: 5mm 0 3mm; }
.copy { text-align: center; font-weight: 700; color: #b42318; letter-spacing: 0.2em; }
table.f { width: 100%; border-collapse: collapse; font-size: 10pt; }
table.f td { padding: 1.6mm 1mm; vertical-align: top; border-bottom: 1px dotted #c9d1dc; }
table.f td.k { width: 58%; }
table.f td.v { font-weight: 600; }
p.body { font-size: 12pt; line-height: 1.9; text-align: justify; margin: 8mm 0; }
.sign { display: flex; justify-content: space-between; margin-top: 18mm; font-size: 10pt; }
.sign div { text-align: center; min-width: 50mm; border-top: 1px solid #0b1f3a; padding-top: 1.5mm; }
.foot { margin-top: 6mm; font-size: 8pt; color: #5b6676; }
.dup { position: absolute; top: 45%; left: 0; right: 0; text-align: center; font-size: 60pt; color: rgba(180, 35, 24, 0.08); transform: rotate(-24deg); font-weight: 700; }
`;

const HEAD = `<div class="head">{{#if logo}}<img src="{{logo}}" alt="">{{/if}}<div class="t"><h1>{{school.name}}</h1><div class="sub">{{school.addressLine}}{{#if school.phone}} · {{school.phone}}{{/if}}{{#if school.email}} · {{school.email}}{{/if}}</div>{{#if school.affiliationNo}}<div class="sub">Affiliation no. {{school.affiliationNo}}{{#if school.board}} ({{school.board}}){{/if}}{{#if school.schoolNo}} · School no. {{school.schoolNo}}{{/if}}</div>{{/if}}</div></div>`;
const DUP = `{{#if cert.duplicate}}<div class="dup">DUPLICATE</div><div class="copy">DUPLICATE (copy {{cert.copyNo}})</div>{{/if}}`;
const SIGN = (left: string) =>
  `<div class="sign"><div>${left}</div><div>Checked by</div><div>Principal</div></div><div class="foot">{{cert.number}} · issued on {{cert.issuedOn}}{{#if cert.issuedBy}} by {{cert.issuedBy}}{{/if}}</div>`;

export const CERTIFICATE_TEMPLATES: CertificateTemplate[] = [
  {
    code: 'cert_tc',
    name: 'Transfer certificate (CBSE layout)',
    kind: 'transfer_certificate',
    typeCode: 'TC',
    pageWidth: '210mm',
    pageHeight: '297mm',
    stylesCss: CSS,
    bodyHtml: `<div class="cert">${DUP}${HEAD}
<div class="ids"><span>TC no. <strong>{{cert.number}}</strong></span>{{#if cert.bookNo}}<span>Book no. <strong>{{cert.bookNo}}</strong></span><span>Sl. no. <strong>{{cert.slNo}}</strong></span>{{/if}}<span>Admission no. <strong>{{student.admissionNo}}</strong></span></div>
<div class="ids"><span>PEN <strong>{{student.pen}}</strong></span><span>APAAR ID <strong>{{student.apaar}}</strong></span>{{#if student.registrationNo}}<span>Registration no. <strong>{{student.registrationNo}}</strong></span>{{/if}}</div>
<h2>Transfer certificate</h2>
<table class="f">
<tr><td class="k">1. Name of pupil</td><td class="v">{{student.name}}</td></tr>
<tr><td class="k">2. Father's / guardian's name</td><td class="v">{{student.fatherName}}</td></tr>
<tr><td class="k">3. Mother's name</td><td class="v">{{student.motherName}}</td></tr>
<tr><td class="k">4. Nationality</td><td class="v">{{student.nationality}}</td></tr>
<tr><td class="k">5. Whether the candidate belongs to SC / ST / OBC</td><td class="v">{{student.category}}</td></tr>
<tr><td class="k">6. Date of first admission in the school, with class</td><td class="v">{{student.admittedOn}}{{#if student.admissionClassLabel}} — {{student.admissionClassLabel}}{{/if}}</td></tr>
<tr><td class="k">7. Date of birth according to the admission register (in figures and words)</td><td class="v">{{student.dob}} ({{student.dobWords}})</td></tr>
<tr><td class="k">8. Class in which the pupil last studied (in figures and words)</td><td class="v">{{tc.lastClass}}{{#if tc.lastClassWords}} ({{tc.lastClassWords}}){{/if}}</td></tr>
<tr><td class="k">9. School / Board annual examination last taken, with result</td><td class="v">{{tc.examResult}}</td></tr>
<tr><td class="k">10. Whether failed, if so once / twice in the same class</td><td class="v">{{tc.failed}}</td></tr>
<tr><td class="k">11. Subjects studied</td><td class="v">{{tc.subjects}}</td></tr>
<tr><td class="k">12. Whether qualified for promotion to the higher class</td><td class="v">{{tc.promotion}}</td></tr>
<tr><td class="k">13. Month up to which the school dues are paid</td><td class="v">{{tc.duesMonth}}</td></tr>
<tr><td class="k">14. Any fee concession availed, and its nature</td><td class="v">{{tc.concession}}</td></tr>
<tr><td class="k">15. Total number of working days</td><td class="v">{{tc.workingDays}}</td></tr>
<tr><td class="k">16. Total number of working days present</td><td class="v">{{tc.daysPresent}}</td></tr>
<tr><td class="k">17. Whether NCC cadet / Boy Scout / Girl Guide (give details)</td><td class="v">{{tc.ncc}}</td></tr>
<tr><td class="k">18. Games played or extra-curricular activities</td><td class="v">{{tc.activities}}</td></tr>
<tr><td class="k">19. General conduct</td><td class="v">{{tc.conduct}}</td></tr>
<tr><td class="k">20. Date of application for the certificate</td><td class="v">{{tc.applicationDate}}</td></tr>
<tr><td class="k">21. Date on which the pupil's name was struck off the rolls</td><td class="v">{{tc.struckOffDate}}</td></tr>
<tr><td class="k">22. Date of issue of the certificate</td><td class="v">{{cert.issuedOn}}</td></tr>
<tr><td class="k">23. Reason for leaving the school</td><td class="v">{{tc.reason}}</td></tr>
<tr><td class="k">24. Any other remarks</td><td class="v">{{tc.remarks}}</td></tr>
</table>
${SIGN('Prepared by')}</div>`,
  },
  {
    code: 'cert_bonafide',
    name: 'Bonafide certificate',
    kind: 'bonafide',
    typeCode: 'BONAFIDE',
    pageWidth: '210mm',
    pageHeight: '297mm',
    stylesCss: CSS,
    bodyHtml: `<div class="cert">${DUP}${HEAD}
<div class="ids"><span>No. <strong>{{cert.number}}</strong></span><span>Date <strong>{{cert.issuedOn}}</strong></span></div>
<h2>Bonafide certificate</h2>
<p class="body">This is to certify that <strong>{{student.name}}</strong>, {{student.childOf}} of {{#if student.fatherName}}Shri <strong>{{student.fatherName}}</strong>{{#if student.motherName}} and Smt. <strong>{{student.motherName}}</strong>{{/if}}{{else}}<strong>{{student.guardianName}}</strong>{{/if}}, admission no. <strong>{{student.admissionNo}}</strong>, is a bonafide student of this school, studying in <strong>{{student.classLabel}}</strong> in the academic year <strong>{{student.academicYear}}</strong>. {{student.pronounCap}} date of birth as per the school records is <strong>{{student.dob}}</strong> ({{student.dobWords}}).{{#if cert.purpose}} This certificate is issued for the purpose of <strong>{{cert.purpose}}</strong>.{{/if}}</p>
${SIGN('Prepared by')}</div>`,
  },
  {
    code: 'cert_character',
    name: 'Character certificate',
    kind: 'certificate',
    typeCode: 'CHARACTER',
    pageWidth: '210mm',
    pageHeight: '297mm',
    stylesCss: CSS,
    bodyHtml: `<div class="cert">${DUP}${HEAD}
<div class="ids"><span>No. <strong>{{cert.number}}</strong></span><span>Date <strong>{{cert.issuedOn}}</strong></span></div>
<h2>Character certificate</h2>
<p class="body">This is to certify that <strong>{{student.name}}</strong>, {{student.childOf}} of <strong>{{#if student.fatherName}}{{student.fatherName}}{{else}}{{student.guardianName}}{{/if}}</strong>, admission no. <strong>{{student.admissionNo}}</strong>, {{#if student.left}}was a student of this school from <strong>{{student.admittedOn}}</strong> to <strong>{{student.leftOn}}</strong>, last studying in <strong>{{student.classLabel}}</strong>{{else}}is a student of this school, studying in <strong>{{student.classLabel}}</strong>{{/if}}. To the best of our knowledge {{student.pronoun}} bears a <strong>{{text.conduct}}</strong> moral character{{#if fields.remark}} and {{fields.remark}}{{/if}}.{{#if cert.purpose}} This certificate is issued for <strong>{{cert.purpose}}</strong>.{{/if}}</p>
${SIGN('Prepared by')}</div>`,
  },
  {
    code: 'cert_dob',
    name: 'Date of birth certificate',
    kind: 'certificate',
    typeCode: 'DOB',
    pageWidth: '210mm',
    pageHeight: '297mm',
    stylesCss: CSS,
    bodyHtml: `<div class="cert">${DUP}${HEAD}
<div class="ids"><span>No. <strong>{{cert.number}}</strong></span><span>Date <strong>{{cert.issuedOn}}</strong></span></div>
<h2>Date of birth certificate</h2>
<p class="body">This is to certify that according to the admission register of this school the date of birth of <strong>{{student.name}}</strong>, {{student.childOf}} of <strong>{{#if student.fatherName}}{{student.fatherName}}{{else}}{{student.guardianName}}{{/if}}</strong>, admission no. <strong>{{student.admissionNo}}</strong>{{#if student.classLabel}}, <strong>{{student.classLabel}}</strong>{{/if}}, is <strong>{{student.dob}}</strong> ({{student.dobWords}}){{#if student.placeOfBirth}}, place of birth <strong>{{student.placeOfBirth}}</strong>{{/if}}.{{#if cert.purpose}} This certificate is issued for <strong>{{cert.purpose}}</strong>.{{/if}}</p>
${SIGN('Prepared by')}</div>`,
  },
];
