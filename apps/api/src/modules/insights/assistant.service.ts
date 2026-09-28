import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  Assistant,
  BudgetExceededError,
  BudgetMeter,
  MemoryBudgetStore,
  MockProvider,
  providerFromEnv,
  type AiAuditEvent,
  type AiAuditSink,
  type AiProvider,
  type AssistantTool,
  type BudgetStore,
  type CompletionRequest,
  type Message,
} from '@edupro/ai';
import type { PoolClient, TenantContext } from '@edupro/db';
import IORedis, { type Redis } from 'ioredis';
import { ViewerService } from '../academics/daily/viewer.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ENV, type Env } from '../../config/env';
import { buildCatalogue, runEntry, type CatalogueEntry } from './catalogue';

export interface AskDto {
  question: string;
  conversationId?: string;
  language?: 'en' | 'hi' | 'hinglish';
  /** Sprint 15: which app asked (validated against the caller's kind). */
  surface?: 'admin' | 'teacher' | 'parent';
}

export interface Citation {
  query: string;
  title: string;
  params: Record<string, unknown>;
  rows: number;
}

export interface AskResponse {
  conversationId: string;
  answer: string;
  refused: boolean;
  citations: Citation[];
  suggestions: Array<{ id: string; title: string }>;
  usage: { inputTokens: number; outputTokens: number };
  costPaise: number;
  provider: string;
  model: string;
}

/** Token budgets in Redis (shared across API instances); memory when Redis is unreachable. */
class RedisBudgetStore implements BudgetStore {
  private readonly fallback = new MemoryBudgetStore();
  private healthy = true;
  constructor(
    private readonly redis: Redis,
    private readonly log: Logger,
  ) {
    redis.on('error', () => {
      if (this.healthy) log.warn('redis unavailable for AI budgets; counting in memory');
      this.healthy = false;
    });
    redis.on('ready', () => {
      this.healthy = true;
    });
  }
  async incr(key: string, by: number, ttlSeconds: number): Promise<number> {
    if (this.healthy) {
      try {
        const v = await this.redis.incrby(key, by);
        if (v === by) await this.redis.expire(key, ttlSeconds);
        return v;
      } catch {
        /* fall through */
      }
    }
    return this.fallback.incr(key, by, ttlSeconds);
  }
  async get(key: string): Promise<number> {
    if (this.healthy) {
      try {
        return Number((await this.redis.get(key)) ?? 0);
      } catch {
        /* fall through */
      }
    }
    return this.fallback.get(key);
  }
}

/** The audit sink writes to ai_audit inside the caller's tenant transaction. */
class DbAuditSink implements AiAuditSink {
  constructor(private readonly c: PoolClient) {}
  async record(e: AiAuditEvent): Promise<void> {
    await this.c.query(
      `INSERT INTO ai_audit (school_id, user_id, request_id, conversation_id, kind, provider, model, text, redactions, input_tokens, output_tokens, cost_paise, citations, at)
       VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::timestamptz)`,
      [
        e.userId,
        e.requestId,
        e.conversationId,
        e.kind,
        e.provider,
        e.model,
        e.text.slice(0, 8000),
        e.redactions,
        e.usage?.inputTokens ?? null,
        e.usage?.outputTokens ?? null,
        e.costPaise ?? null,
        e.citations ? JSON.stringify(e.citations) : null,
        e.at,
      ],
    );
  }
}

const SYSTEM = `You are EduPro's assistant for school staff. You answer questions about this school from the
query catalogue tools only. Choose the tool whose description fits the question, fill its parameters from the
question (use list_classes or find_student first when you need an id), then answer in plain words with the
numbers from the results. Name the source query in your answer. Keep answers short; use a compact table when
there are several rows. Never invent data; if no tool fits, say so and name the closest tools.`;

const SYSTEM_TEACHER = `You are EduPro's assistant for a teacher. You answer only about the sections this teacher holds,
through the query catalogue tools (they are already limited to those sections). Fill parameters from the
question, then answer briefly in plain words with the numbers from the results and name the source query.
Never invent data; if no tool fits, say so and name the closest tools.`;

const SYSTEM_PARENT = `You are EduPro's assistant for a parent. You answer only about this parent's own children,
through the query catalogue tools (they are already limited to those children). Be warm and brief, in the
parent's language, with the figures from the results; name the source query. Never invent data, never
speculate about other children or staff; if no tool fits, say so kindly.`;

