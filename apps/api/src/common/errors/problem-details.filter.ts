import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ZodValidationException } from 'nestjs-zod';
import type { ZodError } from 'zod';
import type { ContextualRequest } from '../http/request-context';
import { DomainError } from './domain-error';

interface PgError extends Error {
  code?: string;
  detail?: string;
  constraint?: string;
}

interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  requestId?: string;
  errors?: unknown;
  [key: string]: unknown;
}

/**
 * Every error leaves the API as application/problem+json with a stable `type` slug (design section 10).
 * PostgreSQL errors from procedures use MESSAGE as the slug and DETAIL as JSON (ADR-006).
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const req = http.getRequest<ContextualRequest>();
    const problem = this.toProblem(exception);
    problem.instance = req.url;
    if (req.ctx?.requestId) problem.requestId = req.ctx.requestId;

    if (problem.status >= 500) {
      this.logger.error(`${problem.type} on ${req.method} ${req.url}: ${String(exception)}`);
    }

    void reply
      .status(problem.status)
      .header('content-type', 'application/problem+json')
      .send(problem);
  }

  private toProblem(exception: unknown): ProblemDetails {
    if (exception instanceof ZodValidationException) {
      // nestjs-zod v5 types this as unknown because it supports zod 3 and 4; this project uses zod 3.
      const zodError = exception.getZodError() as ZodError;
      return {
        type: 'validation-failed',
        title: 'Validation failed',
        status: HttpStatus.BAD_REQUEST,
        errors: zodError.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
          code: i.code,
        })),
      };
    }

    if (exception instanceof DomainError) {
      return {
        type: exception.type,
        title: exception.type.replace(/[-_.]/g, ' '),
        status: exception.status,
        detail: exception.message,
        ...(exception.extra ?? {}),
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null && 'type' in body) {
        const b = body as Record<string, unknown>;
        return { title: String(b.type).replace(/[-_.]/g, ' '), status, ...b, type: String(b.type) };
      }
      return {
        type: this.defaultType(status),
        title: typeof body === 'string' ? body : exception.message,
        status,
        detail:
          typeof body === 'object' && body !== null
            ? (body as { message?: string }).message
            : undefined,
      };
    }

    const pg = exception as PgError;
    if (pg && typeof pg.code === 'string') {
      switch (pg.code) {
        case '42501':
          return {
            type: 'tenant-forbidden',
            title: 'Forbidden',
            status: 403,
            detail: 'Row-level security denied the operation',
          };
        case '23505':
          return {
            type: 'conflict',
            title: 'Conflict',
            status: 409,
            detail: `Duplicate value${pg.constraint ? ` (${pg.constraint})` : ''}`,
          };
        case '23503':
          return {
            type: 'reference-violation',
            title: 'Invalid reference',
            status: 409,
            detail: pg.detail,
          };
        case '23514':
          return {
            type: 'validation-failed',
            title: 'Validation failed',
            status: 400,
            detail: pg.detail ?? pg.message,
          };
        case '22P02': // invalid text representation, for example a non-numeric id in the path
        case '22007': // invalid datetime format
          return {
            type: 'validation-failed',
            title: 'Validation failed',
            status: 400,
            detail: 'A value has the wrong format',
          };
        case 'P0001':
        case 'P0002':
        case 'P0003': {
          let extra: unknown;
          try {
            extra = pg.detail ? JSON.parse(pg.detail) : undefined;
          } catch {
            extra = pg.detail;
          }
          return {
            type: pg.message,
            title: pg.message.replace(/[-_.]/g, ' '),
            status: pg.code === 'P0002' ? 404 : 409,
            detail: typeof extra === 'string' ? extra : undefined,
            ...(typeof extra === 'object' && extra !== null ? { context: extra } : {}),
          };
        }
        case '57014':
          return { type: 'timeout', title: 'Statement timeout', status: 504 };
        default:
          break;
      }
    }

    return {
      type: 'internal-error',
      title: 'Internal server error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
    };
  }

  private defaultType(status: number): string {
    switch (status) {
      case 400:
        return 'validation-failed';
      case 401:
        return 'unauthenticated';
      case 403:
        return 'permission-denied';
      case 404:
        return 'not-found';
      case 409:
        return 'conflict';
      case 429:
        return 'rate-limited';
      default:
        return status >= 500 ? 'internal-error' : 'request-error';
    }
  }
}
