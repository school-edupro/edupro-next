import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Atom (NTT DATA) paynetz redirect. The browser posts the transaction to Atom with a request signature,
 * HMAC-SHA512(login + pass + ttype + prodid + txnid + amt + txncurr) under the request hash key; Atom posts
 * back the result with HMAC-SHA512(mmp_txn + mer_txn + f_code + prod + discriminator + amt + bank_txn) under
 * the response hash key, checked in constant time. f_code "Ok" is success. Verify with the test
 * credentials: Atom also offers a newer AES "AIPAY" checkout that some merchants are given instead.
 */
export interface AtomCredentials {
  login: string;
  password: string;
  productId: string;
  reqHashKey: string;
  resHashKey: string;
  baseUrl: string;
}

export const ATOM_URLS = {
  test: 'https://paynetzuat.atomtech.in/paynetz/epi/fts',
  live: 'https://payment.atomtech.in/paynetz/epi/fts',
};

const hmac = (data: string, key: string) => createHmac('sha512', key).update(data, 'utf8').digest('hex');

const stamp = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  // Atom wants dd/mm/yyyy hh:mm:ss, Indian time
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  return `${p(ist.getUTCDate())}/${p(ist.getUTCMonth() + 1)}/${ist.getUTCFullYear()} ${p(ist.getUTCHours())}:${p(ist.getUTCMinutes())}:${p(ist.getUTCSeconds())}`;
};

export interface AtomRequest {
  txnId: string;
  amount: string;
  name: string;
  email: string;
  mobile: string;
  returnUrl: string;
  customerAccount: string;
}

export function buildForm(r: AtomRequest, c: AtomCredentials, now = new Date()) {
  const ttype = 'NBFundTransfer';
  const fields: Record<string, string> = {
    login: c.login,
    pass: c.password,
    ttype,
    prodid: c.productId,
    amt: r.amount,
    txncurr: 'INR',
    txnscamt: '0',
    clientcode: Buffer.from(r.name || 'Payer').toString('base64'),
    txnid: r.txnId,
    date: stamp(now),
    custacc: r.customerAccount || '0',
    udf1: r.name,
    udf2: r.email,
    udf3: r.mobile,
    ru: r.returnUrl,
    signature: hmac(`${c.login}${c.password}${ttype}${c.productId}${r.txnId}${r.amount}INR`, c.reqHashKey),
  };
  return { kind: 'form' as const, action: c.baseUrl, method: 'POST' as const, fields };
}

export interface AtomResponse {
  mmp_txn?: string;
  mer_txn?: string;
  amt?: string;
  prod?: string;
  date?: string;
  bank_txn?: string;
  f_code?: string;
  discriminator?: string;
  bank_name?: string;
  desc?: string;
  signature?: string;
  [k: string]: string | undefined;
}

export function responseSignature(r: AtomResponse, resHashKey: string): string {
  return hmac(
    `${r.mmp_txn ?? ''}${r.mer_txn ?? ''}${r.f_code ?? ''}${r.prod ?? ''}${r.discriminator ?? ''}${r.amt ?? ''}${r.bank_txn ?? ''}`,
    resHashKey,
  );
}

export function verifyResponse(r: AtomResponse, resHashKey: string): boolean {
  if (!r.signature) return false;
  const want = Buffer.from(responseSignature(r, resHashKey));
  const got = Buffer.from(r.signature.toLowerCase());
  return want.length === got.length && timingSafeEqual(want, got);
}

export const outcomeOf = (fCode: string | undefined): 'success' | 'failure' =>
  (fCode ?? '').toLowerCase() === 'ok' ? 'success' : 'failure';

/** For tests and the development mock: the answer Atom would post. */
export function mockResponse(
  txnId: string,
  amount: string,
  productId: string,
  outcome: 'success' | 'failure',
  resHashKey: string,
): AtomResponse {
  const r: AtomResponse = {
    mmp_txn: `${Date.now()}`,
    mer_txn: txnId,
    amt: amount,
    prod: productId,
    date: stamp(new Date()),
    bank_txn: `B${Date.now()}`,
    f_code: outcome === 'success' ? 'Ok' : 'F',
    discriminator: 'NB',
    bank_name: 'Atom Bank',
  };
  r.signature = responseSignature(r, resHashKey);
  return r;
}
