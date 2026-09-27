import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/** Prometheus registry (S5-04). Labels never carry ids of people; school ids are tenant ids, not PII. */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly httpRequests: Counter<'method' | 'route' | 'status'>;
  readonly httpDuration: Histogram<'method' | 'route'>;
  readonly securityEvents: Counter<'kind' | 'school'>;
  readonly securityAlerts: Counter<'kind'>;
  readonly logins: Counter<'method' | 'outcome'>;

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: 'edupro_' });
    this.httpRequests = new Counter({
      name: 'edupro_http_requests_total',
      help: 'HTTP requests by route and status',
      labelNames: ['method', 'route', 'status'],
      registers: [this.registry],
    });
    this.httpDuration = new Histogram({
      name: 'edupro_http_request_duration_seconds',
      help: 'HTTP request duration',
      labelNames: ['method', 'route'],
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });
    this.securityEvents = new Counter({
      name: 'edupro_security_events_total',
      help: 'Security events (denials, impersonation, break glass)',
      labelNames: ['kind', 'school'],
      registers: [this.registry],
    });
    this.securityAlerts = new Counter({
      name: 'edupro_security_alerts_total',
      help: 'Security alerts raised',
      labelNames: ['kind'],
      registers: [this.registry],
    });
    this.logins = new Counter({
      name: 'edupro_logins_total',
      help: 'Login events by method and outcome',
      labelNames: ['method', 'outcome'],
      registers: [this.registry],
    });
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }
}