const HI = /[ऀ-ॿ]/;
/** Hinglish: Latin script with Hindi function words; two hits or one strong marker. */
const HINGLISH_WORDS =
  /\b(kya|kitna|kitni|kitne|kaun|kab|kaise|kyun|hai|hain|tha|the|ka|ki|ke|mera|mere|meri|bachcha|bachche|bachchi|bakaya|baki|hazri|haziri|chhutti|aaj|kal|abhi|nahi|nahin|dikhao|batao|bataiye|dijiye|kar|karo|wala|wale)\b/gi;
export function detectLanguage(question: string): 'en' | 'hi' | 'hinglish' {
  if (HI.test(question)) return 'hi';
  const hits = question.match(HINGLISH_WORDS)?.length ?? 0;
  const strong = /\b(kitna|kitni|bakaya|hazri|haziri|batao|dikhao|bachche|bachcha)\b/i.test(
    question,
  );
  return hits >= 2 || (hits >= 1 && strong) ? 'hinglish' : 'en';
}

/**
 * Offline responder for the mock provider: a keyword router over the catalogue so the assistant works in
 * development and tests without a model. Round 1 picks the entry (and a class or date when the question names
 * one); round 2 narrates the rows. The Claude provider replaces this whole function in production.
 */
export function catalogueMockResponder(
  entries: CatalogueEntry[],
  classes: Array<{ id: string; code: string }>,
) {
  return (req: CompletionRequest) => {
    const last = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    if (last.startsWith('Tool results')) {
      const outputs = JSON.parse(last.slice(last.indexOf('\n') + 1)) as Array<{
        name: string;
        ok: boolean;
        output: { rows?: Record<string, unknown>[]; truncated?: boolean; error?: string };
      }>;
      const o = outputs[0];
      if (!o || !o.ok)
        return `The query ${o?.name ?? ''} could not run: ${o?.output?.error ?? 'unknown error'}.`;
      const rows = o.output.rows ?? [];
      const hinglish = /Answer in Hinglish/.test(req.system ?? '');
      const hindi =
        !hinglish &&
        (HI.test(req.messages[0]?.content ?? '') || /Answer in Hindi/.test(req.system ?? ''));
      if (rows.length === 0)
        return hinglish
          ? `${o.name} se koi row nahi mili.`
          : hindi
            ? `${o.name} से कोई पंक्ति नहीं मिली।`
            : `No rows came back from ${o.name}.`;
      const cols = Object.keys(rows[0]!);
      const lines = rows
        .slice(0, 15)
        .map((r) => cols.map((k) => `${k}: ${String(r[k] ?? '—')}`).join(', '));
      const head = hinglish
        ? `${o.name} se ${rows.length} row(s) mili:`
        : hindi
          ? `${o.name} से ${rows.length} पंक्तियाँ:`
          : `${rows.length} row(s) from ${o.name}:`;
      return `${head}\n${lines.join('\n')}${o.output.truncated ? '\n…' : ''}`;
    }
    const q = last.toLowerCase();
    // the offline router answers questions about data only: writes, creative requests and the outside world are refused
    if (
      /\b(delete|remove|drop|truncate|update|change|set|reset|send|poem|joke|story|weather|news|song)\b/i.test(
        q,
      )
    )
      return '';
    const available = new Set((req.tools ?? []).map((t) => t.name));
    let best: CatalogueEntry | null = null;
    let score = 0;
    for (const e of entries) {
      if (!available.has(e.id)) continue;
      // longer keywords are more specific: "defaulter" beats "class", "collection by mode" beats "collection"
      const hits = e.keywords
        .filter((k) => q.includes(k.toLowerCase()))
        .reduce((n, k) => n + k.length, 0);
      if (hits > score) {
        score = hits;
        best = e;
      }
    }
    // a single short word such as "class" is not enough to pick a query; refuse and let the page suggest
    if (!best || score < 6) return '';
    const input: Record<string, unknown> = {};
    const cls = classes.find((k) =>
      new RegExp(`\\bclass\\s+${k.code.toLowerCase()}\\b|\\b${k.code.toLowerCase()}\\b`).test(q),
    );
    if (cls && best.params.some((p) => p.name === 'classId')) input.classId = cls.id;
    const m = /(\d{4}-\d{2}-\d{2})/.exec(q);
    if (m && best.params.some((p) => p.name === 'date')) input.date = m[1];
    const amt = /(?:above|over|more than|से अधिक)\s*₹?\s*([\d,]+)/.exec(q);
    if (amt && best.params.some((p) => p.name === 'minAmount'))
      input.minAmount = Number(amt[1]!.replace(/,/g, ''));
    const days = /last\s+(\d+)\s+days|(\d+)\s+दिन/.exec(q);
    if (days && best.params.some((p) => p.name === 'days')) input.days = Number(days[1] ?? days[2]);
    else if (
      /this week|is hafte|is week|इस सप्ताह/.test(q) &&
      best.params.some((p) => p.name === 'days')
    )
      input.days = 7;
    const qm = /(?:find|about|of)\s+([a-z]+ [a-z]+)/.exec(q);
    if (best.id === 'find_student' && qm) input.q = qm[1];
    return { toolCalls: [{ id: `t-${best.id}`, name: best.id, input }] };
  };
}

