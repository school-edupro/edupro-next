import { Injectable } from '@nestjs/common';
import { decryptField, encryptField, type PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ATOM_URLS } from './adapters/atom';
import { SBIEPAY_URLS } from './adapters/sbiepay';

export type GatewayProvider = 'payu' | 'ccavenue' | 'razorpay' | 'sbiepay' | 'atom';
export type FeeLedger = 'school' | 'hostel' | 'misc' | 'admission';
export const GATEWAY_PROVIDERS: GatewayProvider[] = [
  'payu',
  'ccavenue',
  'razorpay',
  'sbiepay',
  'atom',
];

/** What each gateway asks for: plain fields (shown again) and keys (kept encrypted, never shown). */
export const GATEWAY_FIELDS: Record<
  GatewayProvider,
  { name: string; config: Array<[string, string]>; secret: Array<[string, string]> }
> = {
  payu: {
    name: 'PayU',
    config: [['merchantKey', 'Merchant key']],
    secret: [['salt', 'Salt (v1)']],
  },
  ccavenue: {
    name: 'CCAvenue',
    config: [
      ['merchantId', 'Merchant id'],
      ['accessCode', 'Access code'],
    ],
    secret: [['workingKey', 'Working key']],
  },
  razorpay: {
    name: 'Razorpay',
    config: [['keyId', 'Key id']],
    secret: [
      ['keySecret', 'Key secret'],
      ['webhookSecret', 'Webhook secret'],
    ],
  },
  sbiepay: {
    name: 'SBI ePay',
    config: [['merchantId', 'Merchant id']],
    secret: [['key', 'Encryption key']],
  },
  atom: {
    name: 'Atom (NTT DATA AIPAY)',
    config: [
      ['login', 'Merchant id (MID)'],
      ['productId', 'Product id'],
    ],
    secret: [
      ['password', 'Transaction password'],
      ['reqEncKey', 'Request encryption key (AES)'],
      ['resDecKey', 'Response decryption key (AES)'],
      ['resHashKey', 'Response hash key'],
    ],
  },
};

/** Where each gateway takes the payer, by mode. */
export const GATEWAY_URLS: Record<GatewayProvider, { test: string; live: string }> = {
  payu: { test: 'https://test.payu.in/_payment', live: 'https://secure.payu.in/_payment' },
  ccavenue: {
    test: 'https://test.ccavenue.com/transaction/transaction.do?command=initiateTransaction',
    live: 'https://secure.ccavenue.com/transaction/transaction.do?command=initiateTransaction',
  },
  razorpay: { test: 'https://api.razorpay.com', live: 'https://api.razorpay.com' },
  sbiepay: SBIEPAY_URLS,
  atom: ATOM_URLS,
};

export interface GatewayRow {
  id: string;
  provider: GatewayProvider;
  label: string;
  mode: 'test' | 'live';
  config: Record<string, string>;
  /** which keys are saved (the keys themselves are never returned) */
  secretsSaved: string[];
  chargePercent: string;
  chargeFlat: string;
  active: boolean;
  bankAccountId: string | null;
  ledgers: FeeLedger[];
}
export interface GatewayAccount {
  id: string;
  schoolId: string;
  provider: GatewayProvider;
  mode: 'test' | 'live';
  config: Record<string, string>;
  secret: Record<string, string>;
  url: string;
}
export interface GatewayOption {
  id: string;
  provider: GatewayProvider;
  label: string;
  chargePercent: string;
  chargeFlat: string;
}

/** The convenience charge on top of a fee: % of the fee plus the flat amount, in rupees and paise. */
export const chargeOn = (
  amount: number,
  g: { chargePercent: string; chargeFlat: string },
): number =>
  Math.round(((amount * Number(g.chargePercent)) / 100) * 100 + Number(g.chargeFlat) * 100) / 100;

const account = (r: {
  id: string;
  school_id: string;
  provider: GatewayProvider;
  mode: 'test' | 'live';
  config: Record<string, string>;
  secret: string | null;
}): GatewayAccount => ({
  id: r.id,
  schoolId: r.school_id,
  provider: r.provider,
  mode: r.mode,
  config: r.config ?? {},
  secret: r.secret ? (JSON.parse(decryptField(r.secret) ?? '{}') as Record<string, string>) : {},
  url: GATEWAY_URLS[r.provider][r.mode],
});

/**
 * The school's payment gateways (0142): its accounts with PayU, CCAvenue, Razorpay, SBI ePay and Atom, set
 * up by the school admin with test or live keys (kept encrypted, never shown again), a convenience charge
 * each, and which fee (school, hostel, misc, admission) each takes. A payer with more than one gateway for a
 * fee chooses.
 */
