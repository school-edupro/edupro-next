/**
 * The ready certificate templates (docs/design/87): one per type — the transfer certificate in the CBSE layout with all
 * its items, bonafide (and a "father only" variant), character, date of birth and its justification, study, caste,
 * domicile, no objection, travel, visa, scholarship, board registration, fee paid; for staff experience, service and
 * visa. Each places EduPro's blocks — {{{blocks.duplicate}}}, {{{blocks.letterhead}}}, {{{blocks.signatures}}},
 * {{{blocks.footer}}} (number, date, the QR from phase D) — around its own text. The data is the certificate's frozen
 * `data` (see certificate-data.ts in the API); `text.*` holds the typed fields as they read in a sentence.
 */
export interface CertificateTemplate {
  /** the template's code, and its ready layout (Reset to the ready layout) */
  code: string;
  name: string;
  kind: 'transfer_certificate' | 'bonafide' | 'certificate';
  /** the certificate type it is the default of (or, with variantOf, a variant of) */
  typeCode: string;
  /** a variant to choose at issue, not the type's default */
  variantOf?: string;
  pageWidth: string;
  pageHeight: string;
  stylesCss: string;
  bodyHtml: string;
}

const CSS = `
body { font-family: 'Source Sans 3', 'Segoe UI', Arial, sans-serif; color: #0b1f3a; font-size: 11pt; }
.cert { position: relative; }
.ids { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2mm 6mm; font-size: 9pt; margin: 3mm 0; }
h2 { text-align: center; font-family: Poppins, Arial, sans-serif; font-size: 14pt; letter-spacing: 0.06em; text-transform: uppercase; margin: 5mm 0 3mm; }
table.f { width: 100%; border-collapse: collapse; font-size: 10pt; }
table.f td { padding: 1.6mm 1mm; vertical-align: top; border-bottom: 1px dotted #c9d1dc; }
table.f td.k { width: 58%; }
table.f td.v { font-weight: 600; }
table.m { width: 100%; border-collapse: collapse; font-size: 10.5pt; margin: 2mm 0 4mm; }
table.m th, table.m td { border: 1px solid #c9d1dc; padding: 1.8mm 2mm; text-align: left; }
table.m .n { text-align: right; }
p.body { font-size: 12pt; line-height: 1.9; text-align: justify; margin: 8mm 0; }
p.to { font-size: 11pt; line-height: 1.6; margin: 6mm 0 0; }
`;

const A4 = { pageWidth: '210mm', pageHeight: '297mm', stylesCss: CSS };
const HEAD = `<div class="cert">{{{blocks.duplicate}}}{{{blocks.letterhead}}}
<div class="ids"><span>No. <strong>{{cert.number}}</strong></span><span>Date <strong>{{cert.issuedOn}}</strong></span></div>`;
const FOOT = `{{{blocks.signatures}}}{{{blocks.footer}}}</div>`;
const PURPOSE = `{{#if cert.purpose}} This certificate is issued for the purpose of <strong>{{cert.purpose}}</strong>.{{/if}}`;
/** a certificate with a number and date line, a title and a paragraph */
const letter = (title: string, body: string) =>
  `${HEAD}
<h2>${title}</h2>
<p class="body">${body}${PURPOSE}</p>
${FOOT}`;
/** a letter to the visa officer */
const visa = (title: string, body: string) =>
  `${HEAD}
<p class="to">To<br>The Visa Officer<br>{{#if fields.embassy}}{{fields.embassy}}{{else}}Embassy / High Commission of {{fields.country}}{{/if}}</p>
<h2>${title}</h2>
<p class="body">${body}</p>
${FOOT}`;

