import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DeadToken, FcmAdapter } from '../src/adapters/fcm.adapter';
import { EmsWhatsAppAdapter } from '../src/adapters/ems-whatsapp.adapter';
import { MetaWhatsAppAdapter } from '../src/adapters/meta-whatsapp.adapter';
import { Msg91Adapter } from '../src/adapters/msg91.adapter';
import { SmsBhejoAdapter } from '../src/adapters/smsbhejo.adapter';

const fake = (status: number, body: unknown) => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
};

const base = {
  id: '1',
  channel: 'sms' as const,
  to: '9876543210',
  subject: null,
  dlt: { templateId: '1207000000000000001', entityId: null, senderId: 'ALPHAS' },
};

describe('MSG91 adapter', () => {
  it('sends the DLT template id, switches Unicode on for Hindi and returns the request id', async () => {
    const f = fake(200, { type: 'success', message: '3567656c6c6f313233343536' });
    const a = new Msg91Adapter({ route: '4' }, 'key', f.fn);
    const r = await a.send({ ...base, body: 'कल अवकाश है' });
    expect(r.providerMessageId).toBe('3567656c6c6f313233343536');
    const url = new URL(f.calls[0]!.url);
    expect(url.searchParams.get('DLT_TE_ID')).toBe('1207000000000000001');
    expect(url.searchParams.get('mobiles')).toBe('919876543210');
    expect(url.searchParams.get('unicode')).toBe('1');
    expect(url.searchParams.get('sender')).toBe('ALPHAS');
  });
  it('fails without a DLT id and on provider errors', async () => {
    const a = new Msg91Adapter(
      {},
      'key',
      fake(200, { type: 'error', message: 'Invalid authkey' }).fn,
    );
    await expect(
      a.send({ ...base, body: 'x', dlt: { ...base.dlt, templateId: null } }),
    ).rejects.toThrow(/DLT/);
    await expect(a.send({ ...base, body: 'x' })).rejects.toThrow(/Invalid authkey/);
  });
});

describe('Meta WhatsApp adapter', () => {
  it('sends the approved template with body parameters and a document header', async () => {
    const f = fake(200, { messages: [{ id: 'wamid.ABC' }] });
    const a = new MetaWhatsAppAdapter({ phoneNumberId: '111', apiVersion: 'v21.0' }, 'tok', f.fn);
    const r = await a.send({
      ...base,
      channel: 'whatsapp',
      body: 'Dear Suresh, PTM on Saturday',
      whatsapp: {
        templateName: 'school_circular',
        language: 'en',
        params: ['Suresh', 'PTM on Saturday'],
        header: 'document',
      },
      attachments: [
        {
          name: 'circular.pdf',
          contentType: 'application/pdf',
          url: 'https://files.example/c.pdf',
        },
      ],
    });
    expect(r.providerMessageId).toBe('wamid.ABC');
    expect(f.calls[0]!.url).toBe('https://graph.facebook.com/v21.0/111/messages');
    const sent = JSON.parse(String(f.calls[0]!.init!.body)) as {
      to: string;
      template: { name: string; components: Array<{ type: string; parameters: unknown[] }> };
    };
    expect(sent.to).toBe('919876543210');
    expect(sent.template.name).toBe('school_circular');
    expect(sent.template.components.map((c) => c.type)).toEqual(['header', 'body']);
    expect(sent.template.components[1]!.parameters).toHaveLength(2);
  });
  it('needs the attachment for a media header and reports Meta errors', async () => {
    const a = new MetaWhatsAppAdapter(
      { phoneNumberId: '111' },
      'tok',
      fake(400, { error: { message: 'Template not approved' } }).fn,
    );
    const wa = { templateName: 't', language: 'en', params: [], header: 'document' as const };
    await expect(a.send({ ...base, channel: 'whatsapp', body: 'x', whatsapp: wa })).rejects.toThrow(
      /attach a file/,
    );
    await expect(
      a.send({ ...base, channel: 'whatsapp', body: 'x', whatsapp: { ...wa, header: 'none' } }),
    ).rejects.toThrow(/Template not approved/);
  });
});

