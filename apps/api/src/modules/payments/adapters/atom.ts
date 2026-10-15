import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  pbkdf2Sync,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Atom / NTT DATA "AIPAY" (the kit Atom issues today). Three steps:
 *  1. AUTH, server to server: the payment as JSON, AES-256-CBC encrypted with the request encryption key
 *     (key = PBKDF2-HMAC-SHA512(key, salt = the key, 65536 rounds, 32 bytes), IV = bytes 0..15, hex), posted
 *     as encData + merchId; Atom answers encData (decrypted with the response key) with an atomTokenId.
 *  2. The browser loads Atom's atomcheckout.js and opens AtomPaynetz with the token.
 *  3. Atom posts the result to our return URL as encData; it must open with the response decryption key,
 *     and its signature, HMAC-SHA512(merchId + atomTxnId + merchTxnId + totalAmount + statusCode +
 *     subChannel + bankTxnId) under the response hash key, must match (constant time). OTS0000 = success.
 * Addresses and the key/salt rule follow the AIPAY kit; check them against the kit Atom gave the school.
 */
export interface AtomCredentials {
  merchId: string;
  password: string;
  productId: string;
  reqEncKey: string;
  resDecKey: string;
  resHashKey: string;
  mode: 'test' | 'live';
}

export const ATOM_URLS = {
  test: 'https://paynetzuat.atomtech.in/ots/aipay/auth',
  live: 'https://payment1.atomtech.in/ots/aipay/auth',
};
export const ATOM_SCRIPTS = {
  test: 'https://pgtest.atomtech.in/staticdata/ots/js/atomcheckout.js',
  live: 'https://psa.atomtech.in/staticdata/ots/js/atomcheckout.js',
};

const IV = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
const keyOf = (key: string) =>
  pbkdf2Sync(Buffer.from(key, 'utf8'), Buffer.from(key, 'utf8'), 65536, 32, 'sha512');

export function encrypt(plain: string, key: string): string {
  const c = createCipheriv('aes-256-cbc', keyOf(key), IV);
  return Buffer.concat([c.update(plain, 'utf8'), c.final()])
    .toString('hex')
    .toUpperCase();
}

