/**
 * Domain 6 (Sprint 9): attendance for the current and previous year. Legacy `attendance` rows
 * (sadmission, sclass, attendancedate, attendance code, subject_code, emp_id) become day or subject marks;
 * `attendancelogs_rfid` (RFID_Tag, LogDateTime, Direction, DeviceId) become RFID events. Transforms only;
 * the loader joins the attendance ETL rehearsal.
 */
import type { Step } from '../pipeline';
import { reject, type Reject } from '../reject';
import {
  combineDateTime,
  normaliseDate,
  normaliseYearCode,
  splitLegacySection,
  text,
} from '../transforms';

type Rejects = Array<Reject & { column?: string; legacyKey?: string }>;

export type AttendanceCode = 'P' | 'A' | 'L' | 'SR' | 'H' | 'OD' | 'SB';

/** Legacy codes: P, A, L, SR (short leave), A.5 / HD (half day), OD (on duty), STAY BACK / SB. */
export function normaliseAttendanceCode(v: unknown): AttendanceCode | null {
  const s = String(v ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  if (s === '') return null;
  if (['P', 'PRESENT'].includes(s)) return 'P';
  if (['A', 'ABSENT', 'AB'].includes(s)) return 'A';
  if (['L', 'LATE'].includes(s)) return 'L';
  if (['SR', 'SHORT LEAVE', 'SL'].includes(s)) return 'SR';
  if (['A.5', 'HD', 'H', 'HALF', 'HALF DAY'].includes(s)) return 'H';
  if (['OD', 'ON DUTY'].includes(s)) return 'OD';
  if (['STAY BACK', 'STAYBACK', 'SB'].includes(s)) return 'SB';
  return null;
}

export interface RawAttendance {
  sadmission?: unknown;
  sclass?: unknown;
  attendancedate?: unknown;
  attendance?: unknown;
  subject_code?: unknown;
  emp_id?: unknown;
  FinancialYear?: unknown;
}
export interface AttendanceRecord {
  admissionNo: string;
  classCode: string;
  section: string | null;
  date: string;
  code: AttendanceCode;
  kind: 'day' | 'subject';
  subjectCode: string | null;
  markedByEmpId: string | null;
  legacyYear: string | null;
}

export const attendanceStep: Step<RawAttendance, AttendanceRecord> = {
  legacyTable: 'attendance',
  transform(raw) {
    const rejects: Rejects = [];
    const adm = text(raw.sadmission);
    if (!adm)
      rejects.push({
        ...reject('attendance.admission_missing', raw.sadmission, true),
        column: 'sadmission',
      });
    const section = splitLegacySection(raw.sclass);
    if (section.kind !== 'ok') rejects.push({ ...section, column: 'sclass' });
    const date = normaliseDate(raw.attendancedate);
    if (date.kind !== 'ok') rejects.push({ ...date, column: 'attendancedate' });
    else if (date.value === null)
      rejects.push({
        ...reject('attendance.date_missing', raw.attendancedate, true),
        column: 'attendancedate',
      });
    const code = normaliseAttendanceCode(raw.attendance);
    if (!code)
      rejects.push({
        ...reject('attendance.code_unknown', raw.attendance, true),
        column: 'attendance',
      });
    const year =
      raw.FinancialYear === undefined || raw.FinancialYear === null || raw.FinancialYear === ''
        ? null
        : normaliseYearCode(raw.FinancialYear);
    if (year && year.kind !== 'ok') rejects.push({ ...year, column: 'FinancialYear' });
    if (rejects.length || !adm || section.kind !== 'ok' || date.kind !== 'ok' || !code)
      return rejects;
    const subject = text(raw.subject_code);
    return {
      legacyKey: `${adm}|${date.value}|${subject ?? 'day'}`,
      row: {
        admissionNo: adm,
        classCode: section.value.classCode,
        section: section.value.section,
        date: date.value!,
        code,
        kind: subject ? 'subject' : 'day',
        subjectCode: subject ? subject.toUpperCase() : null,
        markedByEmpId: text(raw.emp_id),
        legacyYear: year && year.kind === 'ok' ? year.value : null,
      },
    };
  },
};

export interface RawRfidLog {
  RFID_Tag?: unknown;
  LogDate?: unknown;
  LogTime?: unknown;
  LogDateTime?: unknown;
  Direction?: unknown;
  DeviceId?: unknown;
}
export interface RfidEventRecord {
  tag: string;
  at: string;
  direction: 'in' | 'out';
  deviceCode: string | null;
}

export const rfidLogStep: Step<RawRfidLog, RfidEventRecord> = {
  legacyTable: 'attendancelogs_rfid',
  transform(raw) {
    const rejects: Rejects = [];
    const tag = text(raw.RFID_Tag);
    if (!tag)
      rejects.push({ ...reject('rfid.tag_missing', raw.RFID_Tag, true), column: 'RFID_Tag' });
    const at =
      raw.LogDateTime !== undefined
        ? combineDateTime(String(raw.LogDateTime).slice(0, 10), String(raw.LogDateTime).slice(11))
        : combineDateTime(raw.LogDate, raw.LogTime);
    if (at.kind !== 'ok') rejects.push({ ...at, column: 'LogDateTime' });
    else if (at.value === null)
      rejects.push({
        ...reject('rfid.time_missing', raw.LogDateTime ?? raw.LogDate, true),
        column: 'LogDateTime',
      });
    const dir = String(raw.Direction ?? 'in')
      .trim()
      .toLowerCase();
    if (!['in', 'out', 'i', 'o', 'entry', 'exit'].includes(dir))
      rejects.push({
        ...reject('rfid.direction_unknown', raw.Direction, true),
        column: 'Direction',
      });
    if (rejects.length || !tag || at.kind !== 'ok') return rejects;
    const direction: 'in' | 'out' = ['out', 'o', 'exit'].includes(dir) ? 'out' : 'in';
    return {
      legacyKey: `${tag}|${at.value}|${direction}`,
      row: { tag, at: at.value!, direction, deviceCode: text(raw.DeviceId) },
    };
  },
};