@Injectable()
export class GatewaysService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: RequestContext): Promise<GatewayRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        id: string;
        provider: GatewayProvider;
        label: string;
        mode: 'test' | 'live';
        config: Record<string, string>;
        secret: string | null;
        charge_percent: string;
        charge_flat: string;
        active: boolean;
        bank_account_id: string | null;
        ledgers: FeeLedger[] | null;
      }>(
        `SELECT g.id::text, g.provider, g.label, g.mode, g.config, g.secret, g.charge_percent::text, g.charge_flat::text, g.active,
                g.bank_account_id::text, (SELECT array_agg(r.ledger::text ORDER BY r.ledger) FROM payment_gateway_routes r WHERE r.gateway_id = g.id) AS ledgers
           FROM payment_gateways g ORDER BY g.active DESC, g.id`,
      );
      return r.rows.map((g) => ({
        id: g.id,
        provider: g.provider,
        label: g.label,
        mode: g.mode,
        config: g.config ?? {},
        secretsSaved: g.secret
          ? Object.entries(JSON.parse(decryptField(g.secret) ?? '{}') as Record<string, string>)
              .filter(([, v]) => v)
              .map(([k]) => k)
          : [],
        chargePercent: g.charge_percent,
        chargeFlat: g.charge_flat,
        active: g.active,
        bankAccountId: g.bank_account_id,
        ledgers: g.ledgers ?? [],
      }));
    });
  }

  /** Adds or changes a gateway account; an empty key box keeps the saved key. */
  async save(
    ctx: RequestContext,
    dto: {
      id?: string;
      provider: GatewayProvider;
      label: string;
      mode: 'test' | 'live';
      config: Record<string, string>;
      secret: Record<string, string>;
      chargePercent: number;
      chargeFlat: number;
      active: boolean;
      bankAccountId?: string | null;
    },
  ): Promise<GatewayRow[]> {
    const spec = GATEWAY_FIELDS[dto.provider];
    const config = Object.fromEntries(spec.config.map(([k]) => [k, (dto.config[k] ?? '').trim()]));
    await this.db.tenant(requireTenant(ctx), async (c) => {
      let saved: Record<string, string> = {};
      if (dto.id) {
        const was = await c.query<{ provider: string; secret: string | null }>(
          `SELECT provider, secret FROM payment_gateways WHERE id = $1`,
          [dto.id],
        );
        if (!was.rows[0]) throw new DomainError('not-found', 'Gateway not found', { status: 404 });
        if (was.rows[0].provider !== dto.provider)
          throw new DomainError(
            'payments.gateway_provider_fixed',
            'A gateway cannot change its provider; add a new one',
            {
              status: 409,
            },
          );
        saved = was.rows[0].secret
          ? (JSON.parse(decryptField(was.rows[0].secret) ?? '{}') as Record<string, string>)
          : {};
      }
      const secret = Object.fromEntries(
        spec.secret.map(([k]) => [k, (dto.secret[k] ?? '').trim() || saved[k] || '']),
      );
      // a live gateway must have every field and key: a half-filled one would fail at the payer's checkout
      const missing = [
        ...spec.config.filter(([k]) => !config[k]).map(([, l]) => l),
        ...spec.secret.filter(([k]) => !secret[k]).map(([, l]) => l),
      ];
      if (dto.active && missing.length)
        throw new DomainError(
          'validation-failed',
          `${spec.name}: fill ${missing.join(', ')} (or switch it off)`,
          {
            status: 422,
          },
        );
      const values = [
        dto.provider,
        dto.label.trim(),
        dto.mode,
        JSON.stringify(config),
        encryptField(JSON.stringify(secret)),
        dto.chargePercent,
        dto.chargeFlat,
        dto.active,
        dto.bankAccountId ?? null,
      ];
      if (dto.id)
        await c.query(
          `UPDATE payment_gateways SET provider = $1, label = $2, mode = $3, config = $4::jsonb, secret = $5, charge_percent = $6, charge_flat = $7,
                  active = $8, bank_account_id = $9, updated_at = now(), updated_by = app.current_user_id() WHERE id = $10`,
          [...values, dto.id],
        );
      else
        await c.query(
          `INSERT INTO payment_gateways (school_id, provider, label, mode, config, secret, charge_percent, charge_flat, active, bank_account_id, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, app.current_user_id(), app.current_user_id())`,
          values,
        );
      await this.audit.stage(ctx, c, {
        action: dto.id ? 'payments.gateway.update' : 'payments.gateway.create',
        entityType: 'payment_gateways',
        entityId: dto.id ?? dto.provider,
        // the keys are never written to the audit log: only which were given
        after: {
          provider: dto.provider,
          label: dto.label,
          mode: dto.mode,
          config,
          keysChanged: Object.keys(dto.secret).filter((k) => (dto.secret[k] ?? '').trim()),
          chargePercent: dto.chargePercent,
          chargeFlat: dto.chargeFlat,
          active: dto.active,
        },
      });
    });
    return this.list(ctx);
  }

  /** Which gateways take each fee, in order (the first is offered first). */
  async setRoutes(ctx: RequestContext, routes: Partial<Record<FeeLedger, string[]>>) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      for (const [ledger, ids] of Object.entries(routes) as Array<[FeeLedger, string[]]>) {
        await c.query(`DELETE FROM payment_gateway_routes WHERE ledger = $1::ledger_type`, [
          ledger,
        ]);
        let n = 0;
        for (const id of ids) {
          const ok = await c.query(`SELECT 1 FROM payment_gateways WHERE id = $1`, [id]);
          if (!ok.rowCount)
            throw new DomainError('not-found', 'Gateway not found', { status: 404 });
          await c.query(
            `INSERT INTO payment_gateway_routes (school_id, ledger, gateway_id, sort_order) VALUES (app.current_school_id(), $1::ledger_type, $2, $3)`,
            [ledger, id, n++],
          );
        }
      }
      await this.audit.stage(ctx, c, {
        action: 'payments.gateway.routes',
        entityType: 'payment_gateway_routes',
        entityId: 'all',
        after: routes,
      });
    });
    return this.list(ctx);
  }

  /** The gateways a payer may use for a fee (active ones mapped to it), with their charges. */
  async options(c: PoolClient, ledger: FeeLedger): Promise<GatewayOption[]> {
    const r = await c.query<{
      id: string;
      provider: GatewayProvider;
      label: string;
      charge_percent: string;
      charge_flat: string;
    }>(
      `SELECT g.id::text, g.provider, g.label, g.charge_percent::text, g.charge_flat::text
         FROM payment_gateway_routes r JOIN payment_gateways g ON g.id = r.gateway_id
        WHERE r.ledger = $1::ledger_type AND g.active ORDER BY r.sort_order, g.id`,
      [ledger],
    );
    return r.rows.map((g) => ({
      id: g.id,
      provider: g.provider,
      label: g.label,
      chargePercent: g.charge_percent,
      chargeFlat: g.charge_flat,
    }));
  }

  /** A gateway account with its keys, inside the school's transaction. */
  async accountIn(c: PoolClient, id: string): Promise<GatewayAccount> {
    const r = await c.query<{
      id: string;
      school_id: string;
      provider: GatewayProvider;
      mode: 'test' | 'live';
      config: Record<string, string>;
      secret: string | null;
    }>(
      `SELECT id::text, school_id::text, provider, mode, config, secret FROM payment_gateways WHERE id = $1`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Gateway not found', { status: 404 });
    return account(r.rows[0]);
  }

  /** A gateway account by id before any school is known (a gateway's return names it). */
  async accountById(id: string): Promise<GatewayAccount | null> {
    if (!/^\d{1,18}$/.test(id)) return null;
    return this.db.global(async (c) => {
      const r = await c.query<{
        school_id: string;
        provider: GatewayProvider;
        mode: 'test' | 'live';
        config: Record<string, string>;
        secret: string | null;
      }>(
        `SELECT school_id::text, provider, mode, config, secret FROM app.payment_gateway_lookup($1)`,
        [id],
      );
      return r.rows[0] ? account({ id, ...r.rows[0] }) : null;
    });
  }

  /** The account a transaction (or a provider's order) went through, before any school is known. */
  async accountOfTxn(txnId: string | null, provider: string, orderId: string | null) {
    const id = await this.db.global(async (c) => {
      if (txnId) {
        const r = await c.query<{ v: string | null }>(
          `SELECT app.payment_intent_gateway($1)::text AS v`,
          [txnId],
        );
        if (r.rows[0]?.v) return r.rows[0].v;
      }
      if (orderId) {
        const r = await c.query<{ v: string | null }>(
          `SELECT app.payment_order_gateway($1, $2)::text AS v`,
          [provider, orderId],
        );
        if (r.rows[0]?.v) return r.rows[0].v;
      }
      return null;
    });
    return id ? this.accountById(id) : null;
  }
}