export function decrypt(hex: string, key: string): string | null {
  try {
    const d = createDecipheriv('aes-256-cbc', keyOf(key), IV);
    return Buffer.concat([d.update(Buffer.from(hex, 'hex')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Atom's date: yyyy-MM-dd HH:mm:ss, Indian time. */
const stamp = (d: Date) => {
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  return ist.toISOString().replace('T', ' ').slice(0, 19);
};

export interface AtomPayment {
  txnId: string;
  amount: string;
  email: string;
  mobile: string;
  customerAccount: string;
}

/** The AUTH request in AIPAY's JSON shape. */
export function authPayload(p: AtomPayment, c: AtomCredentials, now = new Date()) {
  return {
    payInstrument: {
      headDetails: { version: 'OTSv1.1', api: 'AUTH', platform: 'FLASH' },
      merchDetails: {
        merchId: c.merchId,
        userId: '',
        password: c.password,
        merchTxnId: p.txnId,
        merchTxnDate: stamp(now),
      },
      payDetails: {
        amount: Number(p.amount).toFixed(2),
        product: c.productId,
        custAccNo: p.customerAccount || '0',
        txnCurrency: 'INR',
      },
      custDetails: { custEmail: p.email || 'na@example.com', custMobile: p.mobile || '0000000000' },
      extras: { udf1: '', udf2: '', udf3: '', udf4: '', udf5: '' },
    },
  };
}

/** Step 1: the token for the checkout. Throws with Atom's message when it refuses. */
export async function requestToken(
  p: AtomPayment,
  c: AtomCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const body = new URLSearchParams({
    encData: encrypt(JSON.stringify(authPayload(p, c)), c.reqEncKey),
    merchId: c.merchId,
  });
  const res = await fetchImpl(ATOM_URLS[c.mode], {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  const enc = new URLSearchParams(text).get('encData');
  const plain = enc ? decrypt(enc, c.resDecKey) : null;
  if (!plain) throw new Error(`Atom AUTH: HTTP ${String(res.status)} ${text.slice(0, 160)}`);
  const json = JSON.parse(plain) as {
    atomTokenId?: string | number;
    responseDetails?: { txnStatusCode?: string; txnMessage?: string; txnDescription?: string };
  };
  const ok = json.responseDetails?.txnStatusCode === 'OTS0000' && json.atomTokenId;
  if (!ok)
    throw new Error(
      `Atom AUTH: ${json.responseDetails?.txnStatusCode ?? '?'} ${json.responseDetails?.txnDescription ?? json.responseDetails?.txnMessage ?? ''}`.trim(),
    );
  return String(json.atomTokenId);
}

export interface AtomResult {
  merchId: string;
  merchTxnId: string;
  atomTxnId: string;
  totalAmount: string;
  statusCode: string;
  description: string;
  subChannel: string;
  bankTxnId: string;
  signature: string;
}

/** Step 3: Atom's answer, opened with the response key; null when it does not open. */
export function readResponse(encData: string, resDecKey: string): AtomResult | null {
  const plain = decrypt(encData, resDecKey);
  if (!plain) return null;
  try {
    const j = JSON.parse(plain) as { payInstrument?: Record<string, Record<string, unknown>> };
    const pi = j.payInstrument ?? {};
    const merch = (pi.merchDetails ?? {}) as Record<string, unknown>;
    const pay = (pi.payDetails ?? {}) as Record<string, unknown>;
    const resp = (pi.responseDetails ?? {}) as Record<string, unknown>;
    const mode = (pi.payModeSpecificData ?? {}) as Record<string, unknown>;
    const sub = mode.subChannel;
    const bank = (mode.bankDetails ?? {}) as Record<string, unknown>;
    return {
      merchId: String(merch.merchId ?? ''),
      merchTxnId: String(merch.merchTxnId ?? ''),
      atomTxnId: String(pay.atomTxnId ?? ''),
      totalAmount: Number(pay.totalAmount ?? pay.amount ?? 0).toFixed(2),
      statusCode: String(resp.statusCode ?? ''),
      description: String(resp.description ?? resp.message ?? ''),
      subChannel: String(Array.isArray(sub) ? (sub[0] ?? '') : (sub ?? '')),
      bankTxnId: String(bank.bankTxnId ?? ''),
      signature: String(pay.signature ?? ''),
    };
  } catch {
    return null;
  }
}

export function signatureOf(r: AtomResult, resHashKey: string): string {
  return createHmac('sha512', resHashKey)
    .update(
      `${r.merchId}${r.atomTxnId}${r.merchTxnId}${r.totalAmount}${r.statusCode}${r.subChannel}${r.bankTxnId}`,
      'utf8',
    )
    .digest('hex');
}

export function verify(r: AtomResult, resHashKey: string): boolean {
  if (!r.signature) return false;
  const want = Buffer.from(signatureOf(r, resHashKey));
  const got = Buffer.from(r.signature.toLowerCase());
  return want.length === got.length && timingSafeEqual(want, got);
}

export const outcomeOf = (code: string): 'success' | 'failure' | 'pending' =>
  code === 'OTS0000' ? 'success' : code === 'OTS0551' ? 'pending' : 'failure';

/** For tests and the development mock: the answer Atom would post (encData). */
export function mockResponse(
  txnId: string,
  amount: string,
  merchId: string,
  outcome: 'success' | 'failure',
  resDecKey: string,
  resHashKey: string,
): string {
  const r: AtomResult = {
    merchId,
    merchTxnId: txnId,
    atomTxnId: `${Date.now()}`,
    totalAmount: Number(amount).toFixed(2),
    statusCode: outcome === 'success' ? 'OTS0000' : 'OTS0600',
    description: outcome === 'success' ? 'SUCCESS' : 'CANCELLED',
    subChannel: 'NB',
    bankTxnId: `B${Date.now()}`,
    signature: '',
  };
  r.signature = signatureOf(r, resHashKey);
  return encrypt(
    JSON.stringify({
      payInstrument: {
        merchDetails: { merchId, merchTxnId: txnId },
        payDetails: { atomTxnId: r.atomTxnId, totalAmount: Number(amount), signature: r.signature },
        responseDetails: { statusCode: r.statusCode, description: r.description },
        payModeSpecificData: {
          subChannel: [r.subChannel],
          bankDetails: { bankTxnId: r.bankTxnId },
        },
      },
    }),
    resDecKey,
  );
}
