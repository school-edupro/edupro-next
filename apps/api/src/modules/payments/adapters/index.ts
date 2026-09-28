import type { Env } from '../../../config/env';
import type { Provider } from '../payments.dto';
import type { CcavenueCredentials } from './ccavenue';
import type { RazorpayCredentials } from './razorpay';

export * as razorpay from './razorpay';
export * as ccavenue from './ccavenue';

/** What the browser needs to start paying. Forms are auto-posted; Razorpay opens its checkout script. */
export type Checkout =
  | {
      kind: 'form';
      provider: Provider;
      mode: 'mock' | 'test' | 'live';
      action: string;
      method: 'POST';
      fields: Record<string, string>;
    }
  | {
      kind: 'razorpay';
      provider: 'razorpay';
      mode: 'live';
      keyId: string;
      orderId: string;
      amount: number;
      currency: 'INR';
      name: string;
      description: string;
      prefill: { name: string; email: string; contact: string };
      notes: { txnId: string; intentId: string };
      callbackUrl: string;
      returnUrl: string | null;
    };

/** A gateway notification reduced to what the payments service decides on. */
export interface Notification {
  provider: Provider;
  /** Our transaction id when the gateway echoes it (PayU txnid, CCAvenue order_id, Razorpay receipt). */
  txnId: string | null;
  /** The provider's order id when it does not echo ours (Razorpay order_id). */
  orderId: string | null;
  /** The provider's payment reference (mihpayid, razorpay payment id, CCAvenue tracking id). */
  providerRef: string | null;
  status: 'success' | 'failure' | 'pending';
  amount: string | null;
  signatureOk: boolean;
  reason: string | null;
  payload: unknown;
}

export const razorpayCredentials = (env: Env): RazorpayCredentials => ({
  keyId: env.RAZORPAY_KEY_ID,
  keySecret: env.RAZORPAY_KEY_SECRET,
  webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
  baseUrl: env.RAZORPAY_BASE_URL,
});

export const ccavenueCredentials = (env: Env): CcavenueCredentials => ({
  merchantId: env.CCAVENUE_MERCHANT_ID,
  accessCode: env.CCAVENUE_ACCESS_CODE,
  workingKey: env.CCAVENUE_WORKING_KEY,
  baseUrl: env.CCAVENUE_BASE_URL,
});
