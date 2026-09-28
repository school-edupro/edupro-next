import type { Step } from '../pipeline';
import { reject, type Reject } from '../reject';
import { normaliseCode, normaliseStatus, text, toMoney, yesNoToBoolean } from '../transforms';

type Rejects = Array<Reject & { column?: string; legacyKey?: string }>;

// ---- Sprint 14: exam masters (exam_type, exam_master, exam_subject_master, exam_grade_master) ---------

export interface RawExamType {
  exam_code?: unknown;
  exam_name?: unknown;
  weightage?: unknown;
  status?: unknown;
}
export interface ExamTypeRecord {
  code: string;
  name: string;
  weightage: string | null;
  status: 'active' | 'inactive';
}

export const examTypeStep: Step<RawExamType, ExamTypeRecord> = {
  legacyTable: 'exam_type',
  transform(raw) {
    const rejects: Rejects = [];
    const code = normaliseCode(raw.exam_code);
    if (code.kind !== 'ok') rejects.push({ ...code, column: 'exam_code' });
    const w = toMoney(raw.weightage ?? null);
    if (w.kind !== 'ok') rejects.push({ ...w, column: 'weightage' });
    const status = normaliseStatus(raw.status);
    if (status.kind !== 'ok') rejects.push({ ...status, column: 'status' });
    if (rejects.length || code.kind !== 'ok') return rejects;
    return {
      legacyKey: code.value,
      row: {
        code: code.value,
        name: text(raw.exam_name) ?? code.value,
        weightage: w.kind === 'ok' ? w.value : null,
        status: status.kind === 'ok' && status.value === 'inactive' ? 'inactive' : 'active',
      },
    };
  },
};

/** exam_master: one row per (exam type, class) with portal and upload flags; becomes an exam per year and class. */
export interface RawExamMaster {
  exam_code?: unknown;
  examtype?: unknown;
  master_class?: unknown;
  exam_name?: unknown;
  ShowPortal?: unknown;
  mark_upload?: unknown;
  FinancialYear?: unknown;
  start_date?: unknown;
  end_date?: unknown;
}
export interface ExamMasterRecord {
  code: string;
  typeCode: string;
  classCode: string;
  name: string;
  showOnPortal: boolean;
  marksLocked: boolean;
}

export const examMasterStep: Step<RawExamMaster, ExamMasterRecord> = {
  legacyTable: 'exam_master',
  transform(raw) {
    const rejects: Rejects = [];
    const code = normaliseCode(raw.exam_code);
    if (code.kind !== 'ok') rejects.push({ ...code, column: 'exam_code' });
    const type = normaliseCode(raw.examtype);
    if (type.kind !== 'ok') rejects.push({ ...type, column: 'examtype' });
    const cls = text(raw.master_class)?.toUpperCase() ?? null;
    if (!cls)
      rejects.push({
        ...reject('exam.class_missing', raw.master_class, true),
        column: 'master_class',
      });
    const portal = yesNoToBoolean(raw.ShowPortal);
    if (portal.kind !== 'ok') rejects.push({ ...portal, column: 'ShowPortal' });
    const upload = yesNoToBoolean(raw.mark_upload);
    if (upload.kind !== 'ok') rejects.push({ ...upload, column: 'mark_upload' });
    if (rejects.length || code.kind !== 'ok' || type.kind !== 'ok' || !cls) return rejects;
    return {
      legacyKey: `${code.value}|${cls}`,
      row: {
        code: code.value,
        typeCode: type.value,
        classCode: cls,
        name: text(raw.exam_name) ?? code.value,
        showOnPortal: portal.kind === 'ok' ? (portal.value ?? false) : false,
        // legacy mark_upload = 1 means teachers may still upload marks; 0 means the entry is closed
        marksLocked: upload.kind === 'ok' && upload.value === false,
      },
    };
  },
};

export interface RawExamSubject {
  exam_code?: unknown;
  sclass?: unknown;
  subject_code?: unknown;
  max_marks?: unknown;
  weightage?: unknown;
  elective?: unknown;
  EntryLockStatus?: unknown;
}
export interface ExamSubjectRecord {
  examCode: string;
  classCode: string;
  subjectCode: string;
  maxMarks: string;
  weightage: string | null;
  isElective: boolean;
  entryLocked: boolean;
}

