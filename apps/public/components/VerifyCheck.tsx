'use client';
import { Button } from '@edupro/ui';
import { useEffect, useRef, useState } from 'react';
import type { CertificateCheck } from '@/lib/api';
import { t, type Lang } from '@/lib/words';
import { CertificateCheckResult } from './CertificateCheckResult';

export type HumanCheck = { provider: 'recaptcha'; siteKey: string } | { provider: 'pow' };
interface Grecaptcha {
  ready: (fn: () => void) => void;
  render: (el: HTMLElement, opts: Record<string, unknown>) => number;
  reset: (id?: number) => void;
}
declare global {
  interface Window {
    grecaptcha?: Grecaptcha;
  }
}

/** Google's reCAPTCHA script, loaded once (with this page's nonce, so the page's policy allows it). */
function loadRecaptcha(lang: Lang, nonce: string | undefined): Promise<Grecaptcha> {
  return new Promise((resolve, reject) => {
    const ready = () => window.grecaptcha?.ready(() => resolve(window.grecaptcha!));
    if (window.grecaptcha) return ready();
    const id = 'ep-recaptcha';
    let s = document.getElementById(id) as HTMLScriptElement | null;
    if (!s) {
      s = document.createElement('script');
      s.id = id;
      s.src = `https://www.google.com/recaptcha/api.js?render=explicit&hl=${lang}`;
      s.async = true;
      if (nonce) s.nonce = nonce;
      document.head.appendChild(s);
    }
    s.addEventListener('load', ready);
    s.addEventListener('error', () => reject(new Error('recaptcha')));
  });
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
/** EduPro's own check: a small puzzle the browser solves (a second or two). */
async function solve(challenge: string, difficulty: number): Promise<string> {
  const prefix = '0'.repeat(difficulty);
  for (let n = 0; n < 50_000_000; n += 1) {
    if (n % 2000 === 0) await new Promise((r) => setTimeout(r, 0));
    if ((await sha256Hex(`${challenge}:${n}`)).startsWith(prefix)) return String(n);
  }
  throw new Error('could not solve the challenge');
}

/**
 * The certificate check for people (17 Nov 2026): the number and date (a search) or the QR's code, then the human
 * check — Google's "I'm not a robot", or EduPro's own puzzle — and the answer shows here. Nothing is in the address.
 */
export function VerifyCheck({
  school,
  lang,
  check,
  token,
  nonce,
}: {
  school: string;
  lang: Lang;
  check: HumanCheck;
  /** the QR's code: the check of that certificate, no number or date asked */
  token?: string;
  nonce?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<number | null>(null);
  const [answer, setAnswer] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CertificateCheck | null>(null);
  const recaptcha = check.provider === 'recaptcha';

  useEffect(() => {
    if (check.provider !== 'recaptcha' || !box.current || widget.current !== null) return;
    loadRecaptcha(lang, nonce)
      .then((g) => {
        if (!box.current || widget.current !== null) return;
        widget.current = g.render(box.current, {
          sitekey: check.siteKey,
          callback: (v: string) => setAnswer(v),
          'expired-callback': () => setAnswer(''),
          'error-callback': () => setAnswer(''),
        });
      })
      .catch(() => setLoadFailed(true));
  }, [check, lang, nonce]);

  async function submit(form: HTMLFormElement) {
    setError(null);
    setResult(null);
    const fd = new FormData(form);
    let human: Record<string, string>;
    if (recaptcha) {
      if (!answer) {
        setError(
          t(lang, 'Tick "I\'m not a robot" first.', 'पहले "मैं रोबोट नहीं हूँ" पर टिक करें।'),
        );
        return;
      }
      human = { recaptcha: answer };
    }
    setBusy(true);
    try {
      if (!recaptcha) {
        const ch = (await fetch('/api/challenge', { method: 'POST' }).then((r) => r.json())) as {
          challenge: string;
          difficulty: number;
        };
        human = { challenge: ch.challenge, nonce: await solve(ch.challenge, ch.difficulty) };
      }
      const res = await fetch('/api/certificate-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          school,
          ...(token
            ? { token }
            : { number: String(fd.get('number') ?? ''), date: String(fd.get('date') ?? '') }),
          ...human!,
        }),
      });
      const j = (await res.json()) as CertificateCheck & { type?: string; detail?: string };
      if (res.ok) setResult(j);
      else
        setError(
          res.status === 429
            ? (j.detail ??
                t(
                  lang,
                  'Too many checks: try again later.',
                  'बहुत अधिक जाँच: बाद में फिर कोशिश करें।',
                ))
            : (j.detail ?? j.type ?? t(lang, 'The check could not be done.', 'जाँच नहीं हो सकी।')),
        );
    } catch {
      setError(
        t(lang, 'The check could not be done; try again.', 'जाँच नहीं हो सकी; फिर कोशिश करें।'),
      );
    } finally {
      setBusy(false);
      // a reCAPTCHA answer is good once: a fresh tick for the next check
      if (recaptcha && widget.current !== null) {
        window.grecaptcha?.reset(widget.current);
        setAnswer('');
      }
    }
  }

  return (
    <>
      <form
        style={{ display: 'grid', gap: 'var(--sp-3)' }}
        onSubmit={(e) => {
          e.preventDefault();
          void submit(e.currentTarget);
        }}
      >
        {token ? (
          <p style={{ margin: 0 }}>
            {t(
              lang,
              'To see whether this certificate is valid, confirm you are a person and press Check.',
              'यह प्रमाणपत्र मान्य है या नहीं, यह देखने के लिए पुष्टि करें कि आप व्यक्ति हैं और जाँचें दबाएँ।',
            )}
          </p>
        ) : (
          <>
            <label className="ep-field" htmlFor="number">
              <span className="ep-field__label">
                {t(lang, 'Certificate number', 'प्रमाणपत्र क्रमांक')}
              </span>
              <input
                id="number"
                name="number"
                className="ep-input"
                required
                minLength={3}
                maxLength={60}
                placeholder="TC/2026-27/00012"
                autoComplete="off"
              />
            </label>
            <label className="ep-field" htmlFor="date">
              <span className="ep-field__label">
                {t(lang, 'Date of issue', 'जारी करने की तिथि')}
              </span>
              <input id="date" name="date" type="date" className="ep-input" required />
            </label>
          </>
        )}
        {recaptcha ? (
          <div>
            <div ref={box} />
            {loadFailed ? (
              <p className="ep-field__help" role="alert" style={{ margin: 0 }}>
                {t(
                  lang,
                  'The "I\'m not a robot" box could not load. Check your connection and reload the page.',
                  '"मैं रोबोट नहीं हूँ" बॉक्स नहीं खुला। कनेक्शन देखें और पेज फिर से खोलें।',
                )}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="ep-field__help" style={{ margin: 0 }}>
            {t(
              lang,
              'A quick check that you are a person runs when you press Check (a second or two).',
              'जाँचें दबाने पर एक छोटी जाँच चलती है कि आप व्यक्ति हैं (एक-दो सेकंड)।',
            )}
          </p>
        )}
        <div>
          <Button type="submit" disabled={busy}>
            {busy ? t(lang, 'Checking…', 'जाँच हो रही है…') : t(lang, 'Check', 'जाँचें')}
          </Button>
        </div>
      </form>
      {error ? (
        <div className="ep-alert ep-alert--warning" role="alert">
          {error}
        </div>
      ) : null}
      {result ? <CertificateCheckResult r={result} lang={lang} /> : null}
    </>
  );
}
