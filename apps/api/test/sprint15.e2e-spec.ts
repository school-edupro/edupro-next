/**
 * Sprint 15: exam entry (marks through app.enter_marks with scopes and locks, indicators, remarks, exam
 * attendance, health records), the fee reports centre (day book, head-wise tally, defaulters with
 * reminders, forecast, bank statement matching, Tally export), and the assistant for teachers and
 * parents (scoped catalogue, consent gate, Hinglish) with anomaly alerts.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  createApp,
  headersFor,
  injector,
  seedSchool,
  seedUser,
  stamp,
  withMigrator,
  type SeededSchool,
  type SeededUser,
} from './helpers';

describe('exam entry, fee reports and the assistant everywhere (e2e, Sprint 15)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let coordinator: SeededUser;
  let classTeacher: SeededUser; // class teacher of VI-A
  let mathTeacher: SeededUser; // subject teacher MAT in VI-A
  let otherTeacher: SeededUser; // class teacher of VI-B
  let parent: SeededUser;
  let classId: string;
  let sectionA: string;
  let sectionB: string;
  let mat: string;
  let eng: string;
  let examId: string;
  const studentsA: string[] = [];
  let studentB: string;
  const h = (u: SeededUser = admin, extra = '') => headersFor(`${u.sub}${extra}`, school.id);

  beforeAll(async () => {
    const s = stamp('F15');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      coordinator = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
      classTeacher = await seedUser(c, school, `${s}-ct`);
      mathTeacher = await seedUser(c, school, `${s}-mt`);
      otherTeacher = await seedUser(c, school, `${s}-ot`);
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      for (const [code, u] of [
        ['T15CT', classTeacher],
        ['T15MT', mathTeacher],
        ['T15OT', otherTeacher],
      ] as const) {
        await c.query(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id) VALUES ($1, $2, 'Teacher', $2, $3)`,
          [school.id, code, u.id],
        );
      }
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'VI', name: 'Class VI', displayOrder: 6 },
    });
    classId = cls.json().id;
    for (const name of ['A', 'B']) {
      const sec = await inject({
        method: 'POST',
        url: `/academics/classes/${classId}/sections`,
        headers: h(),
        json: { name },
      });
      if (name === 'A') sectionA = sec.json().id;
      else sectionB = sec.json().id;
    }
    for (const [code, name] of [
      ['MAT', 'Mathematics'],
      ['ENG', 'English'],
    ]) {
      const r = await inject({
        method: 'POST',
        url: '/academics/subjects',
        headers: h(),
        json: { code, name, kind: 'scholastic' },
      });
      expect(r.statusCode).toBe(201);
      if (code === 'MAT') mat = r.json().id;
      else eng = r.json().id;
    }
    let roll = 1;
    for (const first of ['Asha', 'Bhanu', 'Chirag']) {
      const r = await inject({
        method: 'POST',
        url: '/people/students',
        headers: h(),
        json: {
          admissionNo: `${s}-${roll}`,
          firstName: first,
          lastName: 'Fifteen',
          guardians:
            roll === 1
              ? [
                  {
                    guardian: { firstName: 'Gita', lastName: 'Fifteen', mobile: '9876515001' },
                    relation: 'mother',
                    isPrimary: true,
                  },
                ]
              : [],
          enrolment: { classSectionId: sectionA, rollNo: roll },
        },
      });
      expect(r.statusCode).toBe(201);
      studentsA.push(r.json().id);
      roll += 1;
    }
    const b = await inject({
      method: 'POST',
      url: '/people/students',
      headers: h(),
      json: {
        admissionNo: `${s}-B1`,
        firstName: 'Deep',
        lastName: 'Fifteen',
        guardians: [],
        enrolment: { classSectionId: sectionB, rollNo: 1 },
      },
    });
    studentB = b.json().id;
    await withMigrator(async (c) => {
      await c.query(
        `UPDATE guardians SET user_id = $1 WHERE mobile = '9876515001' AND school_id = $2`,
        [parent.id, school.id],
      );
    });
    const emps = (
      await inject({ method: 'GET', url: '/people/employees?size=20', headers: h() })
    ).json().data as Array<{ id: string; employeeCode: string }>;
    const emp = (code: string) => emps.find((e) => e.employeeCode === code)!.id;
    for (const [code, section, kind, subjectId] of [
      ['T15CT', sectionA, 'class_teacher', undefined],
      ['T15MT', sectionA, 'subject_teacher', mat],
      ['T15OT', sectionB, 'class_teacher', undefined],
    ] as const) {
      const ta = await inject({
        method: 'POST',
        url: '/academics/teacher-assignments',
        headers: h(),
        json: { employeeId: emp(code), classSectionId: section, kind, subjectId },
      });
      expect(ta.statusCode).toBe(201);
    }
    // exam masters (Sprint 14) for PT1 on class VI with MAT and ENG out of 40
    const type = await inject({
      method: 'POST',
      url: '/exams/types',
      headers: h(),
      json: { code: 'PT1', name: 'Periodic Test 1', weightage: 10 },
    });
    const exam = await inject({
      method: 'POST',
      url: '/exams',
      headers: h(),
      json: {
        examTypeId: type.json().id,
        code: 'PT1-2026',
        name: 'Periodic Test 1',
        startsOn: '2026-07-15',
        endsOn: '2026-07-20',
        classes: [{ classId }],
      },
    });
    expect(exam.statusCode).toBe(201);
    examId = exam.json().id;
    const subjects = await inject({
      method: 'PUT',
      url: `/exams/${examId}/subjects`,
      headers: h(),
      json: {
        classId,
        subjects: [
          { subjectId: mat, maxMarks: 40, passMarks: 13 },
          { subjectId: eng, maxMarks: 40, passMarks: 13 },
        ],
      },
    });
    expect(subjects.statusCode).toBe(200);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  // ---- entry scope -------------------------------------------------------------------------------
  it('each teacher sees only the sections and subjects they hold; the register needs the class teacher', async () => {
    const forMath = await inject({
      method: 'GET',
      url: `/exams/${examId}/entry/sections`,
      headers: h(mathTeacher),
    });
    expect(forMath.statusCode).toBe(200);
    expect(forMath.json().data).toHaveLength(1);
    expect(forMath.json().data[0]).toMatchObject({ classSectionId: sectionA, register: false });
    expect(forMath.json().data[0].subjects.map((x: { code: string }) => x.code)).toEqual(['MAT']);

    const forClass = await inject({
      method: 'GET',
      url: `/exams/${examId}/entry/sections`,
      headers: h(classTeacher),
    });
    expect(forClass.json().data[0]).toMatchObject({ classSectionId: sectionA, register: true });
    expect(forClass.json().data[0].subjects).toHaveLength(2);

    const forOther = await inject({
      method: 'GET',
      url: `/exams/${examId}/entry/sections`,
      headers: h(otherTeacher),
    });
    expect(forOther.json().data.map((x: { classSectionId: string }) => x.classSectionId)).toEqual([
      sectionB,
    ]);

    const forAdmin = await inject({
      method: 'GET',
      url: `/exams/${examId}/entry/sections`,
      headers: h(),
    });
    expect(forAdmin.json().data).toHaveLength(2);

    const forParent = await inject({
      method: 'GET',
      url: `/exams/${examId}/entry/sections`,
      headers: h(parent),
    });
    expect(forParent.statusCode).toBe(403);
  });

  // ---- marks -------------------------------------------------------------------------------------
  it('marks go through app.enter_marks: range, enrolment, assignment and locks are enforced', async () => {
    const put = await inject({
      method: 'PUT',
      url: `/exams/${examId}/marks`,
      headers: h(mathTeacher),
      json: {
        classSectionId: sectionA,
        subjectId: mat,
        rows: [
          { studentId: studentsA[0], marks: 35 },
          { studentId: studentsA[1], marks: 12.5 },
          { studentId: studentsA[2], absent: true },
        ],
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ inserted: 3, updated: 0 });

    const again = await inject({
      method: 'PUT',
      url: `/exams/${examId}/marks`,
      headers: h(mathTeacher),
      json: {
        classSectionId: sectionA,
        subjectId: mat,
        rows: [
          { studentId: studentsA[0], marks: 36 },
          { studentId: studentsA[1], marks: 12.5 },
        ],
      },
    });
    expect(again.json()).toEqual({ inserted: 0, updated: 1 });

    const sheet = await inject({
      method: 'GET',
      url: `/exams/${examId}/marks?classSectionId=${sectionA}&subjectId=${mat}`,
      headers: h(classTeacher),
    });
    expect(sheet.statusCode).toBe(200);
    expect(sheet.json().examSubject).toMatchObject({ code: 'MAT', maxMarks: '40.00' });
    expect(
      sheet.json().rows.map((r: { marks: string | null; absent: boolean }) => [r.marks, r.absent]),
    ).toEqual([
      ['36.00', false],
      ['12.50', false],
      [null, true],
    ]);

    const tooHigh = await inject({
      method: 'PUT',
      url: `/exams/${examId}/marks`,
      headers: h(mathTeacher),
      json: {
        classSectionId: sectionA,
        subjectId: mat,
        rows: [{ studentId: studentsA[0], marks: 41 }],
      },
    });
    expect(tooHigh.statusCode).toBe(409);
    expect(tooHigh.json().type).toBe('exams.marks_out_of_range');

    const stranger = await inject({
      method: 'PUT',
      url: `/exams/${examId}/marks`,
      headers: h(mathTeacher),
      json: {
        classSectionId: sectionA,
        subjectId: mat,
        rows: [{ studentId: studentB, marks: 10 }],
      },
    });
    expect(stranger.statusCode).toBe(409);
    expect(stranger.json().type).toBe('exams.student_not_in_section');

    const wrongSubject = await inject({
      method: 'PUT',
      url: `/exams/${examId}/marks`,
      headers: h(mathTeacher),
      json: {
        classSectionId: sectionA,
        subjectId: eng,
        rows: [{ studentId: studentsA[0], marks: 10 }],
      },
    });
    expect(wrongSubject.statusCode).toBe(403);
    expect(wrongSubject.json().type).toBe('exams.not_assigned');

    const otherSection = await inject({
      method: 'PUT',
      url: `/exams/${examId}/marks`,
      headers: h(otherTeacher),
      json: {
        classSectionId: sectionA,
        subjectId: mat,
        rows: [{ studentId: studentsA[0], marks: 10 }],
      },
    });
    expect(otherSection.statusCode).toBe(403);
    expect(otherSection.json().type).toBe('scope-denied');

    // the class teacher may enter every subject of the section
    const byClassTeacher = await inject({
      method: 'PUT',
      url: `/exams/${examId}/marks`,
      headers: h(classTeacher),
      json: {
        classSectionId: sectionA,
        subjectId: eng,
        rows: [{ studentId: studentsA[0], marks: 30 }],
      },
    });
    expect(byClassTeacher.statusCode).toBe(200);

    // lock ENG: entry refused; a teacher cannot unlock, the coordinator can (exams.marks.unlock)
    const lock = await inject({
      method: 'POST',
      url: `/exams/${examId}/subjects/lock`,
      headers: h(),
      json: { classId, subjectIds: [eng], locked: true },
    });
    expect(lock.statusCode).toBe(201);
    const locked = await inject({
      method: 'PUT',
      url: `/exams/${examId}/marks`,
      headers: h(classTeacher),
      json: {
        classSectionId: sectionA,
        subjectId: eng,
        rows: [{ studentId: studentsA[1], marks: 20 }],
      },
    });
    expect(locked.statusCode).toBe(409);
    expect(locked.json().type).toBe('exams.entry_locked');
    const teacherUnlock = await inject({
      method: 'POST',
      url: `/exams/${examId}/subjects/lock`,
      headers: h(classTeacher),
      json: { classId, subjectIds: [eng], locked: false },
    });
    expect(teacherUnlock.statusCode).toBe(403);
    const unlock = await inject({
      method: 'POST',
      url: `/exams/${examId}/subjects/lock`,
      headers: h(coordinator),
      json: { classId, subjectIds: [eng], locked: false },
    });
    expect(unlock.statusCode).toBe(201);
    const afterUnlock = await inject({
      method: 'PUT',
      url: `/exams/${examId}/marks`,
      headers: h(classTeacher),
      json: {
        classSectionId: sectionA,
        subjectId: eng,
        rows: [{ studentId: studentsA[1], marks: 20 }],
      },
    });
    expect(afterUnlock.statusCode).toBe(200);
  });

  // ---- indicators --------------------------------------------------------------------------------
  it('indicators come from the set assigned to the class; grades outside the set are refused', async () => {
    const set = await inject({
      method: 'PUT',
      url: '/exams/indicator-sets',
      headers: h(),
      json: {
        code: 'COSCH',
        name: 'Co-scholastic (VI-VIII)',
        grades: ['A', 'B', 'C'],
        indicators: [
          { code: 'WORK', name: 'Work education', area: 'Co-scholastic', sortOrder: 1 },
          { code: 'ART', name: 'Art education', area: 'Co-scholastic', sortOrder: 2 },
          { code: 'DISC', name: 'Discipline', area: 'Discipline', sortOrder: 3 },
        ],
      },
    });
    expect(set.statusCode).toBe(200);
    const assign = await inject({
      method: 'PUT',
      url: `/exams/${examId}/indicator-sets`,
      headers: h(),
      json: { classId, setId: set.json().id },
    });
    expect(assign.statusCode).toBe(200);
    const view = await inject({
      method: 'GET',
      url: `/exams/${examId}/indicators?classSectionId=${sectionA}`,
      headers: h(classTeacher),
    });
    expect(view.statusCode).toBe(200);
    expect(view.json().set).toMatchObject({ code: 'COSCH', grades: ['A', 'B', 'C'] });
    const indicators = view.json().indicators as Array<{ id: string; code: string }>;
    expect(indicators.map((i) => i.code)).toEqual(['WORK', 'ART', 'DISC']);
    const work = indicators[0]!.id;
    const put = await inject({
      method: 'PUT',
      url: `/exams/${examId}/indicators`,
      headers: h(classTeacher),
      json: {
        classSectionId: sectionA,
        rows: [
          { studentId: studentsA[0], indicatorId: work, grade: 'A' },
          { studentId: studentsA[1], indicatorId: work, grade: 'B', note: 'Improving' },
        ],
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ changed: 2 });
    const bad = await inject({
      method: 'PUT',
      url: `/exams/${examId}/indicators`,
      headers: h(classTeacher),
      json: {
        classSectionId: sectionA,
        rows: [{ studentId: studentsA[0], indicatorId: work, grade: 'D' }],
      },
    });
    expect(bad.statusCode).toBe(409);
    expect(bad.json().type).toBe('exams.grade_not_allowed');
    const after = await inject({
      method: 'GET',
      url: `/exams/${examId}/indicators?classSectionId=${sectionA}`,
      headers: h(mathTeacher),
    });
    expect(after.json().rows[1].grades[work]).toEqual({ grade: 'B', note: 'Improving' });
  });

  // ---- register ----------------------------------------------------------------------------------
  it('the class register holds remarks, exam attendance and health; health is visible to the class teacher only', async () => {
    const bank = await inject({
      method: 'PUT',
      url: '/exams/remark-bank',
      headers: h(),
      json: {
        entries: [
          { code: 'R1', text: 'Shows steady progress and participates well.' },
          { code: 'R2', text: 'Needs regular practice in written work.', classId },
        ],
      },
    });
    expect(bank.statusCode).toBe(200);
    const remarks = await inject({
      method: 'PUT',
      url: `/exams/${examId}/remarks`,
      headers: h(classTeacher),
      json: {
        classSectionId: sectionA,
        rows: [
          {
            studentId: studentsA[0],
            remark: 'Shows steady progress and participates well.',
            bankCode: 'R1',
          },
          { studentId: studentsA[1], remark: 'Talks in class; needs to focus.' },
        ],
      },
    });
    expect(remarks.statusCode).toBe(200);
    expect(remarks.json()).toEqual({ changed: 2 });
    const bySubjectTeacher = await inject({
      method: 'PUT',
      url: `/exams/${examId}/remarks`,
      headers: h(mathTeacher),
      json: { classSectionId: sectionA, rows: [{ studentId: studentsA[0], remark: 'x' }] },
    });
    expect(bySubjectTeacher.statusCode).toBe(403);

    const attendance = await inject({
      method: 'PUT',
      url: `/exams/${examId}/attendance`,
      headers: h(classTeacher),
      json: {
        classSectionId: sectionA,
        rows: [
          { studentId: studentsA[0], daysPresent: 58, daysTotal: 60 },
          { studentId: studentsA[1], daysPresent: 61, daysTotal: 60 },
        ],
      },
    });
    expect(attendance.statusCode).toBe(400);
    expect(attendance.json().type).toBe('exams.attendance_invalid');
    const attendanceOk = await inject({
      method: 'PUT',
      url: `/exams/${examId}/attendance`,
      headers: h(classTeacher),
      json: {
        classSectionId: sectionA,
        rows: [{ studentId: studentsA[0], daysPresent: 58, daysTotal: 60 }],
      },
    });
    expect(attendanceOk.json()).toEqual({ changed: 1 });

    const health = await inject({
      method: 'PUT',
      url: `/exams/${examId}/health`,
      headers: h(classTeacher),
      json: {
        classSectionId: sectionA,
        recordedOn: '2026-07-16',
        rows: [
          { studentId: studentsA[0], heightCm: 142.5, weightKg: 36.2, bloodGroup: 'B+' },
          { studentId: studentsA[1] },
        ],
      },
    });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ recorded: 1 });
    const healthBySubject = await inject({
      method: 'PUT',
      url: `/exams/${examId}/health`,
      headers: h(mathTeacher),
      json: { classSectionId: sectionA, rows: [{ studentId: studentsA[0], heightCm: 140 }] },
    });
    expect(healthBySubject.statusCode).toBe(403);

    const register = await inject({
      method: 'GET',
      url: `/exams/${examId}/register?classSectionId=${sectionA}`,
      headers: h(classTeacher),
    });
    expect(register.statusCode).toBe(200);
    expect(register.json().healthVisible).toBe(true);
    expect(register.json().remarkBank.map((b: { code: string }) => b.code)).toEqual(['R1', 'R2']);
    expect(register.json().rows[0]).toMatchObject({
      remark: 'Shows steady progress and participates well.',
      bankCode: 'R1',
      daysPresent: 58,
      daysTotal: 60,
      health: {
        heightCm: '142.5',
        weightKg: '36.20',
        bmi: '17.83',
        bloodGroup: 'B+',
        recordedOn: '2026-07-16',
      },
    });
    const forSubject = await inject({
      method: 'GET',
      url: `/exams/${examId}/register?classSectionId=${sectionA}`,
      headers: h(mathTeacher),
    });
    expect(forSubject.json().healthVisible).toBe(false);
    expect(forSubject.json().rows[0].health).toBeNull();
  });

  // ---- fee reports centre ------------------------------------------------------------------------
  describe('fee reports centre', () => {
    let heads: Record<string, string> = {};
    beforeAll(async () => {
      for (const [code, name, kind, ledger, i] of [
        ['TUI', 'Tuition fee', 'regular', 'school', 1],
        ['IDC', 'ID card', 'misc', 'misc', 2],
      ] as const) {
        const r = await inject({
          method: 'POST',
          url: '/fees/heads',
          headers: h(),
          json: { code, name, kind, ledger, sortOrder: i },
        });
        expect(r.statusCode).toBe(201);
        heads[code] = r.json().id;
      }
      const p = await inject({
        method: 'POST',
        url: '/fees/periods/generate',
        headers: h(),
        json: { dueDay: 10, monthsPerInstalment: 3 },
      });
      expect(p.statusCode).toBe(201);
      const st = await inject({
        method: 'PUT',
        url: `/fees/structures/${classId}`,
        headers: h(),
        json: {
          feeGroup: 'general',
          entries: [{ headId: heads.TUI, amount: 2000, frequency: 'monthly' }],
        },
      });
      expect(st.statusCode).toBe(200);
      for (const [key, value] of [
        ['fees.late_fee_mode', 'daywise'],
        ['fees.late_fee_per_day', '10.00'],
      ]) {
        const r = await inject({
          method: 'PUT',
          url: `/platform/settings/${key}`,
          headers: h(),
          json: { value },
        });
        expect([200, 201]).toContain(r.statusCode);
      }
      for (const id of [...studentsA, studentB]) {
        const g = await inject({
          method: 'POST',
          url: `/fees/students/${id}/demands/generate`,
          headers: h(),
        });
        expect(g.statusCode).toBe(201);
      }
      const receipt = (json: Record<string, unknown>) =>
        inject({ method: 'POST', url: '/payments/receipts', headers: h(), json });
      const r1 = await receipt({
        studentId: studentsA[0],
        amount: 6000,
        mode: 'cash',
        receivedOn: '2026-04-05',
      });
      expect(r1.statusCode).toBe(201);
      const r2 = await receipt({
        studentId: studentsA[1],
        amount: 6000,
        mode: 'cheque',
        receivedOn: '2026-04-08',
        instrumentNo: 'CHQ001',
        instrumentDate: '2026-04-08',
        bankName: 'SBI',
      });
      expect(r2.statusCode).toBe(201);
      const r3 = await receipt({
        studentId: studentsA[2],
        amount: 6100,
        mode: 'upi',
        reference: 'UPI99001',
        receivedOn: '2026-04-20',
      });
      expect(r3.statusCode).toBe(201);
      expect(r3.json()).toMatchObject({ principal: '6000.00', lateFee: '100.00' });
      const misc = await inject({
        method: 'POST',
        url: '/fees/misc/receipts',
        headers: h(),
        json: {
          payerKind: 'vendor',
          payerName: 'Acme Books',
          headId: heads.IDC,
          amount: 1500,
          mode: 'bank',
          reference: 'NEFT447712',
          receivedOn: '2026-04-08',
        },
      });
      expect(misc.statusCode).toBe(201);
    }, 120_000);

    const rows = async (dataset: string, params: string, user: SeededUser = admin) =>
      inject({
        method: 'GET',
        url: `/reports/datasets/${dataset}/rows?${params}`,
        headers: h(user),
      });

    it('the day book lists every receipt, misc receipt and refund of the range with live totals', async () => {
      const r = await rows('fee_day_book', 'from=2026-04-01&to=2026-04-30');
      expect(r.statusCode).toBe(200);
      const body = r.json() as {
        rows: Array<Record<string, string>>;
        truncated: boolean;
        columns: unknown[];
      };
      expect(body.truncated).toBe(false);
      expect(body.rows.map((x) => [x.kind, String(x.receipt_no).split('/')[0], x.amount])).toEqual([
        ['receipt', 'TF', '6000.00'],
        ['misc', 'MF', '1500.00'],
        ['receipt', 'TF', '6000.00'],
        ['receipt', 'TF', '6100.00'],
      ]);
      const total = body.rows.reduce((a, x) => a + Number(x.amount), 0);
      expect(total).toBe(19600);
      expect(body.rows[3]).toMatchObject({ late_fee: '100.00', principal: '6000.00', mode: 'upi' });
      const cheques = await rows('fee_day_book', 'from=2026-04-01&to=2026-04-30&mode=cheque');
      expect(cheques.json().rows).toHaveLength(1);
      expect(cheques.json().rows[0]).toMatchObject({ instrument_no: 'CHQ001', bank_name: 'SBI' });
      const denied = await rows('fee_day_book', 'from=2026-04-01&to=2026-04-30', classTeacher);
      expect(denied.statusCode).toBe(403);
      const unknown = await rows('no_such_dataset', '');
      expect(unknown.statusCode).toBe(404);
    });

    it('the head-wise tally splits collections by day and head with late fee and misc columns', async () => {
      const r = await rows('fee_head_tally', 'from=2026-04-01&to=2026-04-30');
      expect(r.statusCode).toBe(200);
      const cells = (r.json().rows as Array<Record<string, string>>).map((x) => [
        x.on_date,
        x.head_code,
        x.amount,
      ]);
      expect(cells).toEqual([
        ['2026-04-05', 'TUI', '6000.00'],
        ['2026-04-08', 'IDC', '1500.00'],
        ['2026-04-08', 'TUI', '6000.00'],
        ['2026-04-20', 'LATE_FEE', '100.00'],
        ['2026-04-20', 'TUI', '6000.00'],
      ]);
    });

    it('defaulters come from the marts; reminders go once a day to the primary guardian', async () => {
      const refresh = await inject({
        method: 'POST',
        url: '/insights/marts/refresh',
        headers: h(),
      });
      expect(refresh.statusCode).toBe(201);
      expect((refresh.json().data as Array<{ mart: string }>).map((m) => m.mart)).toContain(
        'fee_forecast',
      );
      const all = await rows('fee_defaulters', 'asOf=2026-09-28');
      expect(all.statusCode).toBe(200);
      const list = all.json().rows as Array<Record<string, string | null>>;
      // April was paid by the three VI-A pupils; July is overdue for everyone; VI-B owes April too
      expect(list).toHaveLength(4);
      expect(list[0]).toMatchObject({
        admission_no: expect.stringContaining('-B1'),
        balance: '12000.00',
      });
      expect(list.find((x) => x.student === 'Asha Fifteen')).toMatchObject({
        balance: '6000.00',
        guardian_mobile: '9876515001',
        last_reminded_on: null,
      });
      const big = await rows('fee_defaulters', 'asOf=2026-09-28&minBalance=10000');
      expect(big.json().rows).toHaveLength(1);
      const scoped = await rows('fee_defaulters', `asOf=2026-09-28&sectionId=${sectionB}`);
      expect(scoped.json().rows).toHaveLength(1);

      const notify = await inject({
        method: 'POST',
        url: '/fees/reports/defaulters/notify',
        headers: h(),
        json: { studentIds: studentsA, channel: 'whatsapp', asOf: '2026-09-28' },
      });
      expect(notify.statusCode).toBe(201);
      expect(notify.json()).toEqual({
        sent: 1,
        skippedToday: 0,
        noMobile: 2,
        noBalance: 0,
        failed: 0,
      });
      const again = await inject({
        method: 'POST',
        url: '/fees/reports/defaulters/notify',
        headers: h(),
        json: { studentIds: [studentsA[0]], channel: 'whatsapp', asOf: '2026-09-28' },
      });
      expect(again.json()).toMatchObject({ sent: 0, skippedToday: 1 });
      const after = await rows('fee_defaulters', 'asOf=2026-09-28');
      expect(
        (after.json().rows as Array<Record<string, string | null>>).find(
          (x) => x.student === 'Asha Fifteen',
        )!.last_reminded_on,
      ).not.toBeNull();
      const teacherNotify = await inject({
        method: 'POST',
        url: '/fees/reports/defaulters/notify',
        headers: h(classTeacher),
        json: { studentIds: studentsA },
      });
      expect(teacherNotify.statusCode).toBe(403);
    });

    it('the forecast mart holds expected, collected and balance per class and due month', async () => {
      const r = await rows('fee_forecast', '');
      expect(r.statusCode).toBe(200);
      const months = r.json().rows as Array<Record<string, string | number>>;
      expect(
        months.map((m) => [m.month, m.class_code, m.students, m.expected, m.collected]),
      ).toEqual([
        ['2026-04', 'VI', 4, '24000.00', '18000.00'],
        ['2026-07', 'VI', 4, '24000.00', '0.00'],
        ['2026-10', 'VI', 4, '24000.00', '0.00'],
        ['2027-01', 'VI', 4, '24000.00', '0.00'],
      ]);
    });

    it('a bank statement matches cheque and NEFT credits, flags a returned cheque and leaves strangers unmatched', async () => {
      const csv = [
        'Date,Narration,Chq/Ref No,Debit,Credit,Balance',
        '09/04/2026,CLG CHQ DEP,CHQ001,,"6,000.00","1,06,000.00"',
        '09/04/2026,NEFT CR ACME BOOKS NEFT447712,NEFT447712,,1500.00,107500.00',
        '10/04/2026,UPI/999/UNKNOWN PAYER,,,999.00,108499.00',
        '15/04/2026,CHQ RETURN CHQ001 INSUFFICIENT FUNDS,CHQ001,6000.00,,102499.00',
        '16/04/2026,BANK CHARGES,,25.00,,102474.00',
      ].join('\n');
      const up = await inject({
        method: 'POST',
        url: '/payments/bank-statements',
        headers: h(),
        json: { bankName: 'SBI', accountRef: 'XXXX1234', fileName: 'apr.csv', csv },
      });
      expect(up.statusCode).toBe(201);
      expect(up.json()).toMatchObject({
        rows: 5,
        matched: 2,
        unmatched: 1,
        returned: 1,
        credits: '8499.00',
        debits: '6025.00',
      });
      const lines = up.json().lines as Array<Record<string, string | null>>;
      expect(lines.map((l) => [l.lineNo, l.status, l.matchedBy])).toEqual([
        [1, 'matched', 'reference'],
        [2, 'matched', 'reference'],
        [3, 'unmatched', null],
        [4, 'returned', null],
        [5, 'ignored', null],
      ]);
      expect(lines[0]!.receiptNo).toMatch(/^TF\//);
      expect(lines[1]!.receiptNo).toMatch(/^MF\//);
      const book = await rows('fee_day_book', 'from=2026-04-08&to=2026-04-08');
      expect((book.json().rows as Array<Record<string, string>>).map((x) => x.cleared_on)).toEqual([
        '2026-04-09',
        '2026-04-09',
      ]);
      const list = await inject({ method: 'GET', url: '/payments/bank-statements', headers: h() });
      expect(list.json().data).toHaveLength(1);
      const badHeader = await inject({
        method: 'POST',
        url: '/payments/bank-statements',
        headers: h(),
        json: { bankName: 'SBI', csv: 'a,b\n1,2' },
      });
      expect(badHeader.statusCode).toBe(400);
    });

    it('the Tally export is an xml export of the voucher dataset', async () => {
      const r = await rows('fee_tally_vouchers', 'from=2026-04-01&to=2026-04-30');
      expect(r.statusCode).toBe(200);
      const v = r.json().rows as Array<Record<string, string>>;
      expect(v.map((x) => [String(x.voucher_no).split('/')[0], x.ledger_name, x.amount])).toEqual([
        ['TF', 'Tuition fee', '6000.00'],
        ['MF', 'ID card', '1500.00'],
        ['TF', 'Tuition fee', '6000.00'],
        ['TF', 'Late fee', '100.00'],
        ['TF', 'Tuition fee', '6000.00'],
      ]);
      const exp = await inject({
        method: 'POST',
        url: '/reports/exports',
        headers: h(),
        json: {
          dataset: 'fee_tally_vouchers',
          format: 'xml',
          params: { from: '2026-04-01', to: '2026-04-30' },
        },
      });
      expect(exp.statusCode).toBe(201);
      expect(exp.json()).toMatchObject({
        format: 'xml',
        status: 'queued',
        dataset: 'fee_tally_vouchers',
      });
    });
  });

  // ---- assistant for teachers and parents; alerts -----------------------------------------------
  describe('assistant everywhere', () => {
    const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    beforeAll(async () => {
      // day attendance today: Chirag absent in VI-A, Deep absent in VI-B
      const a = await inject({
        method: 'POST',
        url: '/attendance/sessions',
        headers: h(classTeacher),
        json: {
          classSectionId: sectionA,
          date: today,
          kind: 'day',
          marks: [
            { studentId: studentsA[0], code: 'P' },
            { studentId: studentsA[1], code: 'P' },
            { studentId: studentsA[2], code: 'A' },
          ],
        },
      });
      expect(a.statusCode).toBe(201);
      const b = await inject({
        method: 'POST',
        url: '/attendance/sessions',
        headers: h(otherTeacher),
        json: {
          classSectionId: sectionB,
          date: today,
          kind: 'day',
          marks: [{ studentId: studentB, code: 'A' }],
        },
      });
      expect(b.statusCode).toBe(201);
    });

    it('a teacher sees only section-scoped entries and answers only about own sections', async () => {
      const cat = await inject({
        method: 'GET',
        url: '/insights/assistant/catalogue',
        headers: h(classTeacher),
      });
      expect(cat.statusCode).toBe(200);
      const ids = (cat.json().data as Array<{ id: string; allowed: boolean }>).map((e) => e.id);
      expect(ids).toContain('my_absentees');
      expect(ids).not.toContain('fee_defaulters');
      expect(ids).not.toContain('attendance_today');
      const ask = await inject({
        method: 'POST',
        url: '/insights/assistant',
        headers: h(classTeacher),
        json: { question: 'Who was absent today?', surface: 'teacher' },
      });
      expect(ask.statusCode).toBe(201);
      expect(ask.json().refused).toBe(false);
      expect(ask.json().citations[0]).toMatchObject({ query: 'my_absentees', rows: 1 });
      expect(ask.json().answer).toContain('Chirag Fifteen');
      expect(ask.json().answer).not.toContain('Deep');
      const other = await inject({
        method: 'POST',
        url: '/insights/assistant',
        headers: h(otherTeacher),
        json: { question: 'kaun absent hai aaj batao' },
      });
      expect(other.statusCode).toBe(201);
      expect(other.json().citations[0]).toMatchObject({ query: 'my_absentees', rows: 1 });
      expect(other.json().answer).toContain('Deep Fifteen');
      expect(other.json().answer).toMatch(/ se 1 row/); // Hinglish narration
      const staffOnly = await inject({
        method: 'POST',
        url: '/insights/assistant',
        headers: h(classTeacher),
        json: { question: 'fee defaulters of class VI above 1000' },
      });
      expect(staffOnly.json().refused).toBe(true);
      expect(staffOnly.json().citations).toEqual([]);
      const conv = await inject({
        method: 'GET',
        url: '/insights/assistant/conversations',
        headers: h(classTeacher),
      });
      expect(conv.json().data[0]).toMatchObject({ surface: 'teacher' });
    });

    it('a parent needs the ai.assistant consent, then asks about own children in Hinglish', async () => {
      const before = await inject({
        method: 'POST',
        url: '/insights/assistant',
        headers: h(parent),
        json: { question: 'kitni fees baki hai' },
      });
      expect(before.statusCode).toBe(403);
      expect(before.json().type).toBe('consent-required');
      const consent = await inject({
        method: 'POST',
        url: '/comms/consents/mine',
        headers: h(parent),
        json: { purposeCode: 'ai.assistant', status: 'granted' },
      });
      expect([200, 201]).toContain(consent.statusCode);
      const cat = await inject({
        method: 'GET',
        url: '/insights/assistant/catalogue',
        headers: h(parent),
      });
      const ids = (cat.json().data as Array<{ id: string }>).map((e) => e.id);
      expect(ids).toContain('child_dues');
      expect(ids).not.toContain('my_absentees');
      expect(ids).not.toContain('fee_defaulters');
      const dues = await inject({
        method: 'POST',
        url: '/insights/assistant',
        headers: h(parent),
        json: { question: 'kitni fees baki hai' },
      });
      expect(dues.statusCode).toBe(201);
      expect(dues.json().refused).toBe(false);
      expect(dues.json().citations[0]).toMatchObject({ query: 'child_dues' });
      expect(dues.json().answer).toContain('Asha Fifteen');
      expect(dues.json().answer).not.toContain('Bhanu');
      expect(dues.json().answer).toMatch(/ se \d+ row/);
      const absent = await inject({
        method: 'POST',
        url: '/insights/assistant',
        headers: h(parent),
        json: { question: 'Was my child absent this week?', language: 'en' },
      });
      expect(absent.json().citations[0]).toMatchObject({
        query: 'child_attendance',
        params: { days: 7 },
      });
      expect(absent.json().answer).toContain('absent_days: 0');
      const conv = await inject({
        method: 'GET',
        url: '/insights/assistant/conversations',
        headers: h(parent),
      });
      expect(conv.json().data[0]).toMatchObject({ surface: 'parent' });
    });

    it('alerts are listed and acknowledged by administrators only', async () => {
      const alertId = await withMigrator(async (c) => {
        const r = await c.query<{ id: string }>(
          `INSERT INTO insight_alerts (school_id, kind, severity, subject_type, subject_id, title, message, data)
           VALUES ($1, 'attendance.drop', 'warning', 'class_section', $2, 'Attendance drop in VI-A', '78% this week against 94%', '{"thisWeekPct": 78}') RETURNING id::text`,
          [school.id, sectionA],
        );
        return r.rows[0]!.id;
      });
      const list = await inject({ method: 'GET', url: '/insights/alerts', headers: h() });
      expect(list.statusCode).toBe(200);
      expect(list.json().data).toEqual([
        expect.objectContaining({
          id: alertId,
          kind: 'attendance.drop',
          ackedAt: null,
          data: { thisWeekPct: 78 },
        }),
      ]);
      const denied = await inject({
        method: 'GET',
        url: '/insights/alerts',
        headers: h(classTeacher),
      });
      expect(denied.statusCode).toBe(403);
      const ack = await inject({
        method: 'POST',
        url: `/insights/alerts/${alertId}/ack`,
        headers: h(),
      });
      expect(ack.statusCode).toBe(201);
      const open = await inject({ method: 'GET', url: '/insights/alerts?open=true', headers: h() });
      expect(open.json().data).toEqual([]);
      const all = await inject({ method: 'GET', url: '/insights/alerts?open=false', headers: h() });
      expect(all.json().data[0].ackedBy).toBeTruthy();
      const again = await inject({
        method: 'POST',
        url: `/insights/alerts/${alertId}/ack`,
        headers: h(),
      });
      expect(again.statusCode).toBe(404);
    });
  });
});