export const examSubjectStep: Step<RawExamSubject, ExamSubjectRecord> = {
  legacyTable: 'exam_subject_master',
  transform(raw) {
    const rejects: Rejects = [];
    const exam = normaliseCode(raw.exam_code);
    if (exam.kind !== 'ok') rejects.push({ ...exam, column: 'exam_code' });
    const cls = text(raw.sclass)?.toUpperCase() ?? null;
    if (!cls)
      rejects.push({ ...reject('exam_subject.class_missing', raw.sclass, true), column: 'sclass' });
    const subject = normaliseCode(raw.subject_code);
    if (subject.kind !== 'ok') rejects.push({ ...subject, column: 'subject_code' });
    const max = toMoney(raw.max_marks);
    if (max.kind !== 'ok') rejects.push({ ...max, column: 'max_marks' });
    else if (max.value === null || Number(max.value) <= 0)
      rejects.push({
        ...reject('exam_subject.max_marks_invalid', raw.max_marks, true),
        column: 'max_marks',
      });
    const w = toMoney(raw.weightage ?? null);
    if (w.kind !== 'ok') rejects.push({ ...w, column: 'weightage' });
    const elective = yesNoToBoolean(raw.elective);
    const locked = yesNoToBoolean(raw.EntryLockStatus);
    if (rejects.length || exam.kind !== 'ok' || !cls || subject.kind !== 'ok' || max.kind !== 'ok')
      return rejects;
    return {
      legacyKey: `${exam.value}|${cls}|${subject.value}`,
      row: {
        examCode: exam.value,
        classCode: cls,
        subjectCode: subject.value,
        maxMarks: Number(max.value).toFixed(2),
        weightage: w.kind === 'ok' ? w.value : null,
        isElective: elective.kind === 'ok' ? (elective.value ?? false) : false,
        entryLocked: locked.kind === 'ok' ? (locked.value ?? false) : false,
      },
    };
  },
};

/** exam_grade_master: RangeFrom-RangeTo (marks out of MaxMarks) → Grade / GradePoints per MasterClass. */
export interface RawGradeBand {
  MasterClass?: unknown;
  MaxMarks?: unknown;
  RangeFrom?: unknown;
  RangeTo?: unknown;
  Grade?: unknown;
  GradePoints?: unknown;
  Remark?: unknown;
}
export interface GradeBandRecord {
  scaleCode: string;
  classGroup: string;
  minPct: number;
  maxPct: number;
  grade: string;
  points: number | null;
  remark: string | null;
}

export const gradeBandStep: Step<RawGradeBand, GradeBandRecord> = {
  legacyTable: 'exam_grade_master',
  transform(raw) {
    const rejects: Rejects = [];
    const group = text(raw.MasterClass)?.toUpperCase() ?? 'ALL';
    const max = toMoney(raw.MaxMarks ?? '100');
    const from = toMoney(raw.RangeFrom);
    const to = toMoney(raw.RangeTo);
    for (const [k, r] of [
      ['MaxMarks', max],
      ['RangeFrom', from],
      ['RangeTo', to],
    ] as const)
      if (r.kind !== 'ok') rejects.push({ ...r, column: k });
    const grade = text(raw.Grade);
    if (!grade) rejects.push({ ...reject('grade.missing', raw.Grade, true), column: 'Grade' });
    const points = toMoney(raw.GradePoints ?? null);
    if (points.kind !== 'ok') rejects.push({ ...points, column: 'GradePoints' });
    if (rejects.length || max.kind !== 'ok' || from.kind !== 'ok' || to.kind !== 'ok' || !grade)
      return rejects;
    const denom = Number(max.value ?? 100) || 100;
    const minPct = Math.round((Number(from.value ?? 0) / denom) * 10000) / 100;
    const maxPct = Math.round((Number(to.value ?? denom) / denom) * 10000) / 100;
    if (maxPct < minPct)
      return [
        { ...reject('grade.range_inverted', `${from.value}-${to.value}`, true), column: 'RangeTo' },
      ];
    return {
      legacyKey: `${group}|${grade}`,
      row: {
        scaleCode: `LEGACY_${group.replace(/[^A-Z0-9]+/g, '_')}`,
        classGroup: group,
        minPct,
        maxPct,
        grade,
        points: points.kind === 'ok' && points.value !== null ? Number(points.value) : null,
        remark: text(raw.Remark),
      },
    };
  },
};

