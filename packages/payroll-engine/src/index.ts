/**
 * @edupro/payroll-engine — the payroll calculation as pure functions (docs/design/86, plan
 * PAYROLL_MODULE_PLAN.md §1A): money in paise, the pay-head formula language, the calculation order; the
 * per-employee calculation, statutory and tax rules follow in phase B onwards. No database: the API loads
 * the data, the engine computes, the API writes — and the parity replay uses the same functions.
 */
export * from './money';
export * from './formula';
export * from './order';
