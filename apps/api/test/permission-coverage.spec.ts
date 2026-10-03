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
    // The compatibility handshake exchanges the legacy central-auth token; it is signed, not anonymous (S4-05).
    // The public admissions surface (S8-01) authenticates applicants with OTP-issued tokens inside ApplicantGuard.
    // Gateway notifications verify a PayU signature; device ingestion verifies a per-device key (S9).
    // Delivery receipts carry a shared webhook token; punch devices use the device key (S10).
    // app_version answers the store build numbers before sign-in; it reads three public settings only (S20).
    // Razorpay returns verify the checkout HMAC and webhooks the raw-body HMAC; CCAvenue returns must decrypt
    // with the working key and match order id and amount (S13, docs/design/09 section 3).
    expect(publicRoutes.sort()).toEqual([
      'CommsDeliveryController.webhook (comms/delivery)',
      // communication v2: MSG91 (token) and Meta (signed with the school's app secret) delivery receipts
      'CommsWebhooksController.meta (comms/webhooks)',
      'CommsWebhooksController.metaVerify (comms/webhooks)',
      'CommsWebhooksController.msg91 (comms/webhooks)',
      'CompatController.handshake (compat/v1)',
      'CompatParityController.appVersion (compat/v1)',
      'FilesController.localGet (platform/files)',
      'FilesController.localPut (platform/files)',
      'GpsController.ingest (transport/gps)',
      'HealthController.health (health)',
      'MetricsController.metricsText (metrics)',
      'PaymentsController.ccavenueReturned (payments)',
      'PaymentsController.mock (payments)',
      'PaymentsController.razorpayReturned (payments)',
      'PaymentsController.razorpayWebhook (payments)',
      'PaymentsController.returned (payments)',
      'PaymentsController.webhook (payments)',
      'PublicAdmissionsController.challenge (public/admissions)',
      'PublicAdmissionsController.createApplication (public/admissions)',
      'PublicAdmissionsController.cycles (public/admissions)',
      'PublicAdmissionsController.getApplication (public/admissions)',
      'PublicAdmissionsController.me (public/admissions)',
      'PublicAdmissionsController.myApplications (public/admissions)',
      'PublicAdmissionsController.requestOtp (public/admissions)',
      'PublicAdmissionsController.schools (public/admissions)',
      'PublicAdmissionsController.submitApplication (public/admissions)',
      'PublicAdmissionsController.updateApplication (public/admissions)',
      'PublicAdmissionsController.verifyOtp (public/admissions)',
      // appointments for outside visitors (0059): desks, slots and the pass are read-only and throttled;
      // booking, the visitor's own list and cancelling need the OTP-issued applicant token
      'PublicAppointmentsController.book (public/appointments)',
      'PublicAppointmentsController.cancel (public/appointments)',
      'PublicAppointmentsController.days (public/appointments)',
      'PublicAppointmentsController.info (public/appointments)',
      'PublicAppointmentsController.mine (public/appointments)',
      'PublicAppointmentsController.mineCard (public/appointments)',
      'PublicAppointmentsController.mineGet (public/appointments)',
      'PublicAppointmentsController.minePhoto (public/appointments)',
      'PublicAppointmentsController.pass (public/appointments)',
      'PublicAppointmentsController.passCard (public/appointments)',
      'PublicAppointmentsController.slots (public/appointments)',
      // walk-in visitors registering on their own phone (0065): the lists are read-only and throttled;
      // registering and the visitor's own entry need the OTP-issued applicant token
      'PublicVisitorsController.mine (public/visitors)',
      'PublicVisitorsController.options (public/visitors)',
      'PublicVisitorsController.register (public/visitors)',
      'PunchController.ingest (attendance/punch)',
      'RfidController.ingest (attendance/rfid)',
      'ShadowController.ingest (shadow)',
    ]);
    if (unprotected.length > 0) {
      throw new Error(`handlers without a permission: ${unprotected.join(', ')}`);
    }
    expect(unprotected).toEqual([]);
  });
});