/** the pupil with both parents as the record holds them */
const PUPIL = `<strong>{{student.name}}</strong>, {{student.childOf}} of {{#if student.fatherName}}Shri <strong>{{student.fatherName}}</strong>{{#if student.motherName}} and Smt. <strong>{{student.motherName}}</strong>{{/if}}{{else}}<strong>{{student.guardianName}}</strong>{{/if}}, admission no. <strong>{{student.admissionNo}}</strong>`;
/** the pupil with the father (or guardian) */
const PUPIL_FATHER = `<strong>{{student.name}}</strong>, {{student.childOf}} of {{#if student.fatherName}}Shri <strong>{{student.fatherName}}</strong>{{else}}<strong>{{student.guardianName}}</strong>{{/if}}, admission no. <strong>{{student.admissionNo}}</strong>`;
const STUDYING = `{{#if student.left}}was a student of this school from <strong>{{student.admittedOn}}</strong> to <strong>{{student.leftOn}}</strong>, last studying in <strong>{{student.classLabel}}</strong>{{else}}is a bonafide student of this school, studying in <strong>{{student.classLabel}}</strong> in the academic year <strong>{{student.academicYear}}</strong>{{/if}}`;
const EMPLOYEE = `{{employee.honorific}} <strong>{{employee.name}}</strong>{{#if employee.fatherName}}, {{employee.childOf}} of Shri {{employee.fatherName}}{{/if}}, employee ID <strong>{{employee.code}}</strong>`;

