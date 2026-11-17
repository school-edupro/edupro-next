import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { CertificateLegacyService } from './certificate-legacy.service';
import { CertificateSetupService } from './certificate-setup.service';
import {
  CERTIFICATE,
  CreateTemplateDto,
  CreateTypeDto,
  UseTemplateDto,
  LegacyBringDto,
  LegacyMapDto,
  SaveTemplateDto,
  SettingsDto,
  TemplatePreviewDto,
  UpdateRequestSettingsDto,
  UpdateTypeDto,
} from './certificates.dto';
import { CertificatesService } from './certificates.service';

/** Certificate set-up (docs/design/87, phase B): types, templates with versions and a live preview, who signs. */
@ApiTags('certificates')
@ApiBearerAuth()
@Controller('certificates/setup')
export class CertificateSetupController {
  constructor(
    private readonly setup: CertificateSetupService,
    private readonly certificates: CertificatesService,
    private readonly legacy: CertificateLegacyService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Certificate set-up: figures, what to look at, the types, the templates, who signs',
  })
  @RequirePermission(CERTIFICATE.setup, {
    description: 'Certificate types, their checks, templates and the TC book',
  })
  overview(@ReqCtx() ctx: RequestContext) {
    return this.setup.overview(ctx);
  }

  @Get('types/:code')
  @RequirePermission(CERTIFICATE.setup)
  type(@ReqCtx() ctx: RequestContext, @Param('code') code: string) {
    return this.setup.type(ctx, code);
  }

  @Put('types/:code')
  @ApiOperation({
    summary: "A type's name, prefix, layouts, checks, who issues it and its own fields",
  })
  @RequirePermission(CERTIFICATE.setup)
  updateType(
    @ReqCtx() ctx: RequestContext,
    @Param('code') code: string,
    @Body() body: UpdateTypeDto,
  ) {
    return this.setup.updateType(ctx, code, body);
  }

  @Put('types/:code/requests')
  @ApiOperation({
    summary: 'Who may ask for a type online, the purposes, copies, fee and approval levels',
  })
  @RequirePermission(CERTIFICATE.setup)
  requests(
    @ReqCtx() ctx: RequestContext,
    @Param('code') code: string,
    @Body() body: UpdateRequestSettingsDto,
  ) {
    return this.setup.saveRequestSettings(ctx, code, body);
  }

  @Post('types')
  @ApiOperation({ summary: "A type of the school's own" })
  @RequirePermission(CERTIFICATE.setup)
  createType(@ReqCtx() ctx: RequestContext, @Body() body: CreateTypeDto) {
    return this.setup.createType(ctx, body);
  }

  @Post('templates/preview')
  @ApiOperation({ summary: 'A template as it would print, while it is edited (nothing saved)' })
  @RequirePermission(CERTIFICATE.setup)
  preview(@ReqCtx() ctx: RequestContext, @Body() body: TemplatePreviewDto) {
    return this.certificates.templatePreview(ctx, body);
  }

  @Post('templates')
  @ApiOperation({ summary: 'A copy of a template' })
  @RequirePermission(CERTIFICATE.setup)
  copyTemplate(@ReqCtx() ctx: RequestContext, @Body() body: CreateTemplateDto) {
    return this.setup.copyTemplate(ctx, body);
  }

  @Post('templates/:id/use')
  @ApiOperation({
    summary: 'Give a layout to a type: the one it prints with, or one more to choose at issue',
  })
  @RequirePermission(CERTIFICATE.setup)
  useTemplate(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: UseTemplateDto,
  ) {
    return this.setup.useTemplate(ctx, id, body);
  }

  @Get('templates/:id')
  @ApiOperation({ summary: 'A template with its versions and the field list' })
  @RequirePermission(CERTIFICATE.setup)
  template(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Query('type') type?: string) {
    return this.setup.template(
      ctx,
      id,
      type && /^[A-Z][A-Z0-9_]{1,19}$/.test(type) ? type : undefined,
    );
  }

  @Put('templates/:id')
  @ApiOperation({
    summary: 'Save a template (a new version; certificates made before keep theirs)',
  })
  @RequirePermission(CERTIFICATE.setup)
  saveTemplate(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: SaveTemplateDto,
  ) {
    return this.setup.saveTemplate(ctx, id, body);
  }

  @Post('templates/:id/reset')
  @ApiOperation({ summary: "Back to EduPro's ready layout" })
  @RequirePermission(CERTIFICATE.setup)
  reset(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.setup.resetTemplate(ctx, id);
  }

  @Post('templates/:id/restore/:version')
  @ApiOperation({ summary: 'Use an earlier version again' })
  @RequirePermission(CERTIFICATE.setup)
  restore(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.setup.restoreTemplate(ctx, id, version);
  }

  @Get('settings')
  @RequirePermission(CERTIFICATE.setup)
  settings(@ReqCtx() ctx: RequestContext) {
    return this.setup.settings(ctx);
  }

  @Put('settings')
  @ApiOperation({ summary: 'Who signs certificates and what prints with them' })
  @RequirePermission(CERTIFICATE.setup)
  saveSettings(@ReqCtx() ctx: RequestContext, @Body() body: SettingsDto) {
    return this.setup.saveSettings(ctx, body);
  }

  // ---- from the old system (phase F) ----
  @Get('legacy')
  @ApiOperation({
    summary:
      'From the old system: the read, the old names and their types, what came, the count check',
  })
  @RequirePermission(CERTIFICATE.setup)
  legacyState(@ReqCtx() ctx: RequestContext) {
    return this.legacy.state(ctx);
  }

  @Post('legacy/read')
  @ApiOperation({ summary: "Ask the workers to read the old register (the server's connection)" })
  @RequirePermission(CERTIFICATE.setup)
  legacyRead(@ReqCtx() ctx: RequestContext) {
    return this.legacy.requestRead(ctx);
  }

  @Put('legacy/map')
  @RequirePermission(CERTIFICATE.setup)
  legacyMap(@ReqCtx() ctx: RequestContext, @Body() body: LegacyMapDto) {
    return this.legacy.saveMap(ctx, body.map);
  }

  @Post('legacy/bring')
  @ApiOperation({
    summary:
      'Bring the old certificates (a dry run counts only); continue each series and the TC book',
  })
  @RequirePermission(CERTIFICATE.setup)
  legacyBring(@ReqCtx() ctx: RequestContext, @Body() body: LegacyBringDto) {
    return this.legacy.bring(ctx, body.dryRun);
  }
}
