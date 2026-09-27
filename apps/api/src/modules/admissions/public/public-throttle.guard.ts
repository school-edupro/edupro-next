import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { CacheService } from '../../../common/cache/cache.service';

export const PUBLIC_THROTTLE = 'edupro:public-throttle';
export interface ThrottleRule {
  limit: number;
  windowSeconds: number;
}

/** Per-IP window for anonymous endpoints (S8-01), on top of the global Fastify limiter. */
export const PublicThrottle = (limit: number, windowSeconds = 60) =>
  SetMetadata(PUBLIC_THROTTLE, { limit, windowSeconds } satisfies ThrottleRule);

@Injectable()
export class PublicThrottleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cache: CacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.get<ThrottleRule | undefined>(
      PUBLIC_THROTTLE,
      context.getHandler(),
    );
    if (!rule) return true;
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const route = `${context.getClass().name}.${context.getHandler().name}`;
    const n = await this.cache.incr(`throttle:${route}:${req.ip}`, rule.windowSeconds);
    if (n > rule.limit)
      throw new HttpException(
        {
          type: 'rate-limited',
          detail: `Too many requests; try again in ${rule.windowSeconds} seconds`,
        },
        429,
      );
    return true;
  }
}
