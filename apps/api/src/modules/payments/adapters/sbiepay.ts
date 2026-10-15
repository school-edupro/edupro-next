import { createCipheriv, createDecipheriv } from 'node:crypto';

/**
 * SBI ePay, aggregator-hosted page. The browser posts `EncryptTrans` (the transaction string encrypted
 * with the merchant's AES key) and `merchIdVal` to the SBI ePay listener. SBI ePay posts back `encData`,
 * encrypted with the same key: that it decrypts is the proof it came from SBI ePay, and the order number
 * and amount in it must be ours (as CCAvenue). The key is the one SBI ePay issues (16 bytes, often given
 * base64); AES-128-ECB with PKCS#5 padding as in SBI's integration kit. Verify with the test credentials
 * before going live: SBI has issued kits with other ciphers to some merchants.
 */
export interface SbiepayCredentials {
  merchantId: string;
  /** the AES key from SBI ePay (base64 or the 16 characters as given) */
  key: string;
  baseUrl: string;
}

export const SBIEPAY_URLS = {
  test: 'https://test.sbiepay.sbi/secure/AggregatorHostedListener',
  live: 'https://www.sbiepay.sbi/secure/AggregatorHostedListener',
};

function keyBytes(key: string): Buffer {
  const b64 = Buffer.from(key, 'base64');
  if (b64.length === 16 && /^[A-Za-z0-9+/=]+$/.test(key) && key.length >= 22) return b64;
  const raw = Buffer.from(key, 'utf8');
  if (raw.length === 16) return raw;
  throw new Error('The SBI ePay key must be 16 bytes (or its base64 form)');
}

export function encrypt(plain: string, key: string): string {
  const c = createCipheriv('aes-128-ecb', keyBytes(key), null);
  return Buffer.concat([c.update(plain, 'utf8'), c.final()]).toString('base64');
}

export function decrypt(data: string, key: string): string | null {
  try {
    const d = createDecipheriv('aes-128-ecb', keyBytes(key), null);
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export interface SbiepayRequest {
  orderNo: string;
  amount: string;
  customerId: string;
  successUrl: string;
  failUrl: string;
  otherDetails?: string;
}

/** The transaction string in SBI ePay's field order. */
export function requestString(r: SbiepayRequest, c: SbiepayCredentials): string {
  return [
    c.merchantId,
    'DOM', // operating mode
    'IN', // merchant country
    'INR', // merchant currency
    r.amount,
    r.otherDetails ?? 'NA',
    r.successUrl,
    r.failUrl,
    'SBIEPAY', // aggregator id
    r.orderNo,
    r.customerId || 'NA',
    'NB', // pay mode: the payer chooses on SBI ePay's page
    'ONLINE', // access medium
    'ONLINE', // transaction source
  ].join('|');
}

export function buildForm(r: SbiepayRequest, c: SbiepayCredentials) {
  return {
    kind: 'form' as const,
    action: c.baseUrl,
    method: 'POST' as const,
    fields: { EncryptTrans: encrypt(requestString(r, c), c.key), merchIdVal: c.merchantId },
  };
}

export interface SbiepayResponse {
  orderNo: string;
  atrn: string;
  status: string;
  amount: string;
  reason: string;
  raw: string[];
}

/** The answer: MerchantOrderNo|ATRN|Status|Amount|Currency|PayMode|OtherDetails|Reason|... */
export function readResponse(encData: string, key: string): SbiepayResponse | null {
  const plain = decrypt(encData, key);
  if (!plain) return null;
  const f = plain.split('|');
  if (f.length < 4 || !f[0]) return null;
  return {
    orderNo: f[0]!,
    atrn: f[1] ?? '',
    status: (f[2] ?? '').toUpperCase(),
    amount: f[3] ?? '',
    reason: f[7] ?? f[2] ?? '',
    raw: f,
  };
}

export const outcomeOf = (status: string): 'success' | 'failure' | 'pending' =>
  status === 'SUCCESS'
    ? 'success'
    : status === 'PENDING' || status === 'BOOKED'
      ? 'pending'
      : 'failure';

/** For tests and the development mock: the answer SBI ePay would post. */
export function mockResponse(
  orderNo: string,
  amount: string,
  outcome: 'success' | 'failure',
  key: string,
): string {
  return encrypt(
    [
      orderNo,
      `ATRN${Date.now()}`,
      outcome === 'success' ? 'SUCCESS' : 'FAIL',
      amount,
      'INR',
      'NB',
      'NA',
      outcome === 'success' ? 'Success' : 'Failed',
    ].join('|'),
    key,
  );
}
