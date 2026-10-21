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
      // the consent form API for other systems (0170): a per-form `cfk_` key as Bearer, kept as a SHA-256 hash,
      // refused when unknown, revoked or expired, 60 calls a minute per key; decide needs the read_approve scope
      'ConsentApiController.decide (consent-api/v1)',
      'ConsentApiController.list (consent-api/v1)',
      'ConsentApiController.one (consent-api/v1)',
      'FilesController.localGet (platform/files)',
      'FilesController.localPut (platform/files)',
      'GpsController.ingest (transport/gps)',
      'HealthController.health (health)',
      'MetricsController.metricsText (metrics)',
      // sign-in with an emailed code (0136): before any session exists. start answers the same for an unknown
      // login; verify checks a 6-digit code bound to its challenge (5 tries, 10 minutes, one per 30 s, five in
      // 15 minutes per user, in the database); offered says only whether any school uses it.
      'OtpController.offered (auth/otp)',
      'OtpController.start (auth/otp)',
      'OtpController.verify (auth/otp)',
      // Atom signs its answer with the school account's response hash key (HMAC-SHA512, constant time) (0142)
      'PaymentsController.atomReturned (payments)',
      'PaymentsController.ccavenueReturned (payments)',
      'PaymentsController.mock (payments)',
      'PaymentsController.razorpayReturned (payments)',
      'PaymentsController.razorpayWebhook (payments)',
      'PaymentsController.returned (payments)',
      // SBI ePay answers encrypted with the school account's AES key: it opens only with that key (0142)
      'PaymentsController.sbiepayReturned (payments)',
      'PaymentsController.webhook (payments)',
      // portal view-as (0183): the other app has no session yet; it hands in a one-time code (32 random bytes,
      // kept as a hash, 60 seconds, used once, bound to the app) for the signed impersonation token
      'PortalAsController.handoff (access/portal-as)',
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
      // the public link and QR of a consent form (0169): only with the form's random link token, throttled per IP;
      // info is read-only, otp needs a proof of work (three live codes per address), verify allows five tries;
      // the rest need the `cf.` pass (two hours, signed, bound to the form) and touch only that pass's answers
      'PublicConsentFormsController.answer (public/consent-forms)',
      'PublicConsentFormsController.edit (public/consent-forms)',
      'PublicConsentFormsController.info (public/consent-forms)',
      'PublicConsentFormsController.me (public/consent-forms)',
      'PublicConsentFormsController.otp (public/consent-forms)',
      'PublicConsentFormsController.pay (public/consent-forms)',
      'PublicConsentFormsController.pdf (public/consent-forms)',
      'PublicConsentFormsController.respond (public/consent-forms)',
      'PublicConsentFormsController.upload (public/consent-forms)',
      'PublicConsentFormsController.verify (public/consent-forms)',
      // the school's band on its public pages (name, logo, address, contact): read-only, throttled
      'PublicSchoolController.logo (public/schools)',
      'PublicSchoolController.profile (public/schools)',
      // walk-in visitors registering on their own phone (0065): the lists are read-only and throttled;
      // registering and the visitor's own entry need the OTP-issued applicant token
      'PublicVisitorsController.mine (public/visitors)',
      'PublicVisitorsController.options (public/visitors)',
      'PublicVisitorsController.register (public/visitors)',
      'PunchController.ingest (attendance/punch)',
      // the careers page (0198): the vacancy pages and the form are read-only and throttled; otp needs a proof
      // of work (three live codes per address), verify allows five tries; the rest need the `cand.` token
      // (two hours, signed) and touch only that candidate's own form, files and applications
      'RecruitmentPublicController.addFile (public/careers)',
      'RecruitmentPublicController.applicationPdf (public/careers)',
      'RecruitmentPublicController.apply (public/careers)',
      'RecruitmentPublicController.fileUrl (public/careers)',
      'RecruitmentPublicController.form (public/careers)',
      'RecruitmentPublicController.me (public/careers)',
      'RecruitmentPublicController.otp (public/careers)',
      'RecruitmentPublicController.profile (public/careers)',
      'RecruitmentPublicController.removeFile (public/careers)',
      'RecruitmentPublicController.resend (public/careers)',
      'RecruitmentPublicController.signIn (public/careers)',
      'RecruitmentPublicController.slot (public/careers)',
      'RecruitmentPublicController.vacancies (public/careers)',
      'RecruitmentPublicController.vacancy (public/careers)',
      'RecruitmentPublicController.verify (public/careers)',
      'RfidController.ingest (attendance/rfid)',
      'ShadowController.ingest (shadow)',
    ]);
    if (unprotected.length > 0) {
      throw new Error(`handlers without a permission: ${unprotected.join(', ')}`);
    }
    expect(unprotected).toEqual([]);
  });
});
