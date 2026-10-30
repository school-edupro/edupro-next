'use client';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { addPortfolioPhoto } from '@/lib/hpc-actions';

/** A portfolio photo for a child's progress card (docs/design/65, part 5): PNG or JPEG up to 1 MB. */
export function PortfolioUpload({
  examId,
  classSectionId,
  studentId,
  items,
}: {
  examId: string;
  classSectionId: string;
  studentId: string;
  items: Array<{ id: string; name: string }>;
}) {
  const t = useTranslations('examHub.upload');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const [indicatorId, setIndicatorId] = useState('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const read = (f: File) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
      r.onerror = () => reject(new Error(t('unreadablePhoto')));
      r.readAsDataURL(f);
    });
  return (
    <form
      className="ep-rp__act"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setMsg(null);
          if (!file) return setMsg({ tone: 'danger', text: t('choosePhoto') });
          if (!['image/png', 'image/jpeg'].includes(file.type))
            return setMsg({ tone: 'danger', text: t('pngJpeg') });
          if (file.size > 1_000_000) return setMsg({ tone: 'danger', text: t('tooLarge') });
          const out = await addPortfolioPhoto({
            examId,
            classSectionId,
            studentId,
            caption: caption.trim(),
            indicatorId: indicatorId || null,
            contentType: file.type as 'image/png' | 'image/jpeg',
            base64: await read(file),
          });
          if (out.ok) {
            setMsg({ tone: 'success', text: t('added') });
            setCaption('');
            setFile(null);
            router.refresh();
          } else setMsg({ tone: 'danger', text: out.error });
        });
      }}
    >
      <div className="ep-rp__row">
        <label className="ep-field">
          <span className="ep-field__label">{t('photoLabel')}</span>
          <input
            className="ep-input"
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">{t('caption')}</span>
          <input
            className="ep-input"
            value={caption}
            maxLength={200}
            onChange={(e) => setCaption(e.target.value)}
          />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">{t('shows')}</span>
          <select
            className="ep-select"
            value={indicatorId}
            onChange={(e) => setIndicatorId(e.target.value)}
          >
            <option value="">-</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="ep-form-actions">
        <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm" disabled={pending}>
          {t('addPhoto')}
        </button>
      </div>
      {msg ? (
        <div
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
        >
          {msg.text}
        </div>
      ) : null}
    </form>
  );
}
