'use client';
import { useState } from 'react';
import { Icon } from '@/components/nav-icons';

/**
 * The public link of a published vacancy (or of the whole careers page): the QR, the link to copy or
 * open, the poster, and share buttons that open WhatsApp or LinkedIn with the link (nothing is sent by
 * the school; the person shares it themselves).
 */
export function VacancyShare({
  url,
  qrSrc,
  qrSave,
  qrAlt,
  poster,
  shareText,
  note,
}: {
  url: string;
  qrSrc: string;
  qrSave: string;
  qrAlt: string;
  /** the poster's View and Download addresses (a vacancy only) */
  poster?: { view: string; save: string };
  /** the line that goes before the link in a WhatsApp message */
  shareText: string;
  note?: string;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied('Link copied.');
    } catch {
      setCopied('Copy did not work here: select the link and copy it.');
    }
  };
  return (
    <div className="ep-vac-share">
      <img src={qrSrc} alt={qrAlt} className="ep-vac-share__qr" />
      <div className="ep-vac-share__body">
        <label className="ep-field" htmlFor={`share-${qrSave}`} style={{ margin: 0 }}>
          <span className="ep-field__label">Link</span>
          <input id={`share-${qrSave}`} className="ep-input" readOnly value={url} />
        </label>
        {note ? (
          <p className="ep-field__help" style={{ margin: 0 }}>
            {note}
          </p>
        ) : null}
        <div className="ep-vac-share__tools">
          <button
            type="button"
            className="ep-btn ep-btn--secondary ep-btn--sm"
            onClick={() => void copy()}
          >
            <Icon name="copy" size={16} /> Copy link
          </button>
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href={url}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="link" size={16} /> Open
          </a>
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href={qrSave}>
            <Icon name="download" size={16} /> Download QR
          </a>
          {poster ? (
            <>
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={poster.view}
                target="_blank"
                rel="noreferrer"
                aria-label="View the poster"
                title="View the poster"
              >
                <Icon name="eye" size={16} /> Poster
              </a>
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={poster.save}
                aria-label="Download the poster"
                title="Download the poster"
              >
                <Icon name="download" size={16} />
                <span className="ep-sr-only">Download the poster</span>
              </a>
            </>
          ) : null}
          <a
            className="ep-btn ep-btn--ghost ep-btn--sm"
            href={`https://wa.me/?text=${encodeURIComponent(`${shareText} ${url}`)}`}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="send" size={16} /> WhatsApp
          </a>
          <a
            className="ep-btn ep-btn--ghost ep-btn--sm"
            href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="send" size={16} /> LinkedIn
          </a>
        </div>
        <p className="ep-field__help" role="status" aria-live="polite" style={{ margin: 0 }}>
          {copied ?? ''}
        </p>
      </div>
    </div>
  );
}
