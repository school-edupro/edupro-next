import { describe, expect, it } from 'vitest';
import { calcOrder, headDeps } from '../src/order';

const f = (code: string, formula: string, dependsOn?: string) => ({
  code,
  calcType: 'FORMULA',
  formula,
  dependsOn: dependsOn ?? null,
});
const fixed = (code: string) => ({ code, calcType: 'FIXED' });

describe('the calculation order of earning heads', () => {
  it('puts each head after the heads its formula uses, ties in the order given', () => {
    const heads = [
      f('TA', 'ROUND([TA_BASE]+[TA_BASE]*DA_RATE)'),
      f('OT', 'ROUND(OT_HOURS*([BASIC]+[DA])/26/8*2)'),
      f('DA', 'ROUND([BASIC]*DA_RATE)'),
      fixed('BASIC'),
      f('HRA', 'ROUND([BASIC]*HRA_RATE)'),
    ];
    expect(calcOrder(heads)).toEqual({ ok: true, order: ['TA', 'BASIC', 'DA', 'OT', 'HRA'] });
  });
  it('uses DependsOn when it is set, in place of the formula', () => {
    const heads = [f('X', '[Y] + 1', 'Z'), fixed('Y'), fixed('Z')];
    expect(calcOrder(heads)).toEqual({ ok: true, order: ['Z', 'X', 'Y'] });
  });
  it('waits only for heads in the list', () => {
    expect(calcOrder([f('HRA', '[BASIC] * 0.24')])).toEqual({ ok: true, order: ['HRA'] });
  });
  it('reports a cycle', () => {
    const heads = [f('A', '[B] + 1'), f('B', '[C] + 1'), f('C', '[A] + 1')];
    expect(calcOrder(heads)).toEqual({
      ok: false,
      error: 'Dependency cycle among earning heads (DependsOn).',
    });
    expect(calcOrder([f('PF2', '[PF2]')], 'deduction')).toEqual({
      ok: false,
      error: 'Dependency cycle among deduction heads (DependsOn).',
    });
  });
  it('reads the dependencies a head declares', () => {
    expect(headDeps(f('TA', '[TA_BASE] * 2'))).toEqual([]);
    expect(headDeps(f('X', '', ' basic , da , '))).toEqual(['BASIC', 'DA']);
    expect(headDeps({ code: 'S', calcType: 'SLAB', formula: '[BASIC]' })).toEqual([]);
    expect(headDeps({ code: 'F', calcType: 'FORMULA', formula: '  ' })).toEqual([]);
    expect(headDeps({ code: 'F', calcType: 'FORMULA' })).toEqual([]);
  });
});
