/** Default document templates installed per school (S7-01). Schools edit them in Settings → Templates. */
export interface DefaultTemplate {
  code: string;
  name: string;
  kind: 'transfer_certificate' | 'bonafide' | 'letter';
  pageWidth: string;
  pageHeight: string;
  bodyHtml: string;
  stylesCss: string;
}

const CSS = `
  .head { text-align: center; border-bottom: 0.6mm solid #00265D; padding-bottom: 4mm; margin-bottom: 6mm; }
  .head h1 { font-family: Poppins, Arial, sans-serif; color: #00265D; font-size: 7mm; margin: 0; letter-spacing: 0.2mm; }
  .head .sub { color: #52606D; font-size: 3.4mm; }
  h2 { font-family: Poppins, Arial, sans-serif; color: #00265D; font-size: 5.5mm; text-align: center; margin: 4mm 0 6mm; text-transform: uppercase; letter-spacing: 0.4mm; }
  .meta { display: flex; justify-content: space-between; font-size: 3.4mm; color: #52606D; margin-bottom: 4mm; }
  table.fields { width: 100%; border-collapse: collapse; font-size: 3.6mm; }
  table.fields td { padding: 2.2mm 1.5mm; border-bottom: 0.2mm solid #E4E7EB; vertical-align: top; }
  table.fields td.k { width: 42%; color: #52606D; }
  table.fields td.v { font-weight: 600; }
  p { font-size: 3.8mm; line-height: 1.6; }
  .sign { display: flex; justify-content: space-between; margin-top: 18mm; font-size: 3.4mm; }
  .sign div { width: 45%; border-top: 0.3mm solid #1F2933; padding-top: 2mm; text-align: center; }
  .tag { display: inline-block; background: #00A0C6; color: #fff; border-radius: 1mm; padding: 0.6mm 2mm; font-size: 3mm; }
`;

export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    code: 'tc_default',
    name: 'Transfer certificate',
    kind: 'transfer_certificate',
    pageWidth: '210mm',
    pageHeight: '297mm',
    stylesCss: CSS,
    bodyHtml: `<div class="head"><h1>{{school.name}}</h1><div class="sub">{{school.addressLine}}{{#if school.phone}} · {{school.phone}}{{/if}}{{#if school.affiliationNo}} · Affiliation {{school.affiliationNo}} ({{school.board}}){{/if}}</div></div>
<h2>Transfer certificate</h2>
<div class="meta"><span>TC no. <strong>{{tc.no}}</strong></span><span>Admission no. <strong>{{student.admissionNo}}</strong></span><span>Date <strong>{{tc.issuedOn}}</strong></span></div>
<table class="fields">
<tr><td class="k">1. Name of the pupil</td><td class="v">{{student.name}}</td></tr>
<tr><td class="k">2. Name of the guardian</td><td class="v">{{student.guardianName}}</td></tr>
<tr><td class="k">3. Date of birth</td><td class="v">{{student.dob}}</td></tr>
<tr><td class="k">4. Category</td><td class="v">{{student.category}}</td></tr>
<tr><td class="k">5. Date of admission</td><td class="v">{{student.admittedOn}}</td></tr>
<tr><td class="k">6. Class in which the pupil last studied</td><td class="v">{{tc.lastClass}} ({{tc.academicYear}})</td></tr>
<tr><td class="k">7. Whether qualified for promotion</td><td class="v">{{tc.promotionStatus}}</td></tr>
<tr><td class="k">8. Whether all dues are cleared</td><td class="v">{{#if tc.duesCleared}}Yes{{else}}No{{/if}}</td></tr>
<tr><td class="k">9. General conduct</td><td class="v">{{tc.conduct}}</td></tr>
<tr><td class="k">10. Reason for leaving</td><td class="v">{{tc.reason}}</td></tr>
<tr><td class="k">11. Date of issue</td><td class="v">{{tc.issuedOn}}</td></tr>
<tr><td class="k">12. Remarks</td><td class="v">{{tc.remarks}}</td></tr>
</table>
<p>Certified that the above information is in accordance with the school records.</p>
<div class="sign"><div>Prepared by<br>{{tc.issuedBy}}</div><div>Principal<br>{{school.name}}</div></div>`,
  },
  {
    code: 'bonafide_default',
    name: 'Bonafide certificate',
    kind: 'bonafide',
    pageWidth: '210mm',
    pageHeight: '297mm',
    stylesCss: CSS,
    bodyHtml: `<div class="head"><h1>{{school.name}}</h1><div class="sub">{{school.addressLine}}{{#if school.phone}} · {{school.phone}}{{/if}}</div></div>
<h2>Bonafide certificate</h2>
<div class="meta"><span>Admission no. <strong>{{student.admissionNo}}</strong></span><span>Date <strong>{{today}}</strong></span></div>
<p>This is to certify that <strong>{{student.name}}</strong>, {{#if student.guardianRelation}}{{student.guardianRelation}} of{{else}}ward of{{/if}} <strong>{{student.guardianName}}</strong>, born on {{student.dob}}, is a bonafide student of this school studying in <strong>Class {{student.classCode}}-{{student.section}}</strong> during the academic year {{student.academicYear}}.</p>
<p>This certificate is issued on the request of the guardian for official purposes.</p>
<div class="sign"><div>Class teacher</div><div>Principal<br>{{school.name}}</div></div>`,
  },
  {
    code: 'letter_default',
    name: 'Letter to the guardian',
    kind: 'letter',
    pageWidth: '210mm',
    pageHeight: '297mm',
    stylesCss: CSS,
    bodyHtml: `<div class="head"><h1>{{school.name}}</h1><div class="sub">{{school.addressLine}}</div></div>
<p>{{today}}</p>
<p>To<br><strong>{{student.guardianName}}</strong><br>Guardian of {{student.name}} (Class {{student.classCode}}-{{student.section}}, Admission no. {{student.admissionNo}})</p>
<p>Dear Sir or Madam,</p>
<p>&nbsp;</p>
<p>Yours sincerely,</p>
<div class="sign"><div>Class teacher</div><div>Principal<br>{{school.name}}</div></div>`,
  },
];
