import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';

/**
 * CCAvenue (Sprint 13). The request is a query string encrypted with AES-128-CBC: the key is MD5(working key)
 * and the IV is the fixed byte sequence 0x00..0x0f; the browser posts `encRequest` and `access_code` to the
 * gateway. The gateway answers with `encResp`, decrypted the same way, whose `order_status` decides the
 * outcome. Unlike the legacy pages, a response that does not decrypt or whose order id or amount differs is
 * refused (threat model P1, P3). The working key never leaves the API.
 */
export interface CcavenueCredentials {
  merchantId: string;
  accessCode: string;
  workingKey: string;
  baseUrl: string;
}

const IV = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
const keyOf = (workingKey: string) => createHash('md5').update(workingKey, 'utf8').digest();

export function encrypt(plain: string, workingKey: string): string {
  const cipher = createCipheriv('aes-128-cbc', keyOf(workingKey), IV);
  return Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]).toString('hex');
}

export function decrypt(encHex: string, workingKey: string): string | null {
  try {
    const decipher = createDecipheriv('aes-128-cbc', keyOf(workingKey), IV);
    return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString(
      'utf8',
    );
  } catch {
    return null;
  }
}

export interface CcavenueRequest {
  merchant_id: string;
  order_id: string;
  amount: string;
  currency: 'INR';
  redirect_url: string;
  cancel_url: string;
  language: 'EN';
  billing_name: string;
  billing_email: string;
  billing_tel: string;
  merchant_param1: string; // intent id
  merchant_param2: string; // purpose
}

export interface CcavenueForm {
  kind: 'form';
  action: string;
  method: 'POST';
  fields: { encRequest: string; access_code: string };
}

const qs = (o: Record<string, string>) =>
  Object.entries(o)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

/** Builds the encrypted auto-post form for an intent. */
export function buildForm(req: CcavenueRequest, c: CcavenueCredentials): CcavenueForm {
  return {
    kind: 'form',
    action: `${c.baseUrl}/transaction/transaction.do?command=initiateTransaction`,
    method: 'POST',
    fields: {
      encRequest: encrypt(qs(req as unknown as Record<string, string>), c.workingKey),
      access_code: c.accessCode,
    },
  };
}

export interface CcavenueResponse {
  order_id: string;
  tracking_id: string;
  bank_ref_no?: string;
  order_status: 'Success' | 'Failure' | 'Aborted' | 'Invalid' | string;
  failure_message?: string;
  status_message?: string;
  amount: string;
  currency?: string;
  merchant_param1?: string;
  [k: string]: string | undefined;
}

/** Decrypts `encResp`; null when the working key does not fit (a forged or foreign response). */
export function readResponse(encResp: string, workingKey: string): CcavenueResponse | null {
  const plain = decrypt(encResp, workingKey);
  if (plain === null) return null;
  const out: Record<string, string> = {};
  for (const part of plain.split('&')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    out[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1).replace(/\+/g, ' '));
  }
  if (!out.order_id || !out.order_status) return null;
  return out as unknown as CcavenueResponse;
}

/** Test and mock helper: an `encResp` as the gateway would send it. */
export function mockResponse(
  r: Omit<CcavenueResponse, 'tracking_id'> & { tracking_id?: string },
  workingKey: string,
): string {
  const body = { tracking_id: r.tracking_id ?? `CCAV${Date.now()}`, ...r } as Record<
    string,
    string | undefined
  >;
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) if (v !== undefined) clean[k] = v;
  return encrypt(qs(clean), workingKey);
}

export const outcomeOf = (status: string): 'success' | 'failure' =>
  status === 'Success' ? 'success' : 'failure';