describe('smsbhejo adapter', () => {
  it('sends user, key, sender, entity and DLT template like the legacy worker', async () => {
    const f = fake(200, 'MsgID:123456789');
    const a = new SmsBhejoAdapter({ user: 'school', entityId: '110100001' }, 'k', f.fn);
    const r = await a.send({ ...base, body: 'Dear parent,\nfee due' });
    expect(r.providerMessageId).toBe('MsgID:123456789');
    const url = new URL(f.calls[0]!.url);
    expect(url.origin + url.pathname).toBe('http://smsbhejo.org/submitsms.jsp');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      user: 'school',
      key: 'k',
      mobile: '9876543210',
      message: 'Dear parent, fee due',
      senderid: 'ALPHAS',
      accusage: '1',
      entityid: '110100001',
      tempid: '1207000000000000001',
    });
  });
  it('treats an empty or error answer as a failure', async () => {
    const a = new SmsBhejoAdapter(
      { user: 'u', entityId: 'e' },
      'k',
      fake(200, 'Invalid template').fn,
    );
    await expect(a.send({ ...base, body: 'x' })).rejects.toThrow(/Invalid template/);
    const b = new SmsBhejoAdapter({ user: 'u', entityId: 'e' }, 'k', fake(200, '').fn);
    await expect(b.send({ ...base, body: 'x' })).rejects.toThrow(/smsbhejo/);
    // a gateway that cannot be reached says why (not just "fetch failed")
    const down = new SmsBhejoAdapter(
      {
        user: 'school',
        senderId: 'ALPHAS',
        entityId: '1101',
        url: 'https://smsbhejo.org/submitsms.jsp',
      },
      'k',
      (() =>
        Promise.reject(
          Object.assign(new TypeError('fetch failed'), {
            cause: { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' },
          }),
        )) as unknown as typeof fetch,
    );
    await expect(down.send({ ...base, body: 'x' })).rejects.toThrow(
      /could not reach the gateway at https:\/\/smsbhejo\.org \(UNABLE_TO_VERIFY_LEAF_SIGNATURE\); its https certificate is not valid/,
    );
  });
});

describe('EMS WhatsApp bridge adapter', () => {
  it('posts the approved template with variables and an inline base64 document', async () => {
    const f = fake(200, { id: 'ems-1' });
    const a = new EmsWhatsAppAdapter({}, 'bearer-key', f.fn);
    const r = await a.send({
      ...base,
      channel: 'whatsapp',
      body: 'x',
      whatsapp: {
        templateName: 'fee_due',
        language: 'en',
        params: ['Suresh', '5,000'],
        header: 'document',
      },
      attachments: [{ name: 'fee.pdf', contentType: 'application/pdf', bytes: Buffer.from('PDF') }],
    });
    expect(r.providerMessageId).toBe('ems-1');
    expect(f.calls[0]!.url).toBe('https://ems.onmobilise.com/api/v1/messages');
    expect((f.calls[0]!.init!.headers as Record<string, string>).authorization).toBe(
      'Bearer bearer-key',
    );
    expect(JSON.parse(String(f.calls[0]!.init!.body))).toEqual({
      to: '9876543210',
      type: 'template',
      template: {
        name: 'fee_due',
        language: 'en',
        variables: ['Suresh', '5,000'],
        header: {
          type: 'document',
          data: Buffer.from('PDF').toString('base64'),
          mime: 'application/pdf',
          filename: 'fee.pdf',
        },
      },
    });
  });
  it('needs an approved template name and reports bridge errors', async () => {
    const a = new EmsWhatsAppAdapter({}, 'k', fake(401, { error: 'bad key' }).fn);
    await expect(a.send({ ...base, channel: 'whatsapp', body: 'x' })).rejects.toThrow(
      /approved template name/,
    );
    await expect(
      a.send({
        ...base,
        channel: 'whatsapp',
        body: 'x',
        whatsapp: { templateName: 't', language: 'en', params: [], header: 'none' },
      }),
    ).rejects.toThrow(/401 bad key/);
  });
});

describe('FCM adapter', () => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const account = {
    project_id: 'school-app',
    client_email: `push-${String(Date.now())}@school-app.iam.gserviceaccount.com`,
    private_key: privateKey,
  };
  it('signs in with the service account and sends a webpush that opens the link', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fn = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? '') });
      if (String(url).includes('oauth2'))
        return new Response(JSON.stringify({ access_token: 'ya29.x', expires_in: 3600 }), {
          status: 200,
        });
      return new Response(JSON.stringify({ name: 'projects/school-app/messages/1' }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const a = new FcmAdapter(account, fn);
    const r = await a.send({
      ...base,
      channel: 'push',
      to: 'device-token',
      subject: 'New homework',
      body: 'Maths worksheet',
      link: '/homework',
    });
    expect(r.providerMessageId).toBe('projects/school-app/messages/1');
    expect(new URLSearchParams(calls[0]!.body).get('grant_type')).toBe(
      'urn:ietf:params:oauth:grant-type:jwt-bearer',
    );
    expect(calls[1]!.url).toBe('https://fcm.googleapis.com/v1/projects/school-app/messages:send');
    expect(JSON.parse(calls[1]!.body)).toMatchObject({
      message: {
        token: 'device-token',
        notification: { title: 'New homework' },
        webpush: { fcm_options: { link: '/homework' } },
      },
    });
  });
  it('reports a dead device token so it can be removed', async () => {
    const fn = (async (url: string | URL) =>
      String(url).includes('oauth2')
        ? new Response(JSON.stringify({ access_token: 'ya29.x', expires_in: 3600 }), {
            status: 200,
          })
        : new Response(
            JSON.stringify({
              error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] },
            }),
            { status: 404 },
          )) as unknown as typeof fetch;
    await expect(
      new FcmAdapter(account, fn).send({ ...base, channel: 'push', to: 'old', body: 'x' }),
    ).rejects.toBeInstanceOf(DeadToken);
  });
});
