import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { Public } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { ApplicantGuard, type ApplicantRequest } from '../admissions/public/applicant.guard';
import { PublicThrottle, PublicThrottleGuard } from '../admissions/public/public-throttle.guard';
import {
  AdmitVisitorDto,
  ExitVisitorDto,
  ExportVisitorsDto,
  ListVisitorsDto,
  LookupDto,
  RegisterVisitorDto,
  SelfRegisterDto,
  VISITORS as P,
} from './visitors.dto';
import { VisitorsService } from './visitors.service';

/**
 * The visitor gate pass (0065): the gate registers walk-in visitors, lets in those who registered on
 * their own phone, records the exit and prints the card; the register lists everyone with Excel.
 */
@ApiTags('visitors')
@ApiBearerAuth()
@Controller('visitors')
export class VisitorsController {
  constructor(private readonly svc: VisitorsService) {}

  @Get()
  @RequirePermission(P.manage)
  @ApiOperation({ summary: 'The visitor register with filters, pages and counts' })
  list(@ReqCtx() ctx: RequestContext, @Query() q: ListVisitorsDto) {
    return this.svc.list(ctx, q);
  }

  @Get('options')
  @RequirePermission(P.manage)
  options(@ReqCtx() ctx: RequestContext) {
    return this.svc.options(ctx);
  }

  @Post('lookup')
  @HttpCode(200)
  @RequirePermission(P.manage)
  @ApiOperation({ summary: 'What a mobile number gave on its last visit' })
  lookup(@ReqCtx() ctx: RequestContext, @Body() dto: LookupDto) {
    return this.svc.lookup(ctx, dto.mobile);
  }

  @Get('report.xlsx')
  @RequirePermission(P.manage)
  async report(
    @ReqCtx() ctx: RequestContext,
    @Query() q: ExportVisitorsDto,
    @Res() reply: FastifyReply,
  ) {
    const { bytes, filename } = await this.svc.report(ctx, q);
    void reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .send(bytes);
  }

  @Post()
  @RequirePermission(P.manage)
  @ApiOperation({ summary: 'The gate registers a walk-in visitor and lets them in' })
  register(@ReqCtx() ctx: RequestContext, @Body() dto: RegisterVisitorDto) {
    return this.svc.register(ctx, dto);
  }

  @Get(':id')
  @RequirePermission(P.manage)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.get(ctx, id);
  }

  @Get(':id/photo')
  @RequirePermission(P.manage)
  async photo(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Res() reply: FastifyReply) {
    const { bytes, contentType } = await this.svc.photo(ctx, id);
    void reply
      .header('content-type', contentType)
      .header('cache-control', 'private, max-age=300')
      .send(bytes);
  }

  @Get(':id/card.pdf')
  @RequirePermission(P.manage)
  @ApiOperation({ summary: 'The visitor card as a PDF (ID-card size)' })
  async card(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Res() reply: FastifyReply) {
    const { bytes, filename } = await this.svc.cardPdf(ctx, id);
    void reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .send(bytes);
  }

  @Post(':id/admit')
  @HttpCode(200)
  @RequirePermission(P.manage)
  admit(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: AdmitVisitorDto) {
    return this.svc.admit(ctx, id, dto);
  }

  @Post(':id/refuse')
  @HttpCode(200)
  @RequirePermission(P.manage)
  refuse(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.refuse(ctx, id);
  }

  @Post(':id/exit')
  @HttpCode(200)
  @RequirePermission(P.manage)
  exit(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: ExitVisitorDto) {
    return this.svc.exit(ctx, id, dto);
  }
}

/**
 * Self-registration of a walk-in visitor from the gate QR (0065): the mobile is confirmed with the same
 * one-time code as the appointment page; the visitor then waits for the guard to let them in.
 */
@ApiTags('public')
@Controller('public/visitors')
@UseGuards(PublicThrottleGuard)
export class PublicVisitorsController {
  constructor(private readonly svc: VisitorsService) {}

  @Get(':schoolCode')
  @Public()
  @PublicThrottle(60)
  @ApiOperation({ summary: 'What a walk-in visitor chooses from when registering' })
  options(@Param('schoolCode') schoolCode: string) {
    return this.svc.publicOptions(schoolCode);
  }

  @Get(':schoolCode/mine')
  @Public()
  @UseGuards(ApplicantGuard)
  @PublicThrottle(60)
  mine(@Req() req: ApplicantRequest, @Param('schoolCode') schoolCode: string) {
    return this.svc.publicMine(schoolCode, req.applicant!);
  }

  @Post(':schoolCode')
  @Public()
  @UseGuards(ApplicantGuard)
  @PublicThrottle(10)
  @ApiOperation({ summary: 'An OTP-verified visitor registers and waits for the guard' })
  register(
    @Req() req: ApplicantRequest,
    @Param('schoolCode') schoolCode: string,
    @Body() dto: SelfRegisterDto,
  ) {
    return this.svc.publicRegister(schoolCode, req.applicant!, dto);
  }
}
