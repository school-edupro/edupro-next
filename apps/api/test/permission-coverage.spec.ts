/**
 * Deny-by-default proof (ADR-004 point 1): every route handler declares @RequirePermission(),
 * @AuthenticatedOnly() or @Public(). A handler with none fails this test and the build.
 */
import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { REQUIRE_PERMISSION } from '../src/common/access/require-permission.decorator';
import { AUTHENTICATED_ONLY, IS_PUBLIC } from '../src/common/auth/decorators';
import { AppModule } from '../src/app.module';

describe('permission coverage', () => {
  it('every handler is protected or explicitly public', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const discovery = moduleRef.get(DiscoveryService);
    const reflector = moduleRef.get(Reflector);

    const unprotected: string[] = [];
    const publicRoutes: string[] = [];

    for (const wrapper of discovery.getControllers()) {
      const instance = wrapper.instance as object | undefined;
      const metatype = wrapper.metatype as (new () => unknown) | undefined;
      if (!instance || !metatype) continue;
      const prototype = Object.getPrototypeOf(instance) as Record<string, unknown>;
      const controllerPath = Reflect.getMetadata(PATH_METADATA, metatype) as string | undefined;

      for (const name of Object.getOwnPropertyNames(prototype)) {
        if (name === 'constructor') continue;
        const handler = prototype[name];
        if (typeof handler !== 'function') continue;
        const fn = handler as (...args: unknown[]) => unknown;
        const method = Reflect.getMetadata(METHOD_METADATA, fn);
        if (method === undefined) continue; // not a route

        const route = `${metatype.name}.${name} (${controllerPath ?? ''})`;
        const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC, [fn, metatype]);
        const authOnly = reflector.getAllAndOverride<boolean>(AUTHENTICATED_ONLY, [fn, metatype]);
        const requirement = reflector.getAllAndOverride<unknown>(REQUIRE_PERMISSION, [
          fn,
          metatype,
        ]);

        if (isPublic) publicRoutes.push(route);
        else if (!authOnly && !requirement) unprotected.push(route);
      }
    }

    await moduleRef.close();

    // Public routes are an allow-list reviewed by security; extend deliberately.
    // The two local-driver file endpoints authenticate with HMAC tokens (docs/design/00 section 5, S2-08).
    expect(publicRoutes.sort()).toEqual([
      'FilesController.localGet (platform/files)',
      'FilesController.localPut (platform/files)',
      'HealthController.health (health)',
    ]);
    if (unprotected.length > 0) {
      throw new Error(`handlers without a permission: ${unprotected.join(', ')}`);
    }
    expect(unprotected).toEqual([]);
  });
});
