/**
 * Business rule violation raised by services. Mapped to RFC 7807 problem details by ProblemDetailsFilter.
 * `type` is a stable slug the front end can switch on; `status` defaults by convention.
 */
export class DomainError extends Error {
  readonly type: string;
  readonly status: number;
  readonly extra: Record<string, unknown> | undefined;

  constructor(type: string, detail: string, options: { status?: number; extra?: Record<string, unknown> } = {}) {
    super(detail);
    this.name = 'DomainError';
    this.type = type;
    this.status = options.status ?? DomainError.defaultStatus(type);
    this.extra = options.extra;
  }

  static defaultStatus(type: string): number {
    if (type === 'not-found' || type.endsWith('.not_found')) return 404;
    if (type === 'conflict' || type.endsWith('.conflict') || type.endsWith('.duplicate')) return 409;
    if (type.startsWith('year.') || type.endsWith('.locked')) return 409;
    if (type === 'validation-failed') return 400;
    return 422;
  }
}