export const CERTIFICATE_TEMPLATES: CertificateTemplate[] = [
  {
    code: 'cert_tc',
    name: 'Transfer certificate (CBSE layout)',
    kind: 'transfer_certificate',
    typeCode: 'TC',
    ...A4,
    bodyHtml: `<div class="cert">{{{blocks.duplicate}}}{{{blocks.letterhead}}}
<div class="ids"><span>TC no. <strong>{{cert.number}}</strong></span>{{#if cert.bookNo}}<span>Book no. <strong>{{cert.bookNo}}</strong></span><span>Sl. no. <strong>{{cert.slNo}}</strong></span>{{/if}}<span>Admission no. <strong>{{student.admissionNo}}</strong></span></div>
<div class="ids"><span>PEN <strong>{{student.pen}}</strong></span><span>APAAR ID <strong>{{student.apaar}}</strong></span>{{#if student.registrationNo}}<span>Registration no. <strong>{{student.registrationNo}}</strong></span>{{/if}}</div>
<h2>Transfer certificate</h2>
<table class="f">
<tr><td class="k">1. Name of pupil</td><td class="v">{{student.name}}</td></tr>
<tr><td class="k">2. Father's / guardian's name</td><td class="v">{{#if student.fatherName}}{{student.fatherName}}{{else}}{{student.guardianName}}{{/if}}</td></tr>
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
${FOOT}`,
  },
  {
    code: 'cert_bonafide',
    name: 'Bonafide certificate',
    kind: 'bonafide',
    typeCode: 'BONAFIDE',
    ...A4,
    bodyHtml: letter(
      'Bonafide certificate',
      `This is to certify that ${PUPIL}, ${STUDYING}. {{student.pronounPossCap}} date of birth as per the school records is <strong>{{student.dob}}</strong> ({{student.dobWords}}).`,
    ),
  },
  {
    code: 'cert_bonafide_father',
    name: 'Bonafide certificate (father only)',
    kind: 'bonafide',
    typeCode: 'BONAFIDE',
    variantOf: 'BONAFIDE',
    ...A4,
    bodyHtml: letter(
      'Bonafide certificate',
      `This is to certify that ${PUPIL_FATHER}, ${STUDYING}. {{student.pronounPossCap}} date of birth as per the school records is <strong>{{student.dob}}</strong> ({{student.dobWords}}).`,
    ),
  },
  {
    code: 'cert_character',
    name: 'Character certificate',
    kind: 'certificate',
    typeCode: 'CHARACTER',
    ...A4,
    bodyHtml: letter(
      'Character certificate',
      `This is to certify that ${PUPIL_FATHER}, {{#if student.left}}was a student of this school from <strong>{{student.admittedOn}}</strong> to <strong>{{student.leftOn}}</strong>, last studying in <strong>{{student.classLabel}}</strong>{{else}}is a student of this school, studying in <strong>{{student.classLabel}}</strong>{{/if}}. To the best of our knowledge {{student.pronoun}} bears a <strong>{{text.conduct}}</strong> moral character{{#if fields.remark}} and {{fields.remark}}{{/if}}.`,
    ),
  },
  {
    code: 'cert_dob',
    name: 'Date of birth certificate',
    kind: 'certificate',
    typeCode: 'DOB',
    ...A4,
    bodyHtml: letter(
      'Date of birth certificate',
      `This is to certify that according to the admission register of this school the date of birth of ${PUPIL_FATHER}{{#if student.classLabel}}, <strong>{{student.classLabel}}</strong>{{/if}}, is <strong>{{student.dob}}</strong> ({{student.dobWords}}){{#if student.placeOfBirth}}, place of birth <strong>{{student.placeOfBirth}}</strong>{{/if}}.`,
    ),
  },
  {
    code: 'cert_dob_just',
    name: 'Date of birth justification',
    kind: 'certificate',
    typeCode: 'DOB_JUST',
    ...A4,
    bodyHtml: letter(
      'Date of birth justification',
      `This is to certify that the date of birth of ${PUPIL_FATHER} is recorded in the admission register of this school as <strong>{{student.dob}}</strong> ({{student.dobWords}}). It was recorded at the time of admission on <strong>{{student.admittedOn}}</strong> on the basis of <strong>{{fields.basis}}</strong> submitted by the parents.{{#if fields.remark}} {{fields.remark}}.{{/if}}`,
    ),
  },
  {
    code: 'cert_study',
    name: 'Study certificate',
    kind: 'certificate',
    typeCode: 'STUDY',
    ...A4,
    bodyHtml: letter(
      'Study certificate',
      `This is to certify that ${PUPIL} has studied in this school from <strong>{{student.admittedOn}}</strong>{{#if student.left}} to <strong>{{student.leftOn}}</strong>{{else}} till date{{/if}}{{#if student.admissionClassLabel}}, from <strong>{{student.admissionClassLabel}}</strong> to <strong>{{student.classLabel}}</strong>{{/if}}.`,
    ),
  },
  {
    code: 'cert_caste',
    name: 'Caste certificate (school record)',
    kind: 'certificate',
    typeCode: 'CASTE',
    ...A4,
    bodyHtml: letter(
      'Certificate of caste (as per school record)',
      `This is to certify that ${PUPIL_FATHER} {{#if student.left}}was{{else}}is{{/if}} a student of this school{{#if student.classLabel}} ({{student.classLabel}}){{/if}}. As per the admission register, {{student.pronoun}} belongs to the <strong>{{student.category}}</strong> category{{#if student.caste}} (<strong>{{student.caste}}</strong>){{/if}}{{#if student.religion}}, religion <strong>{{student.religion}}</strong>{{/if}}. This certificate is based only on the school records.`,
    ),
  },
  {
    code: 'cert_domicile',
    name: 'Domicile (residence) certificate',
    kind: 'certificate',
    typeCode: 'DOMICILE',
    ...A4,
    bodyHtml: letter(
      'Residence certificate',
      `This is to certify that ${PUPIL_FATHER}, ${STUDYING}. As per the school records {{student.pronoun}} resides at <strong>{{student.address}}</strong>.`,
    ),
  },
  {
    code: 'cert_noc',
    name: 'No objection certificate',
    kind: 'certificate',
    typeCode: 'NOC',
    ...A4,
    bodyHtml: letter(
      'No objection certificate',
      `This is to certify that ${PUPIL_FATHER}, ${STUDYING}. The school has no objection to {{student.pronounObj}} <strong>{{fields.forWhat}}</strong>.`,
    ),
  },
  {
    code: 'cert_travel_noc',
    name: 'No objection certificate for travel',
    kind: 'certificate',
    typeCode: 'TRAVEL_NOC',
    ...A4,
    bodyHtml: letter(
      'No objection certificate',
      `This is to certify that ${PUPIL_FATHER}, ${STUDYING}. The school has no objection to {{student.pronounObj}} travelling to <strong>{{fields.country}}</strong> from <strong>{{text.fromDate}}</strong> to <strong>{{text.toDate}}</strong>{{#if fields.accompaniedBy}} with {{fields.accompaniedBy}}{{/if}}; {{student.pronoun}} will resume classes on return.`,
    ),
  },
  {
    code: 'cert_visa',
    name: 'Visa letter',
    kind: 'certificate',
    typeCode: 'VISA',
    ...A4,
    bodyHtml: visa(
      'To whom it may concern',
      `This is to certify that ${PUPIL_FATHER}, ${STUDYING}. {{student.pronounPossCap}} date of birth as per the school records is <strong>{{student.dob}}</strong>. {{student.pronounSubjCap}} has been granted leave to travel to <strong>{{fields.country}}</strong> from <strong>{{text.fromDate}}</strong> to <strong>{{text.toDate}}</strong> and will resume classes on return. The school has no objection to the visit.${PURPOSE}`,
    ),
  },
  {
    code: 'cert_scholar',
    name: 'Scholarship certificate',
    kind: 'certificate',
    typeCode: 'SCHOLAR',
    ...A4,
    bodyHtml: letter(
      'Scholarship certificate',
      `This is to certify that ${PUPIL}, ${STUDYING}. {{student.pronounPossCap}} attendance this year is <strong>{{attendance.present}}</strong> days out of <strong>{{attendance.workingDays}}</strong>{{#if attendance.percent}} (<strong>{{attendance.percent}}%</strong>){{/if}}. This certificate is issued for the <strong>{{fields.scholarship}}</strong>.`,
    ),
  },
  {
    code: 'cert_board_reg',
    name: 'Board registration verification',
    kind: 'certificate',
    typeCode: 'BOARD_REG',
    ...A4,
    bodyHtml: letter(
      'Board registration verification',
      `This is to certify that ${PUPIL_FATHER}, ${STUDYING}. {{student.pronounSubjCap}} is registered with the <strong>{{fields.board}}</strong> under registration no. <strong>{{fields.registrationNo}}</strong>{{#if fields.session}} for the session <strong>{{fields.session}}</strong>{{/if}}, with the date of birth <strong>{{student.dob}}</strong> as per the school records.`,
    ),
  },
  {
    code: 'cert_fee_paid',
    name: 'Fee paid certificate',
    kind: 'certificate',
    typeCode: 'FEE_PAID',
    ...A4,
    bodyHtml: `${HEAD}
<h2>Fee paid certificate</h2>
<p class="body">This is to certify that ${PUPIL}, ${STUDYING}, has paid the following fees to the school in the academic year <strong>{{fees.year}}</strong>.${PURPOSE}</p>
<table class="m"><tr><th>Fee head</th><th class="n">Paid (₹)</th></tr>{{#each fees.heads}}<tr><td>{{name}}</td><td class="n">{{amount}}</td></tr>{{/each}}<tr><th>Total</th><th class="n">{{fees.total}}</th></tr></table>
<p class="to">Total paid: <strong>₹{{fees.total}}</strong>{{#if fees.totalWords}} (rupees {{fees.totalWords}} only){{/if}}.</p>
${FOOT}`,
  },
  {
    code: 'cert_experience',
    name: 'Experience certificate',
    kind: 'certificate',
    typeCode: 'EXPERIENCE',
    ...A4,
    bodyHtml: letter(
      'Experience certificate',
      `This is to certify that ${EMPLOYEE}, worked in this school as <strong>{{employee.designation}}</strong>{{#if employee.department}} ({{employee.department}}){{/if}} from <strong>{{employee.joinedOn}}</strong> to <strong>{{employee.leftOn}}</strong>. During this period {{employee.pronoun}} was found <strong>{{text.conduct}}</strong> in {{employee.pronounPoss}} work and conduct.{{#if fields.remark}} {{fields.remark}}.{{/if}} We wish {{employee.pronounObj}} success in the future.`,
    ),
  },
  {
    code: 'cert_service',
    name: 'Service certificate',
    kind: 'certificate',
    typeCode: 'SERVICE',
    ...A4,
    bodyHtml: letter(
      'Service certificate',
      `This is to certify that ${EMPLOYEE}, is working in this school as <strong>{{employee.designation}}</strong>{{#if employee.department}} ({{employee.department}}){{/if}} since <strong>{{employee.joinedOn}}</strong>.`,
    ),
  },
  {
    code: 'cert_staff_visa',
    name: 'Staff visa NOC',
    kind: 'certificate',
    typeCode: 'STAFF_VISA',
    ...A4,
    bodyHtml: visa(
      'No objection certificate',
      `This is to certify that ${EMPLOYEE}, is working in this school as <strong>{{employee.designation}}</strong> since <strong>{{employee.joinedOn}}</strong>. {{employee.pronounSubjCap}} has been granted leave from <strong>{{text.fromDate}}</strong> to <strong>{{text.toDate}}</strong> to travel to <strong>{{fields.country}}</strong> and will resume duty on return. The school has no objection to the visit.${PURPOSE}`,
    ),
  },
];

/** A ready template by its code (Reset to the ready layout). */
export const readyTemplate = (code: string): CertificateTemplate | undefined =>
  CERTIFICATE_TEMPLATES.find((t) => t.code === code);
