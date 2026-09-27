import { describe, expect, it } from 'vitest';
import {
  employeeNoticeStep,
  homeworkStep,
  normaliseQueryCategory,
  normaliseQueryStatus,
  parentQueryStep,
  queryResponseStep,
} from '../src';

const ok = <T>(r: T | unknown[]): T => {
  if (Array.isArray(r)) throw new Error(`rejected: ${JSON.stringify(r)}`);
  return r as T;
};

describe('engagement domain transforms (Sprint 10)', () => {
  it('maps staff notices and homework rows', () => {
    const n = ok(
      employeeNoticeStep.transform({
        srno: '12',
        sname: 'Admin',
        EmpId: 'E001',
        noticetitle: 'Staff meeting',
        notice: 'Monday 3 pm',
        NoticeDate: '14/07/2025',
      }),
    );
    expect(n.row).toMatchObject({
      legacyId: '12',
      title: 'Staff meeting',
      audience: 'employees',
      employeeCode: 'E001',
      publishedOn: '2025-07-14',
    });
    expect(
      Array.isArray(
        employeeNoticeStep.transform({
          srno: '13',
          notice: '',
          noticetitle: '',
          NoticeDate: '14/07/2025',
        }),
      ),
    ).toBe(true);
    const h = ok(
      homeworkStep.transform({
        srno: '7',
        sclass: 'VI-A',
        subject: 'Maths',
        homeworkdate: '2025-07-14',
        homework: 'Ex 3.2 Q1-10',
        FinancialYear: '2025',
      }),
    );
    expect(h.row).toMatchObject({
      classCode: 'VI',
      section: 'A',
      subjectName: 'Maths',
      assignedOn: '2025-07-14',
      title: 'Maths · 2025-07-14',
      legacyYear: '2025-26',
    });
    expect(
      Array.isArray(
        homeworkStep.transform({
          srno: '8',
          sclass: 'VI-A',
          homeworkdate: 'yesterday',
          homework: 'x',
        }),
      ),
    ).toBe(true);
  });

  it('maps parent queries with categories, statuses and responses', () => {
    expect(
      ['Fee Related', 'Bus', 'Academic', 'Leave', 'TC', ''].map(normaliseQueryCategory),
    ).toEqual(['fees', 'transport', 'academics', 'attendance', 'admin', 'other']);
    expect(['COMPLETE', 'Replied', 'Pending', null].map(normaliseQueryStatus)).toEqual([
      'closed',
      'answered',
      'open',
      'open',
    ]);
    const q = ok(
      parentQueryStep.transform({
        query_id: 'Q-55',
        sadmission: 'R2401',
        sname: 'Aarav',
        sclass: 'VI-A',
        parentquery: 'Bus is late every day\nPlease check',
        query_type: 'Transport',
        query_date: '15/07/2025',
        status: 'COMPLETE',
        FinancialYear: '2025',
      }),
    );
    expect(q.row).toMatchObject({
      legacyId: 'Q-55',
      admissionNo: 'R2401',
      classCode: 'VI',
      section: 'A',
      categoryCode: 'transport',
      subject: 'Bus is late every day',
      status: 'closed',
      openedAt: '2025-07-15',
      legacyYear: '2025-26',
    });
    expect(
      Array.isArray(
        parentQueryStep.transform({
          query_id: 'Q-56',
          sadmission: '',
          parentquery: 'x',
          query_date: '15/07/2025',
        }),
      ),
    ).toBe(true);
    const r = ok(
      queryResponseStep.transform({
        srno: '3',
        query_id: 'Q-55',
        sadmission: 'R2401',
        queryresponse: 'Driver has been informed.',
        datetime: '2025-07-16 10:12:00',
      }),
    );
    expect(r.row).toMatchObject({ legacyQueryId: 'Q-55', respondedAt: '2025-07-16' });
    expect(r.legacyKey).toBe('3');
  });
});
