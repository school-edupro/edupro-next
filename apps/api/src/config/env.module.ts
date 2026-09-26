import { Global, Module } from '@nestjs/common';
import { ENV, loadEnv } from './env';

/** Validated environment, available to every module through the ENV token. */
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }],
  exports: [ENV],
})
export class EnvModule {}
