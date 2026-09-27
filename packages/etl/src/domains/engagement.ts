/**
 * Domain 7 (Sprint 10): communication and engagement history. Legacy `employee_notice` (sname, EmpId, notice,
 * noticetitle, NoticeDate) becomes staff notices; `homework_master` (sclass, subject, homeworkdate, homework,
 * homeworkimage, FinancialYear) becomes daily work; `parent_query` + `parent_query_responses` become queries
 * with threaded responses. Transforms only; the loader joins the engagement ETL rehearsal.
 */
import type { Step } from '../pipeline';
import { reject, type Reject } from '../reject';
import {
  normaliseDate,
  normaliseYearCode,
  repairMojibake,
  splitLegacySection,
  text,
} from '../transforms';

type Rejects = Array<Reject & { column?: string; legacyKey?: string }>;

export interface RawEmployeeNotice {
  srno?: unknown;
  sname?: unknown;
  EmpId?: unknown;
  notice?: unknown;
  noticetitle?: unknown;
  NoticeDate?: unknown;
}
export interface NoticeRecord {
  legacyId: string;
  title: string;
  body: string;
  audience: 'employees';
  employeeCode: string | null;
  publishedOn: string;
}

export const employeeNoticeStep: Step<RawEmployeeNotice, NoticeRecord> = {
  legacyTable: 'employee_notice',
  transform(raw) {
    const rejects: Rejects = [];
    const id = text(raw.srno);
    if (!id) rejects.push({ ...reject('notice.id_missing', raw.srno, true), column: 'srno' });
    const title = repairMojibake(raw.noticetitle) ?? '';
    const body = repairMojibake(raw.notice) ?? '';
    if (!title && !body) rejects.push({ ...reject('notice.empty', null, true), column: 'notice' });
    const date = normaliseDate(raw.NoticeDate);
    if (date.kind !== 'ok') rejects.push({ ...date, column: 'NoticeDate' });
    else if (date.value === null)
      rejects.push({
        ...reject('notice.date_missing', raw.NoticeDate, true),
        column: 'NoticeDate',
      });
    if (rejects.length || !id || date.kind !== 'ok') return rejects;
    return {
      legacyKey: id,
      row: {
        legacyId: id,
        title: (title || body.slice(0, 80)).trim(),
        body: body || title,
        audience: 'employees',
        employeeCode: text(raw.EmpId),
        publishedOn: date.value!,
      },
    };
  },
};

export interface RawHomework {
  srno?: unknown;
  sclass?: unknown;
  subject?: unknown;
  homeworkdate?: unknown;
  homework?: unknown;
  homeworkimage?: unknown;
  FinancialYear?: unknown;
}
export interface HomeworkRecord {
  legacyId: string;
  classCode: string;
  section: string | null;
  subjectName: string | null;
  assignedOn: string;
  title: string;
  body: string;
  imageFile: string | null;
  legacyYear: string | null;
}

export const homeworkStep: Step<RawHomework, HomeworkRecord> = {
  legacyTable: 'homework_master',
  transform(raw) {
    const rejects: Rejects = [];
    const id = text(raw.srno);
    if (!id) rejects.push({ ...reject('homework.id_missing', raw.srno, true), column: 'srno' });
    const section = splitLegacySection(raw.sclass);
    if (section.kind !== 'ok') rejects.push({ ...section, column: 'sclass' });
    const date = normaliseDate(raw.homeworkdate);
    if (date.kind !== 'ok') rejects.push({ ...date, column: 'homeworkdate' });
    else if (date.value === null)
      rejects.push({
        ...reject('homework.date_missing', raw.homeworkdate, true),
        column: 'homeworkdate',
      });
    const body = repairMojibake(raw.homework) ?? '';
    if (!body.trim()) rejects.push({ ...reject('homework.empty', null, true), column: 'homework' });
    const year =
      raw.FinancialYear === undefined || raw.FinancialYear === null || raw.FinancialYear === ''
        ? null
        : normaliseYearCode(raw.FinancialYear);
    if (year && year.kind !== 'ok') rejects.push({ ...year, column: 'FinancialYear' });
    if (rejects.length || !id || section.kind !== 'ok' || date.kind !== 'ok') return rejects;
    const subject = text(raw.subject);
    return {
      legacyKey: id,
      row: {
        legacyId: id,
        classCode: section.value.classCode,
        section: section.value.section,
        subjectName: subject,
        assignedOn: date.value!,
        title: `${subject ?? 'Homework'} · ${date.value}`,
        body: body.trim(),
        imageFile: text(raw.homeworkimage),
        legacyYear: year && year.kind === 'ok' ? year.value : null,
      },
    };
  },
};

