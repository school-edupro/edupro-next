import { createHmac, createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CacheService } from '../../../common/cache/cache.service';
import { DomainError } from '../../../common/errors/domain-error';
import { ENV, type Env } from '../../../config/env';

/**
 * Proof-of-work challenge (S8-01), the CAPTCHA alternative: the browser must find a nonce so that
 * sha256(challenge:nonce) starts with `difficulty` hex zeros before it may request an OTP. Challenges are
 * HMAC-signed, expire after ten minutes and are accepted once.
 */
@Injectable()
export class PowService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly cache: CacheService,
  ) {}

  get difficulty(): number {
    return this.env.PUBLIC_POW_DIFFICULTY;
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.env.APPLICANT_JWT_SECRET).update(payload).digest('base64url');
  }

  issue(): { challenge: string; difficulty: number; expiresAt: string } {
    const exp = Date.now() + 10 * 60_000;
    const payload = Buffer.from(
      JSON.stringify({ exp, r: randomBytes(12).toString('base64url'), d: this.difficulty }),
    ).toString('base64url');
    return {
      challenge: `${payload}.${this.sign(payload)}`,
      difficulty: this.difficulty,
      expiresAt: new Date(exp).toISOString(),
    };
  }

  async consume(challenge: string, nonce: string): Promise<void> {
    const [payload, mac] = challenge.split('.');
    if (!payload || !mac || this.sign(payload) !== mac)
      throw new DomainError('pow.invalid', 'The challenge is not valid', { status: 400 });
    let parsed: { exp: number; d: number };
    try {
      parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
        exp: number;
        d: number;
      };
    } catch {
      throw new DomainError('pow.invalid', 'The challenge is not valid', { status: 400 });
    }
    if (parsed.exp < Date.now())
      throw new DomainError('pow.expired', 'The challenge has expired; request a new one', {
        status: 400,
      });
    const digest = createHash('sha256').update(`${challenge}:${nonce}`).digest('hex');
    if (!digest.startsWith('0'.repeat(parsed.d)))
      throw new DomainError('pow.unsolved', 'The proof of work does not match the challenge', {
        status: 400,
      });
    const used = await this.cache.incr(
      `pow:${createHash('sha256').update(challenge).digest('hex').slice(0, 32)}`,
      600,
    );
    if (used > 1)
      throw new DomainError('pow.reused', 'The challenge was already used', { status: 400 });
  }

  /** Test helper: solves a challenge the slow way (small difficulties only). */
  static solve(challenge: string, difficulty: number): string {
    for (let n = 0; n < 5_000_000; n += 1) {
      const nonce = String(n);
      if (
        createHash('sha256')
          .update(`${challenge}:${nonce}`)
          .digest('hex')
          .startsWith('0'.repeat(difficulty))
      )
        return nonce;
    }
    throw new Error('no nonce found');
  }
}
