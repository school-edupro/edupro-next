import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { CertificateRequestsService } from './certificate-requests.service';
import {
  CERTIFICATE,
  CertificateRequestDto,
  DecideRequestDto,
  ListRequestsQueryDto,
  ReasonDto,
} from './certificates.dto';

/**
 * Certificate requests (docs/design/87, phase C). `mine/…` serves the parent, student and staff apps (whoever is
 * signed in: their children, themself); the rest serves the office and the approvers.
 */
@ApiTags('certificates')
@ApiBearerAuth()
@Controller('certificate-requests')
export class CertificateRequestsController {
  constructor(private readonly requests: CertificateRequestsService) {}

  @Get('mine')
  @ApiOperation({
    summary: 'What I may ask for, my people, my requests and the certificates issued to them',
  })
  @AuthenticatedOnly()
  mine(@ReqCtx() ctx: RequestContext) {
    return this.requests.myOverview(ctx);
  }

  @Post('mine')
  @ApiOperation({ summary: 'Ask for a certificate (for my child, or myself)' })
  @AuthenticatedOnly()
  ask(@ReqCtx() ctx: RequestContext, @Body() body: CertificateRequestDto) {
    return this.requests.ask(ctx, body);
  }

  @Post('mine/:id/withdraw')
  @ApiOperation({ summary: 'Withdraw my request before it is issued' })
  @AuthenticatedOnly()
  withdraw(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.requests.withdraw(ctx, id);
  }

  @Post('mine/certificates/:id/pdf')
  @ApiOperation({ summary: 'The PDF of one of my (or my child’s) certificates' })
  @AuthenticatedOnly()
  myPdf(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.requests.myPdf(ctx, id);
  }

  @Get('mine/exports/:id')
  @ApiOperation({ summary: 'Status and link of a PDF I asked for' })
  @AuthenticatedOnly()
  myExport(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.requests.myExport(ctx, id);
  }

  @Get()
  @ApiOperation({ summary: 'The request queue: filters, figures, ages, who it waits with' })
  @RequirePermission(CERTIFICATE.view)
  list(@ReqCtx() ctx: RequestContext, @Query() q: ListRequestsQueryDto) {
    return this.requests.list(ctx, q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One request (the office, or one of its approvers)' })
  @AuthenticatedOnly()
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.requests.get(ctx, id);
  }

  @Post(':id/decide')
  @ApiOperation({ summary: 'Approve or reject at the level I act at' })
  @AuthenticatedOnly()
  decide(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: DecideRequestDto) {
    return this.requests.decide(ctx, id, body);
  }

  @Post(':id/waive-fee')
  @ApiOperation({ summary: 'Take the fee off a request, with a reason' })
  @RequirePermission(CERTIFICATE.issue)
  waive(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ReasonDto) {
    return this.requests.waiveFee(ctx, id, body.reason);
  }

  @Post(':id/refuse')
  @ApiOperation({ summary: 'Turn down an approved request, with a reason' })
  @RequirePermission(CERTIFICATE.issue)
  refuse(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ReasonDto) {
    return this.requests.refuse(ctx, id, body.reason);
  }
}
