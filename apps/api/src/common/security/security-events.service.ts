import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { MetricsService } from '../metrics/metrics.service';

export type SecurityEventKind =
  | 'permission_denied'
  | 'unauthenticated'
  | 'mfa_required'
  | 'impersonation_start'
  | 'impersonation_end'
  | 'break_glass_start'
  | 'tenant_forbidden';

export interface SecurityAlert {
  id: number;
  at: string;
  kind: SecurityEventKind;
  schoolId: string | null;
  count: number;
  windowSeconds: number;
}

const WINDOW_MS = 60_000;
const COOLDOWN_MS = 5 * 60_000;

/**
 * Security event counter and alerting (S5-04). Every denial and privileged session change is counted per
 * school; when a kind exceeds the threshold inside one minute an alert is logged at error level, kept in
 * memory for the security view, and posted to the alert webhook when configured. Prometheus counters carry
 * the same events so the alert rule in ops/alerts fires in Alertmanager as well.
 */
@Injectable()
export class SecurityEventsService {
  private readonly logger = new Logger('security');
  private readonly windows = new Map<string, number[]>();
  private readonly lastAlert = new Map<string, number>();
  private readonly alerts: SecurityAlert[] = [];
  private seq = 0;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly metrics: MetricsService,
  ) {}

  record(
    kind: SecurityEventKind,
    meta: { schoolId?: string | null; userId?: string | null; detail?: string } = {},
  ): void {
    const schoolId = meta.schoolId ?? null;
    this.metrics.securityEvents.inc({ kind, school: schoolId ?? 'none' });
    const key = `${kind}|${schoolId ?? ''}`;
    const now = Date.now();
    const list = (this.windows.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    list.push(now);
    this.windows.set(key, list);
    const alertable =
      kind === 'permission_denied' ||
      kind === 'unauthenticated' ||
      kind === 'mfa_required' ||
      kind === 'tenant_forbidden';
    if (
      alertable &&
      list.length >= this.env.SECURITY_ALERT_THRESHOLD &&
      now - (this.lastAlert.get(key) ?? 0) > COOLDOWN_MS
    ) {
      this.lastAlert.set(key, now);
      const alert: SecurityAlert = {
        id: ++this.seq,
        at: new Date(now).toISOString(),
        kind,
        schoolId,
        count: list.length,
        windowSeconds: WINDOW_MS / 1000,
      };
      this.alerts.unshift(alert);
      if (this.alerts.length > 200) this.alerts.length = 200;
      this.logger.error(
        `security.alert ${kind} x${list.length} in 60s (school ${schoolId ?? 'none'})`,
      );
      this.metrics.securityAlerts.inc({ kind });
      void this.notify(alert);
    }
  }

  recentAlerts(schoolId?: string | null): SecurityAlert[] {
    return schoolId
      ? this.alerts.filter((a) => a.schoolId === schoolId || a.schoolId === null)
      : [...this.alerts];
  }

  private async notify(alert: SecurityAlert): Promise<void> {
    if (!this.env.SECURITY_ALERT_WEBHOOK) return;
    try {
      await fetch(this.env.SECURITY_ALERT_WEBHOOK, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'edupro-api', ...alert }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      this.logger.warn(
        `security alert webhook failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
