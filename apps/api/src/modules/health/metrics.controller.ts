import { Controller, Get, Inject, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../../common/auth/decorators';
import { MetricsService } from '../../common/metrics/metrics.service';
import { ENV, type Env } from '../../config/env';

/** Prometheus scrape endpoint. Public for the scraper but guarded by METRICS_TOKEN (required in production). */
@ApiTags('health')
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Prometheus metrics' })
  async metricsText(@Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    if (this.env.METRICS_TOKEN) {
      const header = req.headers.authorization ?? '';
      if (header !== `Bearer ${this.env.METRICS_TOKEN}`)
        throw new UnauthorizedException({
          type: 'unauthenticated',
          detail: 'metrics token required',
        });
    }
    void reply
      .header('content-type', this.metrics.registry.contentType)
      .send(await this.metrics.render());
  }
}
