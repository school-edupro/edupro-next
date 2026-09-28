import { createHmac } from 'node:crypto';
import * as ccavenue from './ccavenue';
import * as razorpay from './razorpay';

describe('Razorpay adapter (Sprint 13)', () => {
  const secret = 'unit-test-secret';

  it('accepts the checkout signature it computes and refuses a tampered one', () => {
    const sig = razorpay.checkoutSignature('order_1', 'pay_1', secret);
    expect(
      razorpay.verifyCheckout(
        { razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: sig },
        secret,
      ),
    ).toBe(true);
    expect(
      razorpay.verifyCheckout(
        { razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_2', razorpay_signature: sig },
        secret,
      ),
    ).toBe(false);
    expect(
      razorpay.verifyCheckout(
        { razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'x' },
        secret,
      ),
    ).toBe(false);
  });

  it('verifies the webhook over the raw body only', () => {
    const raw = JSON.stringify({ event: 'payment.captured', n: 1 });
    const sig = createHmac('sha256', secret).update(raw).digest('hex');
    expect(razorpay.verifyWebhook(raw, sig, secret)).toBe(true);
    expect(razorpay.verifyWebhook(`${raw} `, sig, secret)).toBe(false);
    expect(razorpay.verifyWebhook(raw, undefined, secret)).toBe(false);
  });

  it('reads payment and refund events into one shape', () => {
    expect(
      razorpay.readWebhook({
        event: 'payment.captured',
        payload: {
          payment: {
            entity: { id: 'pay_9', order_id: 'order_9', amount: 720000, status: 'captured' },
          },
        },
      }),
    ).toMatchObject({
      kind: 'payment',
      orderId: 'order_9',
      paymentId: 'pay_9',
      amount: '7200.00',
      status: 'success',
    });
    expect(
      razorpay.readWebhook({
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              id: 'pay_8',
              order_id: 'order_8',
              amount: 100,
              status: 'failed',
              error_description: 'Card declined',
            },
          },
        },
      }),
    ).toMatchObject({
      kind: 'payment',
      status: 'failure',
      reason: 'Card declined',
      amount: '1.00',
    });
    expect(
      razorpay.readWebhook({
        event: 'refund.processed',
        payload: {
          refund: {
            entity: { id: 'rfnd_1', payment_id: 'pay_9', amount: 50000, status: 'processed' },
          },
        },
      }),
    ).toMatchObject({
      kind: 'refund',
      refundId: 'rfnd_1',
      paymentId: 'pay_9',
      amount: '500.00',
      status: 'success',
    });
    expect(razorpay.readWebhook({ event: 'order.paid' }).kind).toBe('other');
  });

  it('converts rupees to paise without floating point drift', () => {
    expect(razorpay.toPaise('7200.10')).toBe(720010);
    expect(razorpay.toPaise(0.29)).toBe(29);
    expect(razorpay.fromPaise(720010)).toBe('7200.10');
  });

  it('creates an order with basic auth through the injected fetch', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          id: 'order_new',
          amount: 720000,
          currency: 'INR',
          receipt: 'EP1',
          status: 'created',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    }) as typeof fetch;
    const order = await razorpay.createOrder(
      { keyId: 'k', keySecret: 's', webhookSecret: 'w', baseUrl: 'https://rzp.test' },
      { amount: '7200.00', receipt: 'EP1', notes: { txnId: 'EP1', intentId: '1' } },
      fetchImpl,
    );
    expect(order.id).toBe('order_new');
    expect(calls[0]!.url).toBe('https://rzp.test/v1/orders');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('k:s').toString('base64')}`,
    );
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      amount: 720000,
      currency: 'INR',
      receipt: 'EP1',
    });
  });
});

describe('CCAvenue adapter (Sprint 13)', () => {
  const key = 'working-key-0123456789';

  it('round-trips the encrypted request and response', () => {
    const enc = ccavenue.encrypt('merchant_id=1&order_id=EP1&amount=10.00', key);
    expect(enc).toMatch(/^[0-9a-f]+$/);
    expect(ccavenue.decrypt(enc, key)).toBe('merchant_id=1&order_id=EP1&amount=10.00');
    expect(ccavenue.decrypt(enc, 'another-working-key-000')).toBeNull();
  });

  it('builds the auto-post form and reads the gateway response', () => {
    const form = ccavenue.buildForm(
      {
        merchant_id: 'M1',
        order_id: 'EP123',
        amount: '7200.00',
        currency: 'INR',
        redirect_url: 'https://parent.example/api/payments/return?provider=ccavenue',
        cancel_url: 'https://parent.example/api/payments/return?provider=ccavenue',
        language: 'EN',
        billing_name: 'Suresh Sharma',
        billing_email: 's@example.test',
        billing_tel: '9876543210',
        merchant_param1: '42',
        merchant_param2: 'fee_instalment',
      },
      { merchantId: 'M1', accessCode: 'AC', workingKey: key, baseUrl: 'https://test.ccavenue.com' },
    );
    expect(form.kind).toBe('form');
    expect(form.fields.access_code).toBe('AC');
    expect(ccavenue.decrypt(form.fields.encRequest, key)).toContain('order_id=EP123');
    const encResp = ccavenue.mockResponse(
      {
        order_id: 'EP123',
        order_status: 'Success',
        amount: '7200.00',
        tracking_id: 'T1',
        bank_ref_no: 'B1',
      },
      key,
    );
    const resp = ccavenue.readResponse(encResp, key);
    expect(resp).toMatchObject({
      order_id: 'EP123',
      order_status: 'Success',
      amount: '7200.00',
      tracking_id: 'T1',
    });
    expect(ccavenue.outcomeOf('Success')).toBe('success');
    expect(ccavenue.outcomeOf('Aborted')).toBe('failure');
    expect(ccavenue.readResponse('deadbeef', key)).toBeNull();
  });
});
