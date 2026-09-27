import type { Usage } from './provider';

/**
 * Cost and abuse controls (design principle 6): a per-user daily token budget and a per-school monthly
 * budget, kept in a pluggable store (memory here; Redis in the API through the same interface).
 */
export interface BudgetStore {
  /** Adds `by` to the counter and returns the new value; the key expires after ttlSeconds. */
  incr(key: string, by: number, ttlSeconds: number): Promise<number>;
  get(key: string): Promise<number>;
}

export class MemoryBudgetStore implements BudgetStore {
  private readonly items = new Map<string, { value: number; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async incr(key: string, by: number, ttlSeconds: number): Promise<number> {
    const cur = this.live(key);
    const value = (cur?.value ?? 0) + by;
    this.items.set(key, { value, expiresAt: cur?.expiresAt ?? this.now() + ttlSeconds * 1000 });
    return value;
  }

  async get(key: string): Promise<number> {
    return this.live(key)?.value ?? 0;
  }

  private live(key: string) {
    const item = this.items.get(key);
    if (!item) return undefined;
    if (item.expiresAt <= this.now()) {
      this.items.delete(key);
      return undefined;
    }
    return item;
  }
}

export interface BudgetLimits {
  /** Tokens (input + output) one user may spend per IST day. */
  perUserDailyTokens: number;
  /** Tokens one school may spend per calendar month. */
  perSchoolMonthlyTokens: number;
  /** Fraction of the school budget at which `check` starts reporting a warning. */
  warnAt?: number;
}

export interface BudgetScope {
  schoolId: string;
  userId: string | null;
}

export interface BudgetCheck {
  allowed: boolean;
  reason: 'ok' | 'user_daily' | 'school_monthly';
  userSpent: number;
  schoolSpent: number;
  warning: boolean;
}

export class BudgetExceededError extends Error {
  constructor(readonly check: BudgetCheck) {
    super(
      check.reason === 'user_daily'
        ? 'Your daily assistant budget is used up; try again tomorrow'
        : "The school's monthly assistant budget is used up",
    );
    this.name = 'BudgetExceededError';
  }
}

/** Approximate price per million tokens in paise, by model prefix; used for the cost dashboard only. */
export const PRICE_PAISE_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-opus': { input: 125_000, output: 625_000 },
  'claude-sonnet': { input: 25_000, output: 125_000 },
  'claude-haiku': { input: 8_000, output: 40_000 },
  mock: { input: 0, output: 0 },
};

export function estimateCostPaise(model: string, usage: Usage): number {
  const key = Object.keys(PRICE_PAISE_PER_MTOK).find((k) => model.startsWith(k)) ?? 'claude-sonnet';
  const p = PRICE_PAISE_PER_MTOK[key]!;
  return Math.round((usage.inputTokens * p.input + usage.outputTokens * p.output) / 1_000_000);
}

export class BudgetMeter {
  constructor(
    private readonly store: BudgetStore,
    private readonly limits: BudgetLimits,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** IST day and month keys, so budgets reset at midnight in India. */
  keys(scope: BudgetScope) {
    const ist = new Date(this.now().getTime() + 5.5 * 3600 * 1000);
    const day = ist.toISOString().slice(0, 10);
    const month = day.slice(0, 7);
    return {
      user: scope.userId ? `ai:budget:user:${scope.schoolId}:${scope.userId}:${day}` : null,
      school: `ai:budget:school:${scope.schoolId}:${month}`,
    };
  }

  async check(scope: BudgetScope): Promise<BudgetCheck> {
    const k = this.keys(scope);
    const userSpent = k.user ? await this.store.get(k.user) : 0;
    const schoolSpent = await this.store.get(k.school);
    const warning = schoolSpent >= this.limits.perSchoolMonthlyTokens * (this.limits.warnAt ?? 0.8);
    if (schoolSpent >= this.limits.perSchoolMonthlyTokens)
      return { allowed: false, reason: 'school_monthly', userSpent, schoolSpent, warning };
    if (k.user && userSpent >= this.limits.perUserDailyTokens)
      return { allowed: false, reason: 'user_daily', userSpent, schoolSpent, warning };
    return { allowed: true, reason: 'ok', userSpent, schoolSpent, warning };
  }

  async record(scope: BudgetScope, usage: Usage): Promise<void> {
    const tokens = usage.inputTokens + usage.outputTokens;
    const k = this.keys(scope);
    if (k.user) await this.store.incr(k.user, tokens, 36 * 3600);
    await this.store.incr(k.school, tokens, 40 * 24 * 3600);
  }
}
