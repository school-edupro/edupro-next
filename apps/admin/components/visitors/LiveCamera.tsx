'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * A photo taken live with the camera of the gate computer or phone (no file can be chosen). The frame is
 * made small (about 320 px, JPEG) and handed to the form as a data URL.
 */
export function LiveCamera({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [on, setOn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stop = () => {
    stream.current?.getTracks().forEach((x) => x.stop());
    stream.current = null;
    setOn(false);
  };
  useEffect(() => stop, []);

  async function open() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia)
      return setError('This browser cannot open the camera.');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      onChange('');
      setOn(true);
      requestAnimationFrame(() => {
        if (video.current) {
          video.current.srcObject = stream.current;
          void video.current.play();
        }
      });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      setError(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'The camera is blocked for this page. Click the lock or camera icon next to the address, choose Allow for Camera, then press Open camera again.'
          : name === 'NotFoundError' || name === 'OverconstrainedError'
            ? 'No camera was found on this computer.'
            : 'The camera could not be opened. Close other apps using it and try again.',
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
    onChange(canvas.toDataURL('image/jpeg', 0.8));
    stop();
  }

  return (
    <div className="ep-field">
      <span className="ep-field__label" id="vc-label">
        Photo (taken now with the camera)
      </span>
      {on ? (
        <video
          ref={video}
          className="ep-appt__camera"
          playsInline
          muted
          aria-label="Camera preview"
        />
      ) : null}
      {value ? <img className="ep-appt__photo" src={value} alt="The visitor’s photo" /> : null}
      <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
        {on ? (
          <>
            <button type="button" className="ep-btn ep-btn--primary ep-btn--sm" onClick={take}>
              Take photo
            </button>
            <button type="button" className="ep-btn ep-btn--ghost ep-btn--sm" onClick={stop}>
              Close camera
            </button>
          </>
        ) : (
          <button
            type="button"
            className="ep-btn ep-btn--secondary ep-btn--sm"
            aria-describedby="vc-label"
            onClick={() => void open()}
          >
            {value ? 'Retake' : 'Open camera'}
          </button>
        )}
      </div>
      {error ? (
        <span className="ep-field__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
