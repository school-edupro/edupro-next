'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * The visitor's photo for the pass, taken live with the device camera (no file can be chosen, so an old
 * or someone else's picture cannot be uploaded). The frame is made small in the browser (about 320 px,
 * JPEG) and posted with the form as text.
 */
export function VisitorCamera({ lang, required }: { lang: 'en' | 'hi'; required: boolean }) {
  const t = (en: string, hi: string) => (lang === 'hi' ? hi : en);
  const video = useRef<HTMLVideoElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [on, setOn] = useState(false);
  const [photo, setPhoto] = useState('');
  const [error, setError] = useState<string | null>(null);

  const stop = () => {
    stream.current?.getTracks().forEach((x) => x.stop());
    stream.current = null;
    setOn(false);
  };
  useEffect(() => stop, []);

  // a required photo holds the form back (the server checks it again)
  useEffect(() => {
    const form = holder.current?.closest('form');
    if (!form || !required) return;
    const guard = (e: Event) => {
      if (photo) return;
      e.preventDefault();
      e.stopPropagation();
      setError(t('Please take your photo first.', 'कृपया पहले अपनी फ़ोटो लें।'));
      holder.current?.scrollIntoView({ block: 'center' });
    };
    form.addEventListener('submit', guard, true);
    return () => form.removeEventListener('submit', guard, true);
  }, [photo, required, lang]);

  async function open() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia)
      return setError(
        t(
          'This browser cannot open the camera. Please use your phone, or book at the front desk.',
          'यह ब्राउज़र कैमरा नहीं खोल सकता। कृपया अपने फ़ोन से करें या फ्रंट डेस्क पर बुक करें।',
        ),
      );
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      setPhoto('');
      setOn(true);
      // the video element exists once "on" has rendered
      requestAnimationFrame(() => {
        if (video.current) {
          video.current.srcObject = stream.current;
          void video.current.play();
        }
      });
    } catch {
      setError(
        t(
          'The camera could not be opened. Allow the camera for this page and try again, or book at the front desk.',
          'कैमरा नहीं खुल सका। इस पेज के लिए कैमरे की अनुमति दें और फिर कोशिश करें, या फ्रंट डेस्क पर बुक करें।',
        ),
      );
    }
  }

  function take() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const scale = Math.min(1, 320 / Math.max(v.videoWidth, v.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext('2d')!.drawImage(v, 0, 0, canvas.width, canvas.height);
    setPhoto(canvas.toDataURL('image/jpeg', 0.8));
    setError(null);
    stop();
  }

  return (
    <div className="ep-field" ref={holder}>
      <span className="ep-field__label" id="v-photo-label">
        {t('Your photo (taken now with the camera)', 'आपकी फ़ोटो (अभी कैमरे से ली जाएगी)')}
        {required ? ' *' : ` (${t('optional', 'वैकल्पिक')})`}
      </span>
      <input type="hidden" name="photo" value={photo} />
      {on ? (
        <video
          ref={video}
          className="ep-appt__camera"
          playsInline
          muted
          aria-label={t('Camera preview', 'कैमरा पूर्वावलोकन')}
        />
      ) : null}
      {photo ? (
        <img
          className="ep-appt__photo"
          src={photo}
          alt={t('Your photo as it will show on the pass', 'पास पर दिखने वाली आपकी फ़ोटो')}
        />
      ) : null}
      <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
        {on ? (
          <>
            <button type="button" className="ep-btn ep-btn--primary ep-btn--sm" onClick={take}>
              {t('Take photo', 'फ़ोटो लें')}
            </button>
            <button type="button" className="ep-btn ep-btn--ghost ep-btn--sm" onClick={stop}>
              {t('Close camera', 'कैमरा बंद करें')}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="ep-btn ep-btn--secondary ep-btn--sm"
            aria-describedby="v-photo-label"
            onClick={() => void open()}
          >
            {photo ? t('Retake', 'दोबारा लें') : t('Open camera', 'कैमरा खोलें')}
          </button>
        )}
      </div>
      {error ? (
        <span className="ep-field__error" role="alert">
          {error}
        </span>
      ) : (
        <span className="ep-field__help">
          {t(
            'Shown on your visitor card and to the gate. A picture from the gallery cannot be used.',
            'आपके आगंतुक कार्ड पर और गेट पर दिखेगी। गैलरी की तस्वीर नहीं ली जा सकती।',
          )}
        </span>
      )}
    </div>
  );
}
