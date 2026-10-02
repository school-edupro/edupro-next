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

/** The school's frame around every HTML email: name on top, a quiet footer. */
export function emailLayout(school: string, inner: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f6f9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:16px 0"><tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:8px;font-family:Arial,Helvetica,sans-serif;color:#1f2933">
<tr><td style="background:#00265d;color:#ffffff;padding:14px 20px;font-size:18px;font-weight:bold;border-radius:8px 8px 0 0">${school}</td></tr>
<tr><td style="padding:20px;font-size:15px;line-height:1.5">${inner}</td></tr>
<tr><td style="padding:12px 20px;font-size:12px;color:#52606d;border-top:1px solid #e4e7eb">Sent by ${school} through EduPro. Please do not reply to this automated email.</td></tr>
</table></td></tr></table></body></html>`;
}
