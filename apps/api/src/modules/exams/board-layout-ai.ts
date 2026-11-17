import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import {
  estimateCostPaise,
  structuredFromEnv,
  StructuredProviderError,
  type StructuredProvider,
  type Usage,
} from '@edupro/ai';
import { DomainError } from '../../common/errors/domain-error';
import { ENV, type Env } from '../../config/env';
import {
  LAYOUT_JSON_SCHEMA,
  LayoutZ,
  layoutProblems,
  maskedSample,
  ruler,
  type BoardClass,
  type GazetteLayout,
  type GazetteProblem,
} from './board-gazette';

export interface LearnedLayout {
  layout: GazetteLayout;
  notes: string;
  model: string;
  provider: string;
  usage: Usage;
  masked: number;
}

const SYSTEM = `You read the layout of fixed-width result files ("gazettes") that the Central Board of Secondary Education (CBSE) sends to schools in India. In what you are shown, names, roll numbers and marks are masked — letters replaced by X and digits by 9 — but every character keeps its column. Describe where each field sits so that a program can read every candidate of the full file. Columns are 0-based. Reply only with the JSON the schema asks for.`;

/**
 * Claude learns a new gazette layout (docs/design/88, decision 1): it sees the column headings and a few sample
 * records with names, roll numbers and marks masked, never a student's data. The reply is structured output,
 * checked again with our own schema; the school's monthly AI token budget applies and every call is recorded in
 * ai_audit (no student data in it). Tests replace `provider()`.
 */
@Injectable()
export class BoardLayoutAi {
  constructor(@Inject(ENV) private readonly env: Env) {}

  /** The provider the server is set up with, or null (AI_PROVIDER=mock / no key): known layouts only. */
  provider(): StructuredProvider | null {
    return structuredFromEnv(this.env);
  }

  /** The prompt for a file (also what a test checks: no name, roll number or mark in it). */
  prompt(text: string, classLabel: BoardClass, failed: GazetteProblem[] = []) {
    const sample = maskedSample(text);
    const retry = failed.length
      ? `\n\nA layout given earlier for this file failed on the full file. The checks that failed (field — what):\n${[
          ...new Set(failed.map((p) => `${p.field} — ${p.message.replace(/"[^"]*"/g, 'a value')}`)),
        ]
          .slice(0, 15)
          .join('\n')}\nCorrect the layout.`
      : '';
    const prompt = `Class ${classLabel} result file. First a column ruler (the tens digit above the units digit), then the file's page heading, then sample candidate records.

For every candidate record give the line (0 = the record's first line), start column and width of: roll number, the one-letter flag column (FL), sex, name, and for EVERY subject slot the file has room for (left to right, even when a sample leaves a slot empty) the subject code, its marks and its grade; the internal-subject grades if the file has them (e.g. GR1 GR2 GR3); the result word; the compartment subject column. Use width 0 for a field the file does not have.

Notes:
- The data can sit a character or two to the right of its heading: take start columns from the sample records, not from the headings.
- A subject's code is on one line of the record and its marks and grade on a later line, under the code.
- Codes and marks are 3 wide, grades 2; the name runs to the column before the first subject code; the result runs to the next field; the compartment field to the end of the line.
- Marks may read AB for an absent candidate, and a record's marks line can be blank.
- recordStart is a JavaScript regular expression that matches the first line of every candidate's record and no other line (for example a line that begins with the 8-digit roll number).${retry}

<ruler>
${ruler(sample.width)}
</ruler>
<file>
${sample.text}
</file>`;
    return { prompt, masked: sample.masked };
  }

  /** Learns the layout: budget check, the call, validation, audit. */
  async learn(
    c: PoolClient,
    text: string,
    classLabel: BoardClass,
    failed: GazetteProblem[] = [],
  ): Promise<LearnedLayout> {
    const provider = this.provider();
    if (!provider)
      throw new DomainError(
        'board.ai_not_set_up',
        "This file's layout is new and the AI reader is not set up on the server (AI_PROVIDER=claude and ANTHROPIC_API_KEY): ask IT to set it up, then upload again",
        { status: 409 },
      );
    const spent = await c.query<{ n: string }>(
      `SELECT COALESCE(sum(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0)::text AS n
         FROM ai_audit WHERE school_id = app.current_school_id() AND at >= date_trunc('month', now())`,
    );
    if (Number(spent.rows[0]?.n ?? 0) >= this.env.AI_SCHOOL_MONTHLY_TOKENS)
      throw new DomainError(
        'ai.budget_exceeded',
        "The school's monthly AI budget is used up; known layouts still work",
        { status: 429 },
      );
    const { prompt, masked } = this.prompt(text, classLabel, failed);
    let out;
    try {
      out = await provider.structured({
        system: SYSTEM,
        prompt,
        schema: LAYOUT_JSON_SCHEMA,
        maxTokens: 16_000,
        effort: 'high',
      });
    } catch (error) {
      await this.audit(
        c,
        provider.name,
        provider.model,
        'board_layout_error',
        'Board layout: the call failed',
        masked,
      );
      throw new DomainError(
        'board.ai_failed',
        `The AI reader could not be reached just now${error instanceof StructuredProviderError && error.status ? ` (${String(error.status)})` : ''}; try again`,
        { status: 503 },
      );
    }
    const record = (kind: string, note: string) =>
      this.audit(c, out.provider, out.model, kind, note, masked, out.usage);
    if (out.refused || out.json === null) {
      await record('board_layout_refused', `Board layout (Class ${classLabel}): no layout given`);
      throw new DomainError(
        'board.ai_no_layout',
        'The AI reader could not describe this layout; send the file to EduPro support',
        { status: 422 },
      );
    }
    const parsed = LayoutZ.safeParse(out.json);
    const layout = parsed.success
      ? ({ ...parsed.data, notes: undefined } as GazetteLayout & { notes?: string })
      : null;
    const wrong = layout ? layoutProblems(layout) : ['the reply did not match the layout schema'];
    await record(
      wrong.length ? 'board_layout_error' : 'board_layout',
      `Board layout (Class ${classLabel}): ${wrong.length ? `not usable — ${wrong.join('; ')}` : `${String(layout!.subjects.length)} subject slots, ${String(layout!.linesPerRecord)} lines a candidate`}`,
    );
    if (!layout || wrong.length)
      throw new DomainError(
        'board.ai_bad_layout',
        `The AI reader's layout is not usable (${wrong.slice(0, 3).join('; ')}); try again`,
        { status: 422 },
      );
    delete layout.notes;
    return {
      layout,
      notes: parsed.success ? (parsed.data.notes ?? '') : '',
      model: out.model,
      provider: out.provider,
      usage: out.usage,
      masked,
    };
  }

  private async audit(
    c: PoolClient,
    provider: string,
    model: string,
    kind: string,
    text: string,
    masked: number,
    usage?: Usage,
  ) {
    await c.query(
      `INSERT INTO ai_audit (school_id, user_id, request_id, kind, provider, model, text, redactions, input_tokens, output_tokens, cost_paise, at)
       VALUES (app.current_school_id(), app.current_user_id(), app.current_request_id(), $1, $2, $3, $4, $5, $6, $7, $8, now())`,
      [
        kind,
        provider,
        model,
        text,
        masked,
        usage?.inputTokens ?? null,
        usage?.outputTokens ?? null,
        usage ? estimateCostPaise(model, usage) : null,
      ],
    );
  }
}