/**
 * Sprint 14 (AI track): the staff assistant. Questions go through packages/ai (redaction, budget, audit)
 * with the catalogue entries the caller may run as tools; each tool runs its SQL inside the caller's tenant
 * transaction, so RBAC and RLS apply exactly as in the screens. Conversations and turns are stored (redacted)
 * so the page can show history and an auditor can read what was asked.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private readonly provider: AiProvider;
  private readonly budget: BudgetMeter;
  private readonly redis: Redis;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DbService,
    private readonly viewer: ViewerService,
  ) {
    this.provider = providerFromEnv({
      AI_PROVIDER: env.AI_PROVIDER,
      AI_MODEL: env.AI_MODEL,
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
      ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
      NODE_ENV: env.NODE_ENV,
    });
    this.redis = new IORedis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    void this.redis.connect().catch(() => undefined);
    this.budget = new BudgetMeter(new RedisBudgetStore(this.redis, this.logger), {
      perUserDailyTokens: env.AI_USER_DAILY_TOKENS,
      perSchoolMonthlyTokens: env.AI_SCHOOL_MONTHLY_TOKENS,
    });
  }

  private year(tenant: TenantContext): string {
    if (!tenant.academicYearId)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return tenant.academicYearId;
  }

  /**
   * Sprint 15: who is asking. Families get their children (student scope); teachers with section scopes get
   * those sections; everyone else is unrestricted staff and keeps the Sprint 14 catalogue.
   */
  private async scope(ctx: RequestContext): Promise<{
    kind: 'staff' | 'teacher' | 'family';
    sectionIds: string[] | null;
    studentIds: string[] | null;
  }> {
    const v = await this.viewer.resolve(ctx, 'insights.assistant.use');
    if (v.kind === 'family')
      return { kind: 'family', sectionIds: null, studentIds: v.students.map((s) => s.id) };
    if (v.sectionIds !== null)
      return { kind: 'teacher', sectionIds: v.sectionIds, studentIds: null };
    return { kind: 'staff', sectionIds: null, studentIds: null };
  }

  /** The catalogue entries the caller may run (permission `anyOf` and the caller's scope kind). */
  allowed(
    ctx: RequestContext,
    entries: CatalogueEntry[],
    kind: 'staff' | 'teacher' | 'family' = 'staff',
  ): CatalogueEntry[] {
    const p = ctx.permissions;
    if (!p) return [];
    const scopeOf = kind === 'family' ? 'student' : kind === 'teacher' ? 'section' : undefined;
    return entries.filter((e) => e.scope === scopeOf && e.anyOf.some((code) => p.has(code)));
  }

  async catalogue(ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const scope = await this.scope(ctx);
    const entries = buildCatalogue({ academicYearId: yearId, today, ...scope }).filter(
      (e) =>
        e.scope ===
        (scope.kind === 'family' ? 'student' : scope.kind === 'teacher' ? 'section' : undefined),
    );
    const allowed = new Set(this.allowed(ctx, entries, scope.kind).map((e) => e.id));
    return entries.map((e) => ({
      id: e.id,
      department: e.department,
      title: e.title,
      titleHi: e.titleHi,
      description: e.description,
      params: e.params,
      allowed: allowed.has(e.id),
    }));
  }

  async ask(ctx: RequestContext, dto: AskDto): Promise<AskResponse> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const scope = await this.scope(ctx);
    const entries = buildCatalogue({ academicYearId: yearId, today, ...scope });
    const mine = this.allowed(ctx, entries, scope.kind);
    const language = dto.language ?? detectLanguage(dto.question);
    // the surface follows the caller: families are parents, scoped teachers are teachers; unscoped staff
    // may say which staff app asked (admin or teacher) but can never pose as a parent
    const surface: 'admin' | 'teacher' | 'parent' =
      scope.kind === 'family'
        ? 'parent'
        : scope.kind === 'teacher' || dto.surface === 'teacher'
          ? 'teacher'
          : 'admin';
    if (scope.kind === 'family' && scope.studentIds!.length === 0)
      throw new DomainError('family.not_linked', 'No child is linked to this account', {
        status: 403,
      });
    return this.db.tenant(tenant, async (c) => {
      if (scope.kind === 'family') {
        // DPDP: the AI purpose is opt-in for families; the parent app links to the consent screen
        const consent = await c.query<{ status: string | null }>(
          `SELECT app.consent_status(app.current_user_id(), 'ai.assistant')::text AS status`,
        );
        if (consent.rows[0]?.status !== 'granted')
          throw new DomainError(
            'consent-required',
            'Turn on the AI assistant consent in your profile to ask questions',
            { status: 403, extra: { purpose: 'ai.assistant' } },
          );
      }
      const conversationId = await this.openConversation(c, dto.conversationId, language, surface);
      const history = await this.history(c, conversationId);
      const citations: Citation[] = [];
      const tools: AssistantTool[] = mine.map((e) => ({
        name: e.id,
        description: `${e.title}. ${e.description}`,
        inputSchema: {
          type: 'object',
          properties: Object.fromEntries(
            e.params.map((p) => [
              p.name,
              {
                type:
                  p.type === 'days' || p.type === 'limit' || p.type === 'amount'
                    ? 'number'
                    : 'string',
                description: p.description,
              },
            ]),
          ),
          required: e.params.filter((p) => p.required).map((p) => p.name),
        },
        run: async (input) => {
          const out = await runEntry(c, e, input);
          citations.push({
            query: e.id,
            title: language === 'hi' ? e.titleHi : e.title,
            params: input,
            rows: out.rows.length,
          });
          return out;
        },
      }));
      let provider = this.provider;
      if (provider.name === 'mock') {
        const classes = await c.query<{ id: string; code: string }>(
          `SELECT id::text, code FROM classes WHERE deleted_at IS NULL`,
        );
        provider = new MockProvider(catalogueMockResponder(mine, classes.rows));
      }
      const assistant = new Assistant({ provider, budget: this.budget, audit: new DbAuditSink(c) });
      const suggestions = this.nearest(dto.question, mine).map((e) => ({
        id: e.id,
        title: language === 'hi' ? e.titleHi : e.title,
      }));
      let result;
      try {
        result = await assistant.ask({
          caller: { schoolId: tenant.schoolId, userId: ctx.user.id, requestId: ctx.requestId },
          question: dto.question,
          system:
            surface === 'parent' ? SYSTEM_PARENT : surface === 'teacher' ? SYSTEM_TEACHER : SYSTEM,
          history,
          tools,
          conversationId,
          language,
        });
      } catch (error) {
        if (error instanceof BudgetExceededError)
          throw new DomainError('ai.budget_exceeded', error.message, {
            status: 429,
            extra: { reason: error.check.reason },
          });
        throw error;
      }
      let answer = result.answer;
      if (result.refused && suggestions.length) {
        answer +=
          language === 'hi'
            ? `\nनिकटतम प्रश्न: ${suggestions.map((s) => s.title).join('; ')}`
            : `\nNearest catalogue queries: ${suggestions.map((s) => s.title).join('; ')}`;
      }
      await c.query(
        `INSERT INTO ai_messages (school_id, conversation_id, role, content) VALUES (app.current_school_id(), $1, 'user', $2)`,
        [conversationId, dto.question.slice(0, 4000)],
      );
      await c.query(
        `INSERT INTO ai_messages (school_id, conversation_id, role, content, refused, citations, usage) VALUES (app.current_school_id(), $1, 'assistant', $2, $3, $4::jsonb, $5::jsonb)`,
        [
          conversationId,
          answer.slice(0, 8000),
          result.refused,
          JSON.stringify(citations),
          JSON.stringify(result.usage),
        ],
      );
      await c.query(
        `UPDATE ai_conversations SET turns = turns + 1, tokens = tokens + $2, cost_paise = cost_paise + $3, title = COALESCE(title, $4), updated_at = now() WHERE id = $1`,
        [
          conversationId,
          result.usage.inputTokens + result.usage.outputTokens,
          result.costPaise,
          dto.question.slice(0, 80),
        ],
      );
      return {
        conversationId,
        answer,
        refused: result.refused,
        citations,
        suggestions: result.refused ? suggestions : [],
        usage: result.usage,
        costPaise: result.costPaise,
        provider: result.provider,
        model: result.model,
      };
    });
  }

  private nearest(question: string, entries: CatalogueEntry[]): CatalogueEntry[] {
    const q = question.toLowerCase();
    return entries
      .map((e) => ({ e, hits: e.keywords.filter((k) => q.includes(k.toLowerCase())).length }))
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 3)
      .map((x) => x.e);
  }

  private async openConversation(
    c: PoolClient,
    id: string | undefined,
    language: string,
    surface: 'admin' | 'teacher' | 'parent' = 'admin',
  ): Promise<string> {
    if (id) {
      const r = await c.query(
        `SELECT 1 FROM ai_conversations WHERE id = $1 AND user_id = app.current_user_id()`,
        [id],
      );
      if (r.rowCount) return id;
    }
    const fresh = randomUUID();
    await c.query(
      `INSERT INTO ai_conversations (id, school_id, user_id, academic_year_id, surface, language)
       VALUES ($1, app.current_school_id(), app.current_user_id(), NULLIF(current_setting('app.academic_year_id', true), '')::bigint, $3, $2)`,
      [fresh, language, surface],
    );
    return fresh;
  }

  private async history(c: PoolClient, conversationId: string): Promise<Message[]> {
    const r = await c.query<{ role: 'user' | 'assistant'; content: string }>(
      `SELECT role, content FROM ai_messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT 10`,
      [conversationId],
    );
    return r.rows.reverse().map((m) => ({ role: m.role, content: m.content }));
  }

  async conversations(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `SELECT id, title, language, surface, turns, tokens, cost_paise AS "costPaise", updated_at AS "updatedAt" FROM ai_conversations WHERE user_id = app.current_user_id() ORDER BY updated_at DESC LIMIT 30`,
      );
      return r.rows;
    });
  }

  async conversation(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const conv = await c.query(
        `SELECT id, title, language, turns, tokens, cost_paise AS "costPaise", updated_at AS "updatedAt" FROM ai_conversations WHERE id = $1 AND user_id = app.current_user_id()`,
        [id],
      );
      if (!conv.rows[0])
        throw new DomainError('not-found', 'Conversation not found', { status: 404 });
      const msgs = await c.query(
        `SELECT id::text, role, content, refused, citations, usage, created_at AS "createdAt" FROM ai_messages WHERE conversation_id = $1 ORDER BY id`,
        [id],
      );
      return { ...conv.rows[0], messages: msgs.rows };
    });
  }

  /** Audit and cost for the school (permission insights.assistant.audit). */
  /** Sprint 16: the cost dashboard — spend and tokens by day, surface, user and model, with refusal rate. */
  async costs(ctx: RequestContext, days = 30) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const byDay = await c.query(
        `SELECT (at AT TIME ZONE 'Asia/Kolkata')::date::text AS day, count(*) FILTER (WHERE kind = 'prompt')::int AS prompts,
                count(*) FILTER (WHERE kind = 'refusal')::int AS refusals, COALESCE(sum(input_tokens), 0)::bigint AS input_tokens,
                COALESCE(sum(output_tokens), 0)::bigint AS output_tokens, COALESCE(sum(cost_paise), 0)::bigint AS cost_paise
           FROM ai_audit WHERE at >= now() - make_interval(days => $1) GROUP BY 1 ORDER BY 1`,
        [days],
      );
      const bySurface = await c.query(
        `SELECT COALESCE(cv.surface, 'admin') AS surface, count(*) FILTER (WHERE a.kind = 'prompt')::int AS prompts,
                count(*) FILTER (WHERE a.kind = 'refusal')::int AS refusals, COALESCE(sum(a.cost_paise), 0)::bigint AS cost_paise,
                count(DISTINCT a.user_id)::int AS users
           FROM ai_audit a LEFT JOIN ai_conversations cv ON cv.id = a.conversation_id
          WHERE a.at >= now() - make_interval(days => $1) GROUP BY 1 ORDER BY 3 DESC`,
        [days],
      );
      const byUser = await c.query(
        `SELECT u.display_name AS "user", count(*) FILTER (WHERE a.kind = 'prompt')::int AS prompts, COALESCE(sum(a.cost_paise), 0)::bigint AS cost_paise,
                COALESCE(sum(a.input_tokens + a.output_tokens), 0)::bigint AS tokens
           FROM ai_audit a LEFT JOIN users u ON u.id = a.user_id WHERE a.at >= now() - make_interval(days => $1)
          GROUP BY 1 ORDER BY 3 DESC, 2 DESC LIMIT 10`,
        [days],
      );
      const byModel = await c.query(
        `SELECT provider, model, count(*) FILTER (WHERE kind = 'prompt')::int AS prompts, COALESCE(sum(cost_paise), 0)::bigint AS cost_paise
           FROM ai_audit WHERE at >= now() - make_interval(days => $1) GROUP BY 1, 2 ORDER BY 4 DESC`,
        [days],
      );
      const reports = await c.query(
        `SELECT count(*)::int AS reports, COALESCE(sum(cost_paise), 0)::bigint AS cost_paise FROM ai_reports WHERE created_at >= now() - make_interval(days => $1)`,
        [days],
      );
      const n = (v: unknown) => Number(v ?? 0);
      const totals = byDay.rows.reduce(
        (a, r) => ({
          prompts: a.prompts + n(r.prompts),
          refusals: a.refusals + n(r.refusals),
          inputTokens: a.inputTokens + n(r.input_tokens),
          outputTokens: a.outputTokens + n(r.output_tokens),
          costPaise: a.costPaise + n(r.cost_paise),
        }),
        { prompts: 0, refusals: 0, inputTokens: 0, outputTokens: 0, costPaise: 0 },
      );
      return {
        days,
        budget: {
          perUserDailyTokens: this.env.AI_USER_DAILY_TOKENS,
          perSchoolMonthlyTokens: this.env.AI_SCHOOL_MONTHLY_TOKENS,
        },
        totals: {
          ...totals,
          refusalRatePct: totals.prompts
            ? Math.round((totals.refusals * 1000) / totals.prompts) / 10
            : null,
        },
        reports: { count: n(reports.rows[0]?.reports), costPaise: n(reports.rows[0]?.cost_paise) },
        byDay: byDay.rows.map((r) => ({
          day: r.day,
          prompts: n(r.prompts),
          refusals: n(r.refusals),
          inputTokens: n(r.input_tokens),
          outputTokens: n(r.output_tokens),
          costPaise: n(r.cost_paise),
        })),
        bySurface: bySurface.rows.map((r) => ({
          surface: r.surface,
          prompts: n(r.prompts),
          refusals: n(r.refusals),
          costPaise: n(r.cost_paise),
          users: n(r.users),
        })),
        byUser: byUser.rows.map((r) => ({
          user: r.user,
          prompts: n(r.prompts),
          costPaise: n(r.cost_paise),
          tokens: n(r.tokens),
        })),
        byModel: byModel.rows.map((r) => ({
          provider: r.provider,
          model: r.model,
          prompts: n(r.prompts),
          costPaise: n(r.cost_paise),
        })),
      };
    });
  }

  async audit(ctx: RequestContext, days = 30) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const totals = await c.query(
        `SELECT count(*) FILTER (WHERE kind = 'prompt')::int AS prompts, count(*) FILTER (WHERE kind = 'refusal')::int AS refusals, count(*) FILTER (WHERE kind = 'tool')::int AS tool_calls,
                COALESCE(sum(input_tokens), 0)::bigint AS input_tokens, COALESCE(sum(output_tokens), 0)::bigint AS output_tokens, COALESCE(sum(cost_paise), 0)::bigint AS cost_paise,
                count(DISTINCT user_id)::int AS users
           FROM ai_audit WHERE at >= now() - ($1::int || ' days')::interval`,
        [days],
      );
      const recent = await c.query(
        `SELECT a.id::text, a.at, a.kind, u.display_name AS "user", a.text, a.redactions, a.citations, a.cost_paise AS "costPaise" FROM ai_audit a LEFT JOIN users u ON u.id = a.user_id
          WHERE a.at >= now() - ($1::int || ' days')::interval ORDER BY a.at DESC LIMIT 100`,
        [days],
      );
      return {
        days,
        totals: totals.rows[0],
        recent: recent.rows,
        provider: this.provider.name,
        model: this.provider.model,
      };
    });
  }
}
