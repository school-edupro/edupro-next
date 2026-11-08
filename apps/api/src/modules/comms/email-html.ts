import sanitizeHtml from 'sanitize-html';

/**
 * HTML a school may put in an email template or a composed email: formatting, links, images, tables
 * and buttons. Scripts, forms, frames, event handlers and javascript: links are removed.
 */
export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      'img',
      'span',
      'font',
      'center',
      'u',
      's',
      'sub',
      'sup',
      'hr',
    ],
    allowedAttributes: {
      '*': ['style', 'align', 'class', 'dir', 'width', 'height', 'bgcolor', 'border', 'valign'],
      a: ['href', 'name', 'target', 'rel', 'title'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan'],
      table: ['cellpadding', 'cellspacing'],
      font: ['color', 'face', 'size'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel', 'data'],
    allowedSchemesByTag: { img: ['http', 'https', 'data', 'cid'] },
    allowProtocolRelative: false,
  });
}

/**
 * The school's frame around every HTML email: name on top, a quiet footer. A purchase order's e-mail
 * adds the logo (an inline image, `cid:`), the address under the name and its own footer (where to
 * write back); every other e-mail looks as before.
 */
export function emailLayout(
  school: string,
  inner: string,
  opts: { logoCid?: string; subtitle?: string; footer?: string } = {},
): string {
  const head = opts.logoCid
    ? `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:12px;vertical-align:middle"><img src="cid:${opts.logoCid}" alt="" height="44" style="display:block;height:44px;background:#ffffff;border-radius:4px;padding:2px"></td><td style="vertical-align:middle;color:#ffffff;font-size:18px;font-weight:bold">${school}${opts.subtitle ? `<div style="font-size:12px;font-weight:normal;color:#dbe4f0">${opts.subtitle}</div>` : ''}</td></tr></table>`
    : `${school}${opts.subtitle ? `<div style="font-size:12px;font-weight:normal;color:#dbe4f0">${opts.subtitle}</div>` : ''}`;
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f6f9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:16px 0"><tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:8px;font-family:Arial,Helvetica,sans-serif;color:#1f2933">
<tr><td style="background:#00265d;color:#ffffff;padding:14px 20px;font-size:18px;font-weight:bold;border-radius:8px 8px 0 0">${head}</td></tr>
<tr><td style="padding:20px;font-size:15px;line-height:1.5">${inner}</td></tr>
<tr><td style="padding:12px 20px;font-size:12px;color:#52606d;border-top:1px solid #e4e7eb">${opts.footer ?? `Sent by ${school} through EduPro. Please do not reply to this automated email.`}</td></tr>
</table></td></tr></table></body></html>`;
}
