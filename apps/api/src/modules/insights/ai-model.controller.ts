import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { PLATFORM } from '../platform/platform.permissions';
import { AiModelService } from './ai-model.service';

const SaveSchema = z.object({
  url: z.string().trim().min(8).max(500),
  /** empty or missing: keep the saved token */
  token: z.string().max(4000).nullish(),
  /** where the answer sits in the reply, e.g. data.reply or choices[0].text; empty: found automatically */
  replyField: z
    .string()
    .trim()
    .max(120)
    .regex(/^$|^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+|\[[0-9]{1,3}\])*$/, {
      message: 'A field such as response, data.reply or choices[0].text',
    })
    .nullish(),
  timeoutSeconds: z.coerce.number().int().min(5).max(120).default(30),
  on: z.boolean(),
});
class AiModelSaveDto extends createZodDto(SaveSchema) {}

const TestSchema = z.object({ prompt: z.string().trim().min(1).max(4000) });
class AiModelTestDto extends createZodDto(TestSchema) {}

/** docs/design/101: the LLM of our own, one for all schools — its settings and a test. */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform/ai-model')
export class AiModelController {
  constructor(private readonly model: AiModelService) {}

  @Get()
  @ApiOperation({
    summary:
      'The AI model (LLM) for all schools: its settings for holders of the right (never the token), else whether one is set up',
  })
  @RequirePermission(PLATFORM.settingsView)
  view(@ReqCtx() ctx: RequestContext) {
    return this.model.view(ctx);
  }

  @Put()
  @ApiOperation({
    summary:
      'Save the AI model for all schools: address, token (empty keeps it), reply field, time limit, on',
  })
  @RequirePermission(PLATFORM.aiModelManage, {
    description: 'Set the AI model (LLM) every school uses: its address, token and test',
  })
  save(@ReqCtx() ctx: RequestContext, @Body() body: AiModelSaveDto) {
    return this.model.save(ctx, body);
  }

  @Post('test')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send one prompt to the saved AI model and show what came back' })
  @RequirePermission(PLATFORM.aiModelManage)
  test(@ReqCtx() ctx: RequestContext, @Body() body: AiModelTestDto) {
    return this.model.test(ctx, body.prompt);
  }
}