/** Groups band rows into one scale per legacy class group, sorted from the highest band down. */
export function collapseGradeScales(
  rows: GradeBandRecord[],
): Array<{ code: string; name: string; bands: GradeBandRecord[] }> {
  const scales = new Map<string, GradeBandRecord[]>();
  for (const r of rows) {
    const list = scales.get(r.scaleCode) ?? [];
    list.push(r);
    scales.set(r.scaleCode, list);
  }
  return [...scales.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, bands]) => ({
      code,
      name: `Legacy scale ${bands[0]!.classGroup}`,
      bands: [...bands].sort((a, b) => b.minPct - a.minPct),
    }));
}

// ---- Sprint 15: exam entry (exam_mark_entry, exam_indicator_entry, exam_remark, exam_attendance, exam_health_statistics)

/** exam_mark_entry: one row per student, exam and subject. 'AB' and 'EX' in marks_obt become flags. */
export interface RawMarkEntry {
  sadmission?: unknown;
  sclass?: unknown;
  exam_code?: unknown;
  subject_code?: unknown;
  mastersubject_code?: unknown;
  marks_obt?: unknown;
  max_marks?: unknown;
  FinancialYear?: unknown;
  submitted_by?: unknown;
}
export interface MarkEntryRecord {
  admissionNo: string;
  classCode: string;
  examCode: string;
  subjectCode: string;
  marks: string | null;
  absent: boolean;
  exempt: boolean;
  maxMarks: string | null;
  legacyRef: string;
}

export const markEntryStep: Step<RawMarkEntry, MarkEntryRecord> = {
  legacyTable: 'exam_mark_entry',
  transform(raw) {
    const rejects: Rejects = [];
    const adm = text(raw.sadmission);
    if (!adm)
      rejects.push({ ...reject('admission_missing', raw.sadmission, true), column: 'sadmission' });
    const exam = normaliseCode(raw.exam_code);
    if (exam.kind !== 'ok') rejects.push({ ...exam, column: 'exam_code' });
    const subject = normaliseCode(raw.subject_code ?? raw.mastersubject_code);
    if (subject.kind !== 'ok') rejects.push({ ...subject, column: 'subject_code' });
    const cls = text(raw.sclass);
    if (!cls) rejects.push({ ...reject('class_missing', raw.sclass, true), column: 'sclass' });
    const flag = String(raw.marks_obt ?? '')
      .trim()
      .toUpperCase();
    const absent = flag === 'AB' || flag === 'A' || flag === 'ABSENT';
    const exempt = flag === 'EX' || flag === 'EXEMPT' || flag === 'NA';
    let marks: string | null = null;
    if (!absent && !exempt) {
      const m = toMoney(raw.marks_obt ?? null);
      // marks are a blocking reject: a wrong figure on a report card is worse than a missing one
      if (m.kind !== 'ok' || m.value === null)
        rejects.push({ ...reject('marks_invalid', raw.marks_obt, true), column: 'marks_obt' });
      else marks = m.value;
    }
    const max = toMoney(raw.max_marks ?? null);
    if (max.kind !== 'ok') rejects.push({ ...max, column: 'max_marks' });
    if (
      marks !== null &&
      max.kind === 'ok' &&
      max.value !== null &&
      Number(marks) > Number(max.value)
    )
      rejects.push({ ...reject('marks_above_max', raw.marks_obt, true), column: 'marks_obt' });
    if (rejects.length || !adm || !cls || exam.kind !== 'ok' || subject.kind !== 'ok')
      return rejects;
    const key = `${adm}|${exam.value}|${cls}|${subject.value}`;
    return {
      legacyKey: key,
      row: {
        admissionNo: adm,
        classCode: cls,
        examCode: exam.value,
        subjectCode: subject.value,
        marks,
        absent,
        exempt,
        maxMarks: max.kind === 'ok' ? max.value : null,
        legacyRef: key,
      },
    };
  },
};

