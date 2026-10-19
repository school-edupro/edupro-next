/**
 * The per-minute limit from app.setup.ts (@fastify/rate-limit) throws a plain Error with statusCode 429
 * from an onRequest hook, outside any Nest HttpException. The problem-details filter must answer
 * 429 rate-limited with retry-after, and must not log it as an internal error.
 */
import rateLimit from '@fastify/rate-limit';
import { Controller, Get, Logger } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ProblemDetailsFilter } from '../src/common/errors/problem-details.filter';

@Controller('ping')
class PingController {
  @Get()
  ping(): { ok: boolean } {
    return { ok: true };
  }
}

describe('rate limit (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [PingController] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.register(rateLimit, { max: 1, timeWindow: '1 minute' });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers the request over the limit with 429 rate-limited and retry-after, not a 500', async () => {
    const fastify = app.getHttpAdapter().getInstance();
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const first = await fastify.inject({ method: 'GET', url: '/api/v1/ping' });
      expect(first.statusCode).toBe(200);

      const second = await fastify.inject({ method: 'GET', url: '/api/v1/ping' });
      expect(second.statusCode).toBe(429);
      expect(second.headers['content-type']).toContain('application/problem+json');
      expect(Number(second.headers['retry-after'])).toBeGreaterThan(0);
      expect(second.json()).toMatchObject({
        type: 'rate-limited',
        status: 429,
        instance: '/api/v1/ping',
        retryAfter: Number(second.headers['retry-after']),
      });
      expect(errorLog).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  });
});
