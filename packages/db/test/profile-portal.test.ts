import { describe, expect, it } from 'vitest';
import {
  approverLabel,
  resolvePolicy,
  routeFor,
  routeSignature,
  windowState,
} from '../src/profile-portal';

describe('portal profile policy', () => {
  it('defaults: parents edit the family fields with approval, students only view, photos stay pictures', () => {
    const p = resolvePolicy(null);
    expect(p.fields.parent.blood_group).toBe('edit_approval');
    expect(p.fields.parent.aadhaar_no).toBe('view');
    expect(p.fields.parent.remarks).toBe('hidden');
    expect(p.fields.parent.photo_ref).toBe('hidden');
    expect(p.fields.student.blood_group).toBe('view');
    expect(p.fields.student.aadhaar_no).toBe('hidden');
    expect(p.fields.student.bank_account_no).toBe('hidden');
    expect(p.proofs.dob).toBe('birth_certificate');
    expect(p.window.mode).toBe('open');
    expect(p.approval.default).toEqual([{ kind: 'office' }]);
  });

  it('never opens office-owned or computed fields for editing, and drops unknown keys and bad routes', () => {
    const p = resolvePolicy({
      fields: { parent: { admission_no: 'edit_direct', age: 'edit_approval', nope: 'view' } },
      proofs: { first_name: 'birth_certificate', nope: 'aadhaar', dob: 'passport' },
      edit_window: { mode: 'period', from: '2026-04-01', to: '2026-05-31' },
      approval: {
        default: [{ kind: 'class_teacher' }, { kind: 'role', roleId: '7' }, { kind: 'office' }],
        sections: { address: [{ kind: 'user', userId: 'x' }], nowhere: [{ kind: 'office' }] },
        fields: { father_annual_income: [{ kind: 'role', roleId: '12', name: 'Accountant' }] },
      },
    });
    expect(p.fields.parent.admission_no).toBe('view');
    expect(p.fields.parent.age).toBe('view');
    expect('nope' in p.fields.parent).toBe(false);
    expect(p.proofs).toEqual({ first_name: 'birth_certificate' });
    expect(p.approval.default).toEqual([{ kind: 'class_teacher' }, { kind: 'role', roleId: '7' }]);
    expect(p.approval.sections).toEqual({});
    expect(routeFor(p, 'father_annual_income')).toEqual([
      { kind: 'role', roleId: '12', name: 'Accountant' },
    ]);
    expect(routeFor(p, 'residential_city')).toEqual(p.approval.default);
    expect(routeSignature(routeFor(p, 'residential_city'))).toBe('class_teacher>role:7');
    expect(approverLabel({ kind: 'role', roleId: '12', name: 'Accountant' })).toBe(
      'Role: Accountant',
    );
  });

  it('a school that saved no proofs keeps none', () => {
    expect(resolvePolicy({ proofs: {} }).proofs).toEqual({});
  });

  it('the update window: open, closed, before, during and after a period', () => {
    expect(windowState({ mode: 'open' }).open).toBe(true);
    expect(windowState({ mode: 'closed', message: 'Closed for audit' })).toMatchObject({
      open: false,
      message: 'Closed for audit',
    });
    const w = { mode: 'period' as const, from: '2026-04-01', to: '2026-05-31' };
    expect(windowState(w, '2026-03-31')).toMatchObject({
      open: false,
      message: 'Profile updates open on 2026-04-01.',
    });
    expect(windowState(w, '2026-04-15')).toMatchObject({ open: true, until: '2026-05-31' });
    expect(windowState(w, '2026-06-01')).toMatchObject({
      open: false,
      message: 'The profile update period has ended.',
    });
  });
});
