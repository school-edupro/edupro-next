/** Configurable application form (S8): the default schema a new admission cycle starts from. */
export interface FormField {
  key: string;
  label: string;
  labelHi?: string;
  type: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'boolean' | 'email' | 'mobile';
  required?: boolean;
  options?: Array<{ value: string; label: string; labelHi?: string }>;
  section: string;
  sectionHi?: string;
  /** For number fields: bounds. */
  min?: number;
  max?: number;
}

export const DEFAULT_ADMISSION_FORM: FormField[] = [
  {
    key: 'fatherName',
    label: "Father's name",
    labelHi: 'पिता का नाम',
    type: 'text',
    required: true,
    section: 'Parents',
    sectionHi: 'अभिभावक',
  },
  {
    key: 'fatherOccupation',
    label: "Father's occupation",
    labelHi: 'पिता का व्यवसाय',
    type: 'text',
    section: 'Parents',
    sectionHi: 'अभिभावक',
  },
  {
    key: 'motherName',
    label: "Mother's name",
    labelHi: 'माता का नाम',
    type: 'text',
    required: true,
    section: 'Parents',
    sectionHi: 'अभिभावक',
  },
  {
    key: 'motherOccupation',
    label: "Mother's occupation",
    labelHi: 'माता का व्यवसाय',
    type: 'text',
    section: 'Parents',
    sectionHi: 'अभिभावक',
  },
  {
    key: 'email',
    label: 'Email',
    labelHi: 'ईमेल',
    type: 'email',
    required: true,
    section: 'Contact',
    sectionHi: 'संपर्क',
  },
  {
    key: 'address',
    label: 'Residential address',
    labelHi: 'आवासीय पता',
    type: 'textarea',
    required: true,
    section: 'Contact',
    sectionHi: 'संपर्क',
  },
  {
    key: 'city',
    label: 'City',
    labelHi: 'शहर',
    type: 'text',
    required: true,
    section: 'Contact',
    sectionHi: 'संपर्क',
  },
  {
    key: 'pin',
    label: 'PIN code',
    labelHi: 'पिन कोड',
    type: 'text',
    required: true,
    section: 'Contact',
    sectionHi: 'संपर्क',
  },
  {
    key: 'distanceKm',
    label: 'Distance from school (km)',
    labelHi: 'विद्यालय से दूरी (किमी)',
    type: 'number',
    min: 0,
    max: 200,
    section: 'Contact',
    sectionHi: 'संपर्क',
  },
  {
    key: 'category',
    label: 'Category',
    labelHi: 'श्रेणी',
    type: 'select',
    required: true,
    options: [
      { value: 'GEN', label: 'General', labelHi: 'सामान्य' },
      { value: 'EWS', label: 'EWS / DG', labelHi: 'ईडब्ल्यूएस / डीजी' },
      { value: 'OBC', label: 'OBC', labelHi: 'ओबीसी' },
      { value: 'SC', label: 'SC', labelHi: 'एससी' },
      { value: 'ST', label: 'ST', labelHi: 'एसटी' },
    ],
    section: 'Child',
    sectionHi: 'बच्चा',
  },
  {
    key: 'previousSchool',
    label: 'Previous school (if any)',
    labelHi: 'पिछला विद्यालय (यदि कोई)',
    type: 'text',
    section: 'Child',
    sectionHi: 'बच्चा',
  },
  {
    key: 'siblingInSchool',
    label: 'A sibling studies in this school',
    labelHi: 'भाई/बहन इसी विद्यालय में पढ़ता है',
    type: 'boolean',
    section: 'Points',
    sectionHi: 'अंक',
  },
  {
    key: 'siblingAdmissionNo',
    label: "Sibling's admission number",
    labelHi: 'भाई/बहन की प्रवेश संख्या',
    type: 'text',
    section: 'Points',
    sectionHi: 'अंक',
  },
  {
    key: 'alumniParent',
    label: 'A parent is an alumnus of this school',
    labelHi: 'अभिभावक इसी विद्यालय के पूर्व छात्र हैं',
    type: 'boolean',
    section: 'Points',
    sectionHi: 'अंक',
  },
  {
    key: 'staffWard',
    label: 'Ward of a staff member',
    labelHi: 'कर्मचारी का बच्चा',
    type: 'boolean',
    section: 'Points',
    sectionHi: 'अंक',
  },
  {
    key: 'singleGirlChild',
    label: 'Single girl child',
    labelHi: 'एकल बालिका',
    type: 'boolean',
    section: 'Points',
    sectionHi: 'अंक',
  },
];

/** Validates answers against a schema; returns problems keyed by field (empty when valid). */
export function validateFormData(
  schema: FormField[],
  data: Record<string, unknown>,
): Array<{ field: string; message: string }> {
  const problems: Array<{ field: string; message: string }> = [];
  for (const f of schema) {
    const v = data[f.key];
    const empty = v === undefined || v === null || v === '' || v === false;
    if (f.required && empty) {
      problems.push({ field: f.key, message: 'required' });
      continue;
    }
    if (empty) continue;
    switch (f.type) {
      case 'number':
        if (typeof v !== 'number' || Number.isNaN(v))
          problems.push({ field: f.key, message: 'number' });
        else if ((f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max))
          problems.push({ field: f.key, message: `between ${f.min ?? '-'} and ${f.max ?? '-'}` });
        break;
      case 'boolean':
        if (typeof v !== 'boolean') problems.push({ field: f.key, message: 'true or false' });
        break;
      case 'select':
        if (!f.options?.some((o) => o.value === v))
          problems.push({ field: f.key, message: 'not an option' });
        break;
      case 'email':
        if (typeof v !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v))
          problems.push({ field: f.key, message: 'invalid email' });
        break;
      case 'mobile':
        if (typeof v !== 'string' || !/^[6-9]\d{9}$/.test(v))
          problems.push({ field: f.key, message: '10 digits' });
        break;
      case 'date':
        if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v))
          problems.push({ field: f.key, message: 'YYYY-MM-DD' });
        break;
      default:
        if (typeof v !== 'string') problems.push({ field: f.key, message: 'text' });
        else if (v.length > 2000) problems.push({ field: f.key, message: 'too long' });
    }
  }
  for (const key of Object.keys(data))
    if (!schema.some((f) => f.key === key)) problems.push({ field: key, message: 'unknown field' });
  return problems;
}
