'use client';
import { useState } from 'react';
import { LiveCamera } from '@/components/visitors/LiveCamera';

/** The visitor's live photo at the gate, kept in a hidden field of the form. */
export function VisitPhoto() {
  const [photo, setPhoto] = useState('');
  return (
    <>
      <LiveCamera value={photo} onChange={setPhoto} />
      <input type="hidden" name="photo" value={photo} />
    </>
  );
}