export interface RawParentQuery {
  query_id?: unknown;
  srno?: unknown;
  sadmission?: unknown;
  sname?: unknown;
  sclass?: unknown;
  parentquery?: unknown;
  query_type?: unknown;
  query_date?: unknown;
  status?: unknown;
  attachment?: unknown;
  FinancialYear?: unknown;
}
export interface QueryRecord {
  legacyId: string;
  admissionNo: string;
  classCode: string | null;
  section: string | null;
  categoryCode: string;
  subject: string;
  body: string;
  status: 'open' | 'answered' | 'closed';
  openedAt: string;
  attachment: string | null;
  legacyYear: string | null;
}

/** Legacy query types were free text; map the common ones onto the S10 categories. */
export function normaliseQueryCategory(v: unknown): string {
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  if (!s) return 'other';
  if (/fee|payment|receipt|challan/.test(s)) return 'fees';
  if (/bus|transport|route|driver/.test(s)) return 'transport';
  if (/academic|homework|exam|marks|study|teacher/.test(s)) return 'academics';
  if (/leave|attendance|absent/.test(s)) return 'attendance';
  if (/admin|office|document|certificate|tc|id card/.test(s)) return 'admin';
  return 'other';
}

export function normaliseQueryStatus(v: unknown): 'open' | 'answered' | 'closed' {
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  if (['complete', 'completed', 'closed', 'resolved', '2'].includes(s)) return 'closed';
  if (['answered', 'replied', 'responded', '1'].includes(s)) return 'answered';
  return 'open';
}

export const parentQueryStep: Step<RawParentQuery, QueryRecord> = {
  legacyTable: 'parent_query',
  transform(raw) {
    const rejects: Rejects = [];
    const id = text(raw.query_id) ?? text(raw.srno);
    if (!id)
      rejects.push({ ...reject('query.id_missing', raw.query_id, true), column: 'query_id' });
    const adm = text(raw.sadmission);
    if (!adm)
      rejects.push({
        ...reject('query.admission_missing', raw.sadmission, true),
        column: 'sadmission',
      });
    const body = repairMojibake(raw.parentquery) ?? '';
    if (!body.trim()) rejects.push({ ...reject('query.empty', null, true), column: 'parentquery' });
    const date = normaliseDate(raw.query_date);
    if (date.kind !== 'ok') rejects.push({ ...date, column: 'query_date' });
    let section: { classCode: string; section: string | null } | null = null;
    if (text(raw.sclass)) {
      const sec = splitLegacySection(raw.sclass);
      if (sec.kind === 'ok') section = sec.value;
      else rejects.push({ ...sec, column: 'sclass' });
    }
    const year =
      raw.FinancialYear === undefined || raw.FinancialYear === null || raw.FinancialYear === ''
        ? null
        : normaliseYearCode(raw.FinancialYear);
    if (year && year.kind !== 'ok') rejects.push({ ...year, column: 'FinancialYear' });
    if (rejects.length || !id || !adm || date.kind !== 'ok') return rejects;
    return {
      legacyKey: id,
      row: {
        legacyId: id,
        admissionNo: adm,
        classCode: section?.classCode ?? null,
        section: section?.section ?? null,
        categoryCode: normaliseQueryCategory(raw.query_type),
        subject: body.trim().split(/\r?\n/)[0]!.slice(0, 120),
        body: body.trim(),
        status: normaliseQueryStatus(raw.status),
        openedAt: date.value ?? '1970-01-01',
        attachment: text(raw.attachment),
        legacyYear: year && year.kind === 'ok' ? year.value : null,
      },
    };
  },
};

export interface RawQueryResponse {
  srno?: unknown;
  query_id?: unknown;
  sadmission?: unknown;
  queryresponse?: unknown;
  datetime?: unknown;
  responded_by?: unknown;
}
export interface QueryResponseRecord {
  legacyId: string;
  legacyQueryId: string;
  body: string;
  respondedAt: string;
  respondedBy: string | null;
}

export const queryResponseStep: Step<RawQueryResponse, QueryResponseRecord> = {
  legacyTable: 'parent_query_responses',
  transform(raw) {
    const rejects: Rejects = [];
    const id = text(raw.srno);
    if (!id) rejects.push({ ...reject('response.id_missing', raw.srno, true), column: 'srno' });
    const queryId = text(raw.query_id);
    if (!queryId)
      rejects.push({ ...reject('response.query_missing', raw.query_id, true), column: 'query_id' });
    const body = repairMojibake(raw.queryresponse) ?? '';
    if (!body.trim())
      rejects.push({ ...reject('response.empty', null, true), column: 'queryresponse' });
    const when = normaliseDate(String(raw.datetime ?? '').slice(0, 10));
    if (when.kind !== 'ok') rejects.push({ ...when, column: 'datetime' });
    if (rejects.length || !id || !queryId || when.kind !== 'ok') return rejects;
    return {
      legacyKey: id,
      row: {
        legacyId: id,
        legacyQueryId: queryId,
        body: body.trim(),
        respondedAt: when.value ?? '1970-01-01',
        respondedBy: text(raw.responded_by),
      },
    };
  },
};
