import { describe, expect, it } from 'vitest';
import { attendanceStep, normaliseAttendanceCode, rfidLogStep } from '../src';

const ok = <T>(r: T | unknown[]): T => {
  if (Array.isArray(r)) throw new Error(`rejected: ${JSON.stringify(r)}`);
  return r as T;
};

describe('attendance domain transforms (Sprint 9)', () => {
  it('maps legacy attendance codes', () => {
    expect(
      ['P', 'Absent', 'L', 'SR', 'A.5', 'OD', 'STAY BACK'].map(normaliseAttendanceCode),
    ).toEqual(['P', 'A', 'L', 'SR', 'H', 'OD', 'SB']);
    expect(normaliseAttendanceCode('??')).toBeNull();
  });

  it('maps day and subject rows and rejects unknown codes', () => {
    const day = ok(
      attendanceStep.transform({
        sadmission: 'R2401',
        sclass: 'VI-A',
        attendancedate: '14/07/2025',
        attendance: 'P',
        emp_id: 'E006',
        FinancialYear: '2025',
      }),
    );
    expect(day.row).toMatchObject({
      admissionNo: 'R2401',
      classCode: 'VI',
      section: 'A',
      date: '2025-07-14',
      code: 'P',
      kind: 'day',
      subjectCode: null,
      markedByEmpId: 'E006',
      legacyYear: '2025-26',
    });
    const subj = ok(
      attendanceStep.transform({
        sadmission: 'R2401',
        sclass: 'VI-A',
        attendancedate: '2025-07-14',
        attendance: 'A',
        subject_code: 'mat',
      }),
    );
    expect(subj.row).toMatchObject({ kind: 'subject', subjectCode: 'MAT', code: 'A' });
    expect(subj.legacyKey).toBe('R2401|2025-07-14|mat');
    expect(
      Array.isArray(
        attendanceStep.transform({
          sadmission: 'R2401',
          sclass: 'VI-A',
          attendancedate: '2025-07-14',
          attendance: 'X',
        }),
      ),
    ).toBe(true);
    expect(
      Array.isArray(
        attendanceStep.transform({
          sadmission: '',
          sclass: 'VI-A',
          attendancedate: '2025-07-14',
          attendance: 'P',
        }),
      ),
    ).toBe(true);
  });

  it('maps RFID logs with direction and device', () => {
    const e = ok(
      rfidLogStep.transform({
        RFID_Tag: 'TAG-1',
        LogDate: '14/07/2025',
        LogTime: '08:12:30',
        Direction: 'IN',
        DeviceId: 'GATE1',
      }),
    );
    expect(e.row).toMatchObject({ tag: 'TAG-1', direction: 'in', deviceCode: 'GATE1' });
    expect(e.row.at).toBe('2025-07-14T02:42:30.000Z'); // 08:12:30 IST
    expect(
      ok(
        rfidLogStep.transform({
          RFID_Tag: 'TAG-1',
          LogDateTime: '2025-07-14 14:05:00',
          Direction: 'Exit',
        }),
      ).row.direction,
    ).toBe('out');
    expect(
      Array.isArray(
        rfidLogStep.transform({
          RFID_Tag: 'TAG-1',
          LogDate: '14/07/2025',
          LogTime: '08:12',
          Direction: 'sideways',
        }),
      ),
    ).toBe(true);
  });
});
