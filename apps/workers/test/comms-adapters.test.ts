import { describe, expect, it } from 'vitest';
import { MetaWhatsAppAdapter } from '../src/adapters/meta-whatsapp.adapter';
import { Msg91Adapter } from '../src/adapters/msg91.adapter';

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