/** exam_indicator_entry: a grade per student, exam, indicator type and sub-indicator (names, not codes, in legacy). */
export interface RawIndicatorEntry {
  sadmission?: unknown;
  sclass?: unknown;
  exam_type?: unknown;
  exam_code?: unknown;
  indicatortype?: unknown;
  subindicator?: unknown;
  indicator_desc?: unknown;
  grade?: unknown;
  status?: unknown;
}
export interface IndicatorEntryRecord {
  admissionNo: string;
  classCode: string;
  examCode: string;
  indicatorType: string;
  subIndicator: string;
  description: string | null;
  grade: string;
  legacyRef: string;
}
export const indicatorEntryStep: Step<RawIndicatorEntry, IndicatorEntryRecord> = {
  legacyTable: 'exam_indicator_entry',
  transform(raw) {
    const rejects: Rejects = [];
    const adm = text(raw.sadmission);
    if (!adm)
      rejects.push({ ...reject('admission_missing', raw.sadmission, true), column: 'sadmission' });
    const exam = normaliseCode(raw.exam_code ?? raw.exam_type);
    if (exam.kind !== 'ok') rejects.push({ ...exam, column: 'exam_code' });
    const cls = text(raw.sclass);
    const type = text(raw.indicatortype);
    const sub = text(raw.subindicator);
    const grade = text(raw.grade)?.toUpperCase() ?? null;
    if (!grade) rejects.push({ ...reject('grade_missing', raw.grade), column: 'grade' });
    if (!type || !sub)
      rejects.push({ ...reject('indicator_missing', raw.indicatortype), column: 'indicatortype' });
    if (rejects.length || !adm || !cls || !type || !sub || !grade || exam.kind !== 'ok')
      return rejects;
    const key = `${adm}|${exam.value}|${type}|${sub}|${text(raw.indicator_desc) ?? ''}`;
    return {
      legacyKey: key,
      row: {
        admissionNo: adm,
        classCode: cls,
        examCode: exam.value,
        indicatorType: type,
        subIndicator: sub,
        description: text(raw.indicator_desc),
        grade,
        legacyRef: key,
      },
    };
  },
};

/** exam_remark: remarks per student and exam; remark1..4 come from the bank, any_other is free text. */
export interface RawExamRemark {
  sadmission?: unknown;
  sclass?: unknown;
  exam_code?: unknown;
  exam_type?: unknown;
  remarks?: unknown;
  remark2?: unknown;
  remark3?: unknown;
  remark4?: unknown;
  any_other?: unknown;
  remark_id?: unknown;
  status?: unknown;
}
export interface ExamRemarkRecord {
  admissionNo: string;
  classCode: string;
  examCode: string;
  remark: string;
  bankCode: string | null;
  legacyRef: string;
}
export const examRemarkStep: Step<RawExamRemark, ExamRemarkRecord> = {
  legacyTable: 'exam_remark',
  transform(raw) {
    const rejects: Rejects = [];
    const adm = text(raw.sadmission);
    if (!adm)
      rejects.push({ ...reject('admission_missing', raw.sadmission, true), column: 'sadmission' });
    const exam = normaliseCode(raw.exam_code ?? raw.exam_type);
    if (exam.kind !== 'ok') rejects.push({ ...exam, column: 'exam_code' });
    const cls = text(raw.sclass);
    const parts = [raw.remarks, raw.remark2, raw.remark3, raw.remark4, raw.any_other]
      .map((x) => text(x))
      .filter((x): x is string => !!x);
    const remark = parts.join(' ').slice(0, 600);
    if (!remark) rejects.push({ ...reject('remark_empty', raw.remarks), column: 'remarks' });
    if (rejects.length || !adm || !cls || exam.kind !== 'ok') return rejects;
    const key = `${adm}|${exam.value}`;
    return {
      legacyKey: key,
      row: {
        admissionNo: adm,
        classCode: cls,
        examCode: exam.value,
        remark,
        bankCode: text(raw.remark_id),
        legacyRef: key,
      },
    };
  },
};

