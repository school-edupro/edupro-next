'use client';
import { useState } from 'react';
import { LiveCamera } from './LiveCamera';

/** The live photo of the person collecting, kept in a hidden field of the hand-over form. */
export function HandoverPhoto() {
  const [photo, setPhoto] = useState('');
  return (
    <>
      <LiveCamera value={photo} onChange={setPhoto} />
      <input type="hidden" name="photo" value={photo} />
    </>
  );
}
