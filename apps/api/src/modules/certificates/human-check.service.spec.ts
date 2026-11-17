import { HumanCheckService } from './human-check.service';
import type { Env } from '../../config/env';
import type { CacheService } from '../../common/cache/cache.service';
import type { PowService } from '../admissions/public/pow.service';

/** The human check of the public certificate check (17 Nov 2026): reCAPTCHA with its keys, else proof-of-work. */
describe('HumanCheckService', () => {
  const counters = new Map<string, number>();
  const cache = {
    get: jest.fn((k: string) => Promise.resolve(counters.get(k) ?? null)),
    incr: jest.fn((k: string) => {
      const n = (counters.get(`edupro:${k}`) ?? 0) + 1;
      counters.set(`edupro:${k}`, n);
      return Promise.resolve(n);
    }),
  } as unknown as CacheService;
  const pow = { consume: jest.fn(() => Promise.resolve()) } as unknown as PowService;
  const make = (env: Partial<Env>) => new HumanCheckService(env as Env, cache, pow);
  const keys = { RECAPTCHA_SITE_KEY: 'site-key-123456', RECAPTCHA_SECRET: 'secret-key-123456' };
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    counters.clear();
    fetchSpy = jest.spyOn(global, 'fetch');
  });
  afterEach(() => fetchSpy.mockRestore());

  it('uses the proof-of-work without both keys, reCAPTCHA with them', () => {
    expect(make({}).config()).toEqual({ provider: 'pow' });
    expect(make({ RECAPTCHA_SITE_KEY: 'only-the-site-key' }).config()).toEqual({ provider: 'pow' });
    expect(make(keys).config()).toEqual({ provider: 'recaptcha', siteKey: 'site-key-123456' });
  });

  it('asks Google with the secret, the answer and the address; passes on success', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ success: true })));
    await make(keys).verify({ recaptcha: 'answer-token' }, '203.0.113.7');
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://www.google.com/recaptcha/api/siteverify');
    const body = new URLSearchParams(String(init.body));
    expect(Object.fromEntries(body)).toEqual({
      secret: 'secret-key-123456',
      response: 'answer-token',
      remoteip: '203.0.113.7',
    });
  });

  it('refuses no answer, a failed one, and says so when Google cannot be reached', async () => {
    await expect(make(keys).verify({}, '203.0.113.7')).rejects.toMatchObject({
      type: 'human-check.required',
    });
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, 'error-codes': ['timeout-or-duplicate'] })),
    );
    await expect(make(keys).verify({ recaptcha: 'old' }, '203.0.113.7')).rejects.toMatchObject({
      type: 'human-check.failed',
    });
    fetchSpy.mockRejectedValueOnce(new Error('offline'));
    await expect(make(keys).verify({ recaptcha: 'x' }, '203.0.113.7')).rejects.toMatchObject({
      type: 'human-check.unavailable',
    });
    // without keys a reCAPTCHA answer is not enough: the challenge is asked
    await expect(make({}).verify({ recaptcha: 'x' }, '203.0.113.7')).rejects.toMatchObject({
      type: 'human-check.required',
    });
  });

  it('makes a visitor wait after five checks that found nothing, and a number after five wrong dates', async () => {
    const h = make({});
    for (let i = 0; i < 5; i++) await h.missed('203.0.113.8');
    await expect(h.assertNotLocked('203.0.113.8')).rejects.toMatchObject({ status: 429 });
    await expect(h.assertNotLocked('203.0.113.9')).resolves.toBeUndefined();
    for (let i = 0; i < 5; i++) await h.missed(`198.51.100.${String(i)}`, 'alpha', 'tc/2026-27/1');
    await expect(
      h.assertNotLocked('198.51.100.99', 'ALPHA', ' TC/2026-27/1 '),
    ).rejects.toMatchObject({
      status: 429,
    });
  });
});