/** exam_attendance: attendance / total_days per student and exam. */
export interface RawExamAttendance {
  sadmission?: unknown;
  sclass?: unknown;
  exam_type?: unknown;
  exam_code?: unknown;
  attendance?: unknown;
  total_days?: unknown;
}
export interface ExamAttendanceRecord {
  admissionNo: string;
  classCode: string;
  examCode: string;
  daysPresent: number;
  daysTotal: number;
  legacyRef: string;
}
export const examAttendanceStep: Step<RawExamAttendance, ExamAttendanceRecord> = {
  legacyTable: 'exam_attendance',
  transform(raw) {
    const rejects: Rejects = [];
    const adm = text(raw.sadmission);
    if (!adm)
      rejects.push({ ...reject('admission_missing', raw.sadmission, true), column: 'sadmission' });
    const exam = normaliseCode(raw.exam_code ?? raw.exam_type);
    if (exam.kind !== 'ok') rejects.push({ ...exam, column: 'exam_code' });
    const cls = text(raw.sclass);
    const present = Number(String(raw.attendance ?? '').trim());
    const total = Number(String(raw.total_days ?? '').trim());
    if (!Number.isInteger(present) || present < 0)
      rejects.push({ ...reject('attendance_invalid', raw.attendance), column: 'attendance' });
    if (!Number.isInteger(total) || total <= 0)
      rejects.push({ ...reject('total_days_invalid', raw.total_days), column: 'total_days' });
    if (Number.isInteger(present) && Number.isInteger(total) && present > total)
      rejects.push({ ...reject('attendance_above_total', raw.attendance), column: 'attendance' });
    if (rejects.length || !adm || !cls || exam.kind !== 'ok') return rejects;
    const key = `${adm}|${exam.value}`;
    return {
      legacyKey: key,
      row: {
        admissionNo: adm,
        classCode: cls,
        examCode: exam.value,
        daysPresent: present,
        daysTotal: total,
        legacyRef: key,
      },
    };
  },
};

/** exam_health_statistics: height (cm or m in legacy) and weight per student and exam. */
export interface RawHealthStatistic {
  sadmission?: unknown;
  sclass?: unknown;
  exam_type?: unknown;
  exam_code?: unknown;
  height?: unknown;
  weight?: unknown;
  FinancialYear?: unknown;
}
export interface HealthRecordRecord {
  admissionNo: string;
  classCode: string;
  examCode: string;
  heightCm: string | null;
  weightKg: string | null;
  legacyRef: string;
}
export const healthStatisticStep: Step<RawHealthStatistic, HealthRecordRecord> = {
  legacyTable: 'exam_health_statistics',
  transform(raw) {
    const rejects: Rejects = [];
    const adm = text(raw.sadmission);
    if (!adm)
      rejects.push({ ...reject('admission_missing', raw.sadmission, true), column: 'sadmission' });
    const exam = normaliseCode(raw.exam_code ?? raw.exam_type);
    if (exam.kind !== 'ok') rejects.push({ ...exam, column: 'exam_code' });
    const cls = text(raw.sclass);
    let h = Number(String(raw.height ?? '').replace(/[^\d.]/g, ''));
    let w = Number(String(raw.weight ?? '').replace(/[^\d.]/g, ''));
    if (Number.isFinite(h) && h > 0 && h < 3) h = Math.round(h * 1000) / 10; // metres in the clinic table
    const heightCm = Number.isFinite(h) && h >= 40 && h <= 250 ? h.toFixed(1) : null;
    const weightKg = Number.isFinite(w) && w >= 3 && w <= 200 ? w.toFixed(2) : null;
    if (heightCm === null && weightKg === null)
      rejects.push({ ...reject('health_empty', raw.height), column: 'height' });
    if (rejects.length || !adm || !cls || exam.kind !== 'ok') return rejects;
    const key = `${adm}|${exam.value}`;
    return {
      legacyKey: key,
      row: {
        admissionNo: adm,
        classCode: cls,
        examCode: exam.value,
        heightCm,
        weightKg,
        legacyRef: key,
      },
    };
  },
};
