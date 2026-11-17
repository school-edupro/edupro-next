import { createHash } from 'node:crypto';
import { HttpException, Inject, Injectable } from '@nestjs/common';
import { CacheService } from '../../common/cache/cache.service';
import { DomainError } from '../../common/errors/domain-error';
import { ENV, type Env } from '../../config/env';
import { PowService } from '../admissions/public/pow.service';

/** What the page needs to show the check: Google reCAPTCHA with its site key, or EduPro's own proof-of-work. */
export type HumanCheckConfig = { provider: 'recaptcha'; siteKey: string } | { provider: 'pow' };
/** What a visitor sends back: the reCAPTCHA answer, or a solved challenge. */
export interface HumanCheckAnswer {
  recaptcha?: string;
  challenge?: string;
  nonce?: string;
}

const SITEVERIFY = 'https://www.google.com/recaptcha/api/siteverify';
/** Searches that found nothing, a visitor: 5 in 15 minutes, then 15 minutes' rest. */
const VISITOR_MISSES = 5;
const VISITOR_WINDOW = 15 * 60;
/** Wrong dates for one certificate number: 5 an hour, then the number rests an hour (whether or not it exists). */
const NUMBER_MISSES = 5;
const NUMBER_WINDOW = 60 * 60;

const hash = (v: string) => createHash('sha256').update(v).digest('hex').slice(0, 32);

/**
 * The public certificate check is for people (17 Nov 2026): every search and every QR check passes a human check
 * first — Google reCAPTCHA v2 when the school's server has its keys, else EduPro's proof-of-work — and a visitor (or
 * a certificate number) that keeps finding nothing is made to wait.
 */
@Injectable()
export class HumanCheckService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly cache: CacheService,
    private readonly pow: PowService,
  ) {}

  config(): HumanCheckConfig {
    const site = this.env.RECAPTCHA_SITE_KEY?.trim();
    return site && this.env.RECAPTCHA_SECRET?.trim()
      ? { provider: 'recaptcha', siteKey: site }
      : { provider: 'pow' };
  }

  /** The answer checked: with Google (the secret and the visitor's address), or the challenge solved and unused. */
  async verify(answer: HumanCheckAnswer, ip: string): Promise<void> {
    const cfg = this.config();
    if (cfg.provider === 'pow') {
      if (!answer.challenge || !answer.nonce)
        throw new DomainError(
          'human-check.required',
          'The check that you are a person is missing',
          {
            status: 400,
          },
        );
      await this.pow.consume(answer.challenge, answer.nonce);
      return;
    }
    const token = answer.recaptcha?.trim();
    if (!token)
      throw new DomainError('human-check.required', 'Tick "I\'m not a robot" first', {
        status: 400,
      });
    let out: { success?: boolean; 'error-codes'?: string[] };
    try {
      const res = await fetch(SITEVERIFY, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: this.env.RECAPTCHA_SECRET!.trim(),
          response: token,
          remoteip: ip,
        }).toString(),
        signal: AbortSignal.timeout(5000),
      });
      out = (await res.json()) as typeof out;
    } catch {
      throw new DomainError(
        'human-check.unavailable',
        'The check that you are a person could not be done just now; try again',
        { status: 503 },
      );
    }
    if (!out.success)
      throw new DomainError(
        'human-check.failed',
        'The "I\'m not a robot" check did not pass (or was used already); tick it again',
        { status: 400, extra: { codes: out['error-codes'] ?? [] } },
      );
  }

  private visitorKey = (ip: string) => `verify:miss:ip:${hash(ip)}`;
  private numberKey = (school: string, number: string) =>
    `verify:miss:no:${hash(`${school.toLowerCase()}|${number.trim().toUpperCase()}`)}`;

  /** A visitor (or a number) that found nothing too often waits: 429 with how long. */
  async assertNotLocked(ip: string, school?: string, number?: string): Promise<void> {
    // a counter is kept under "edupro:<key>" (CacheService.incr); read it there
    const v = Number((await this.cache.get<number>(`edupro:${this.visitorKey(ip)}`)) ?? 0);
    if (v >= VISITOR_MISSES)
      throw new HttpException(
        {
          type: 'verify.locked',
          detail: 'Too many checks that found nothing: try again in 15 minutes',
        },
        429,
      );
    if (school && number) {
      const n = Number(
        (await this.cache.get<number>(`edupro:${this.numberKey(school, number)}`)) ?? 0,
      );
      if (n >= NUMBER_MISSES)
        throw new HttpException(
          {
            type: 'verify.number_locked',
            detail: 'Too many tries for this certificate number: try again in an hour',
          },
          429,
        );
    }
  }

  /** A check that found nothing: counted for the visitor (and, a search, for the number tried). */
  async missed(ip: string, school?: string, number?: string): Promise<void> {
    await this.cache.incr(this.visitorKey(ip), VISITOR_WINDOW);
    if (school && number) await this.cache.incr(this.numberKey(school, number), NUMBER_WINDOW);
  }
}
