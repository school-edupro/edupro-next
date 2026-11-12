/**
 * The order heads are computed in (legacy `pr_calc_employee`, step 3): a depth-first topological sort of the
 * structure's heads of one kind, each after the heads it depends on — its DependsOn list when set, else the
 * heads its formula refers to. `[X_BASE]` is the head's own structure amount, not a dependency; a head not in
 * the list (another kind, or not in the structure) is not waited for. Ties keep the order given.
 */
import { dependencies } from './formula';

export interface OrderHead {
  code: string;
  calcType: string;
  formula?: string | null;
  /** comma-separated head codes; when set it replaces the formula's references */
  dependsOn?: string | null;
}

export type OrderResult = { ok: true; order: string[] } | { ok: false; error: string };

/** The heads a head waits for, as written (upper case, `_BASE` tokens left out). */
export function headDeps(head: OrderHead): string[] {
  const declared = (head.dependsOn ?? '').trim();
  const codes = declared
    ? declared.split(',')
    : head.calcType === 'FORMULA' && (head.formula ?? '').trim()
      ? dependencies(head.formula!).heads
      : [];
  return codes.map((c) => c.trim().toUpperCase()).filter((c) => c && !c.endsWith('_BASE'));
}

/** The heads in calculation order, or the cycle that prevents one. `kind` names the heads in the message. */
export function calcOrder(heads: readonly OrderHead[], kind = 'earning'): OrderResult {
  const codes = heads.map((h) => h.code.toUpperCase());
  const known = new Set(codes);
  const deps = new Map(
    heads.map((h) => [h.code.toUpperCase(), headDeps(h).filter((d) => known.has(d))]),
  );
  const mark = new Map<string, 1 | 2>();
  const order: string[] = [];
  const visit = (code: string): boolean => {
    const m = mark.get(code);
    if (m === 1) return false;
    if (m === 2) return true;
    mark.set(code, 1);
    for (const d of deps.get(code)!) if (!visit(d)) return false;
    mark.set(code, 2);
    order.push(code);
    return true;
  };
  for (const code of codes)
    if (!visit(code))
      return { ok: false, error: `Dependency cycle among ${kind} heads (DependsOn).` };
  return { ok: true, order };
}
