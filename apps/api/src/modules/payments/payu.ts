import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * PayU hashing (S9-02). Request: sha512(key|txnid|amount|productinfo|firstname|email|udf1..udf5|||||salt).
 * Response: sha512(salt|status||||||udf5..udf1|email|firstname|productinfo|amount|txnid|key). The response
 * check is the one the legacy success pages skipped; here it is mandatory and constant-time.
 */
export interface PayuRequest {
  key: string;
  txnid: string;
  amount: string;
  productinfo: string;
  firstname: string;
  email: string;
  phone: string;
  surl: string;
  furl: string;
  udf1?: string;
  udf2?: string;
  udf3?: string;
  udf4?: string;
  udf5?: string;
  hash: string;
}

export interface PayuResponse {
  status: string;
  txnid: string;
  amount: string;
  productinfo: string;
  firstname: string;
  email: string;
  mihpayid?: string;
  hash: string;
  udf1?: string;
  udf2?: string;
  udf3?: string;
  udf4?: string;
  udf5?: string;
  [k: string]: unknown;
}

const sha512 = (s: string) => createHash('sha512').update(s).digest('hex');
export const money = (n: number | string) => Number(n).toFixed(2);

export function requestHash(
  p: Omit<PayuRequest, 'hash' | 'surl' | 'furl' | 'phone'>,
  salt: string,
): string {
  return sha512(
    `${p.key}|${p.txnid}|${p.amount}|${p.productinfo}|${p.firstname}|${p.email}|${p.udf1 ?? ''}|${p.udf2 ?? ''}|${p.udf3 ?? ''}|${p.udf4 ?? ''}|${p.udf5 ?? ''}||||||${salt}`,
  );
}

export function responseHash(r: Omit<PayuResponse, 'hash'>, key: string, salt: string): string {
  return sha512(
    `${salt}|${r.status}||||||${r.udf5 ?? ''}|${r.udf4 ?? ''}|${r.udf3 ?? ''}|${r.udf2 ?? ''}|${r.udf1 ?? ''}|${r.email}|${r.firstname}|${r.productinfo}|${r.amount}|${r.txnid}|${key}`,
  );
}

export function verifyResponse(r: PayuResponse, key: string, salt: string): boolean {
  const expected = Buffer.from(responseHash(r, key, salt), 'utf8');
  const given = Buffer.from(String(r.hash ?? ''), 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Builds the fields of the auto-posted gateway form. */
export function buildRequest(
  input: {
    txnid: string;
    amount: number | string;
    productinfo: string;
    firstname: string;
    email: string;
    phone: string;
    surl: string;
    furl: string;
    udf1?: string;
    udf2?: string;
  },
  key: string,
  salt: string,
): PayuRequest {
  const base = {
    key,
    txnid: input.txnid,
    amount: money(input.amount),
    productinfo: input.productinfo,
    firstname: input.firstname,
    email: input.email,
    udf1: input.udf1 ?? '',
    udf2: input.udf2 ?? '',
  };
  return {
    ...base,
    phone: input.phone,
    surl: input.surl,
    furl: input.furl,
    hash: requestHash(base, salt),
  };
}

/** Test and mock helper: a gateway response for a request, signed like PayU would. */
export function mockResponse(
  req: Pick<
    PayuRequest,
    'txnid' | 'amount' | 'productinfo' | 'firstname' | 'email' | 'udf1' | 'udf2'
  >,
  status: 'success' | 'failure',
  key: string,
  salt: string,
  mihpayid = `MOCK${Date.now()}`,
): PayuResponse {
  const body = {
    status,
    txnid: req.txnid,
    amount: req.amount,
    productinfo: req.productinfo,
    firstname: req.firstname,
    email: req.email,
    udf1: req.udf1 ?? '',
    udf2: req.udf2 ?? '',
    mihpayid,
    mode: 'MOCK',
  };
  return { ...body, hash: responseHash(body, key, salt) };
}
