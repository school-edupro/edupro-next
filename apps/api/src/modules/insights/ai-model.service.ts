import { Injectable, Logger } from '@nestjs/common';
import { HttpLlmProvider } from '@edupro/ai';
import { decryptField, encryptField } from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { PLATFORM } from '../platform/platform.permissions';

/** The stored row (`app.ai_model_get()`), the token still encrypted. */
interface Row {
  url: string;
  token: string;
  token_last4: string;
  reply_field: string | null;
  timeout_seconds: number;
  is_on: boolean;
  updated_by_name: string | null;
  updated_at: Date;
  tested_at: Date | null;
  test_ok: boolean | null;
  test_note: string | null;
}

export interface AiModelSave {
  url: string;
  /** empty or missing: keep the saved token */
  token?: string | null;
  replyField?: string | null;
  timeoutSeconds: number;
  on: boolean;
}

/** the address: http(s), no user or password in it, nothing after a # */
export function checkModelUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new DomainError(
      'validation-failed',
      'Write the full address, like http://localhost:8080/v1/chat',
      {
        status: 400,
      },
    );
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    throw new DomainError('validation-failed', 'The address starts with http:// or https://', {
      status: 400,
    });
  if (u.username || u.password)
    throw new DomainError(
      'validation-failed',
      'Put the token in the Token box, not in the address',
      { status: 400 },
    );
  if (u.hash)
    throw new DomainError('validation-failed', 'The address has no # part', { status: 400 });
  return u.toString();
}

/**
 * The LLM of our own, set once for all schools (docs/design/101): read, saved and tested by holders of the right
 * `platform.ai_model.manage` (in no role; only holders pass it on); used by the assistant and the AI reports where a
 * school has switched it on. The token is decrypted only to make a call and never returned.
 */
@Injectable()
export class AiModelService {
  private readonly logger = new Logger(AiModelService.name);
  private cache: { at: number; row: Row | null } | null = null;

  constructor(private readonly db: DbService) {}

  private async row(fresh = false): Promise<Row | null> {
    if (!fresh && this.cache && Date.now() - this.cache.at < 15_000) return this.cache.row;
    const r = await this.db.global((c) => c.query<Row>('SELECT * FROM app.ai_model_get()'));
    const row = r.rows[0] ?? null;
    this.cache = { at: Date.now(), row };
    return row;
  }

  private build(row: Row): HttpLlmProvider | null {
    const token = decryptField(row.token);
    if (!token) {
      this.logger.warn('ai model: the saved token cannot be read (the field key changed?)');
      return null;
    }
    return new HttpLlmProvider({
      url: row.url,
      token,
      replyField: row.reply_field,
      timeoutMs: row.timeout_seconds * 1000,
    });
  }

  /** The model to use, when one is set up and on; else null (things stay as before). */
  async provider(): Promise<HttpLlmProvider | null> {
    try {
      const row = await this.row();
      return row?.is_on ? this.build(row) : null;
    } catch (e) {
      this.logger.warn(`ai model: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  /** What a person sees: holders the settings (never the token, its last 4); others whether a model is set up. */
  async view(ctx: RequestContext) {
    const row = await this.row(true);
    const manage = !!ctx.permissions?.has(PLATFORM.aiModelManage);
    return {
      canManage: manage,
      configured: !!row,
      on: !!row?.is_on,
      settings:
        manage && row
          ? {
              url: row.url,
              tokenLast4: row.token_last4,
              replyField: row.reply_field,
              timeoutSeconds: row.timeout_seconds,
              on: row.is_on,
              updatedBy: row.updated_by_name,
              updatedAt: row.updated_at.toISOString(),
              lastTest: row.tested_at
                ? { at: row.tested_at.toISOString(), ok: row.test_ok, note: row.test_note }
                : null,
            }
          : null,
    };
  }

  async save(ctx: RequestContext, dto: AiModelSave) {
    const url = checkModelUrl(dto.url);
    const token = dto.token?.trim() ? dto.token.trim() : null;
    const was = await this.row(true);
    if (!token && !was)
      throw new DomainError('validation-failed', 'Enter the token the first time', { status: 400 });
    const shape = (r: {
      url: string;
      replyField: string | null;
      timeoutSeconds: number;
      on: boolean;
      last4: string;
    }) => ({
      url: r.url,
      replyField: r.replyField,
      timeoutSeconds: r.timeoutSeconds,
      on: r.on,
      token: `••••${r.last4}`,
    });
    const last4 = token ? token.slice(-4) : (was?.token_last4 ?? '');
    await this.db.tenant(requireTenant(ctx), (c) =>
      c.query('SELECT app.ai_model_save($1, $2, $3, $4, $5, $6)', [
        url,
        token ? encryptField(token) : null,
        token ? last4 : null,
        dto.replyField?.trim() || null,
        dto.timeoutSeconds,
        dto.on,
      ]),
    );
    this.cache = null;
    ctx.audit = {
      action: 'platform.ai_model.save',
      entityType: 'ai_model_settings',
      entityId: '1',
      before: was
        ? shape({
            url: was.url,
            replyField: was.reply_field,
            timeoutSeconds: was.timeout_seconds,
            on: was.is_on,
            last4: was.token_last4,
          })
        : null,
      after: {
        ...shape({
          url,
          replyField: dto.replyField?.trim() || null,
          timeoutSeconds: dto.timeoutSeconds,
          on: dto.on,
          last4,
        }),
        tokenChanged: !!token,
      },
    };
    return this.view(ctx);
  }

  /** One prompt to the saved model (on or off), as the test panel shows it; kept as the last test. */
  async test(ctx: RequestContext, prompt: string) {
    const row = await this.row(true);
    if (!row)
      throw new DomainError('not-found', 'Save the address and token first', { status: 404 });
    const llm = this.build(row);
    if (!llm)
      throw new DomainError('conflict', 'The saved token cannot be read: enter it again', {
        status: 409,
      });
    const r = await llm.ask(prompt);
    const note = r.ok
      ? `Answered in ${String(r.ms)} ms${r.field ? ` (from ${r.field})` : ''}`
      : (r.problem ?? 'No answer');
    await this.db.global((c) => c.query('SELECT app.ai_model_tested($1, $2)', [r.ok, note]));
    this.cache = null;
    ctx.audit = {
      action: 'platform.ai_model.test',
      entityType: 'ai_model_settings',
      entityId: '1',
      after: { ok: r.ok, status: r.status, ms: r.ms, promptLength: prompt.length },
    };
    return {
      ok: r.ok,
      status: r.status,
      ms: r.ms,
      reply: r.text,
      field: r.field,
      problem: r.problem,
      raw: r.raw.length > 4000 ? `${r.raw.slice(0, 4000)}…` : r.raw,
    };
  }
}
