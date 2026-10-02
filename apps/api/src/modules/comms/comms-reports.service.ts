import { Injectable } from '@nestjs/common';
import { datasetOrNull } from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { CommsSettingsService } from './comms-settings.service';

export interface ChannelKpi {
  channel: string;
  messages: number;
  units: number;
  delivered: number;
  read: number;
  failed: number;
  pending: number;
  cost: number;
}

const monthRange = (month?: string) => {
  const m =
    month && /^\d{4}-\d{2}$/.test(month)
      ? month
      : new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
  const [y, mm] = m.split('-').map(Number) as [number, number];
  const from = `${m}-01`;
  const next =
    mm === 12 ? `${String(y + 1)}-01-01` : `${String(y)}-${String(mm + 1).padStart(2, '0')}-01`;
  const prevM =
    mm === 1 ? `${String(y - 1)}-12` : `${String(y)}-${String(mm - 1).padStart(2, '0')}`;
  return { month: m, from, next, prev: { from: `${prevM}-01`, next: from, month: prevM } };
};

/**
 * Communication dashboard and reports (v2): this month by channel against last month, the daily
 * trend, credit balances, recent requests, senders and failure reasons; the monthly usage statement
 * (also an Excel / PDF export through the export queue).
 */
@Injectable()
export class CommsReportsService {
  constructor(
    private readonly db: DbService,
    private readonly settings: CommsSettingsService,
  ) {}

  async dashboard(ctx: RequestContext, month?: string) {
    const r = monthRange(month);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const kpis = async (from: string, next: string): Promise<ChannelKpi[]> =>
        (
          await c.query<ChannelKpi>(
            `SELECT ch.channel,
                    COALESCE(count(m.id), 0)::int AS messages, COALESCE(sum(m.units), 0)::int AS units,
                    count(m.id) FILTER (WHERE m.status = 'delivered')::int AS delivered,
                    count(m.id) FILTER (WHERE m.read_at IS NOT NULL)::int AS read,
                    count(m.id) FILTER (WHERE m.status = 'failed')::int AS failed,
                    count(m.id) FILTER (WHERE m.status IN ('queued', 'sending', 'sent'))::int AS pending,
                    round(COALESCE(sum(m.cost), 0), 2)::float AS cost
               FROM (VALUES ('sms'), ('whatsapp'), ('email')) AS ch(channel)
               LEFT JOIN comms_messages m ON m.channel::text = ch.channel AND m.status <> 'cancelled'
                    AND m.created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Kolkata') AND m.created_at < ($2::date::timestamp AT TIME ZONE 'Asia/Kolkata')
              GROUP BY ch.channel ORDER BY array_position(ARRAY['sms', 'whatsapp', 'email'], ch.channel)`,
            [from, next],
          )
        ).rows;
      const daily = await c.query<{ day: string; channel: string; messages: number }>(
        `SELECT to_char((m.created_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS day, m.channel::text AS channel, count(*)::int AS messages
           FROM comms_messages m
          WHERE m.status <> 'cancelled' AND m.channel <> 'push'
            AND m.created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Kolkata') AND m.created_at < ($2::date::timestamp AT TIME ZONE 'Asia/Kolkata')
          GROUP BY 1, 2 ORDER BY 1`,
        [r.from, r.next],
      );
      const requests = await c.query<{
        id: string;
        title: string;
        status: string;
        channels: Array<{ channel: string }>;
        recipients_total: number;
        requested_at: Date;
        by: string | null;
        delivered: number;
        failed: number;
      }>(
        `SELECT q.id::text, q.title, q.status::text, q.channels, q.recipients_total, q.requested_at, u.display_name AS by,
                (SELECT count(*)::int FROM comms_messages m WHERE m.message_request_id = q.id AND m.status = 'delivered') AS delivered,
                (SELECT count(*)::int FROM comms_messages m WHERE m.message_request_id = q.id AND m.status = 'failed') AS failed
           FROM message_requests q LEFT JOIN users u ON u.id = q.requested_by
          ORDER BY q.requested_at DESC LIMIT 8`,
      );
      const senders = await c.query<{ name: string; messages: number; cost: number }>(
        `SELECT COALESCE(u.display_name, 'System') AS name, count(*)::int AS messages, round(COALESCE(sum(m.cost), 0), 2)::float AS cost
           FROM comms_messages m LEFT JOIN users u ON u.id = m.created_by
          WHERE m.status <> 'cancelled' AND m.created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Kolkata') AND m.created_at < ($2::date::timestamp AT TIME ZONE 'Asia/Kolkata')
          GROUP BY 1 ORDER BY 2 DESC LIMIT 6`,
        [r.from, r.next],
      );
      const failures = await c.query<{ channel: string; reason: string; messages: number }>(
        `SELECT channel::text, COALESCE(NULLIF(left(last_error, 120), ''), 'Unknown') AS reason, count(*)::int AS messages
           FROM comms_messages WHERE status = 'failed'
            AND created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Kolkata') AND created_at < ($2::date::timestamp AT TIME ZONE 'Asia/Kolkata')
          GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 6`,
        [r.from, r.next],
      );
      const providers = await c.query<{ channel: string; provider: string; active: boolean }>(
        `SELECT channel::text, provider, active FROM comms_providers`,
      );
      return {
        month: r.month,
        previousMonth: r.prev.month,
        channels: await kpis(r.from, r.next),
        previous: await kpis(r.prev.from, r.prev.next),
        daily: daily.rows,
        balances: await this.settings.balances(c),
        providers: providers.rows,
        requests: requests.rows.map((x) => ({
          id: x.id,
          title: x.title,
          status: x.status,
          channels: (x.channels ?? []).map((ch) => ch.channel),
          recipients: x.recipients_total,
          delivered: x.delivered,
          failed: x.failed,
          requestedAt: x.requested_at.toISOString(),
          by: x.by,
        })),
        senders: senders.rows,
        failures: failures.rows,
      };
    });
  }

  /** The rows of a communication dataset for the screen (the same query the export uses). */
  async table(ctx: RequestContext, id: string, params: Record<string, unknown>) {
    if (!['comms_monthly_usage', 'comms_failures', 'comms_delivery_log'].includes(id))
      throw new DomainError('not-found', 'Unknown report', { status: 404 });
    const d = datasetOrNull(id)!;
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const q = d.query(params);
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- the dataset query is a constant with bound parameters; the limit is a number
        `${q.text} LIMIT ${String(Math.min(d.maxRows, 2000))}`,
        q.values,
      );
      return { columns: d.columns, rows: r.rows };
    });
  }
}
