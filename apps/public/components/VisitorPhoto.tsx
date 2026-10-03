'use client';
import { useState } from 'react';

/**
 * The visitor's photo for the pass: taken with the phone camera or picked from the gallery, made small
 * in the browser (about 320 px, JPEG) and posted with the form as text, so no file ever leaves at full size.
 */
export function VisitorPhoto({ lang, required }: { lang: 'en' | 'hi'; required: boolean }) {
  const t = (en: string, hi: string) => (lang === 'hi' ? hi : en);
  const [photo, setPhoto] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    setError(null);
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      setPhoto(canvas.toDataURL('image/jpeg', 0.8));
    } catch {
      setPhoto('');
      setError(
        t(
          'That file is not a photo. Please choose a picture.',
          'यह फ़ोटो नहीं है। कृपया चित्र चुनें।',
        ),
      );
    }
  }

  return (
    <div className="ep-field">
      <label className="ep-field__label" htmlFor="v-photo">
        {t('Your photo', 'आपकी फ़ोटो')}
        {required ? ' *' : ` (${t('optional', 'वैकल्पिक')})`}
      </label>
      <input
        id="v-photo"
        type="file"
        accept="image/*"
        capture="user"
        className="ep-input"
        // the small copy below is what is posted; the picker itself is only required until a photo is set
        required={required && !photo}
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      <input type="hidden" name="photo" value={photo} />
      {photo ? (
        <img
          className="ep-appt__photo"
          style={{ marginTop: 'var(--sp-2)' }}
          src={photo}
          alt={t('Your photo as it will show on the pass', 'पास पर दिखने वाली आपकी फ़ोटो')}
        />
      ) : null}
      {error ? (
        <span className="ep-field__error" role="alert">
          {error}
        </span>
      ) : (
        <span className="ep-field__help">
          {t('Shown on your pass and to the gate.', 'आपके पास पर और गेट पर दिखेगी।')}
        </span>
      )}
    </div>
  );
}
