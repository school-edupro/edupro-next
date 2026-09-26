'use client';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface ToastMessage {
  id: number;
  tone: ToastTone;
  title: string;
  detail?: string;
}

interface ToastApi {
  push: (tone: ToastTone, title: string, detail?: string) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Bottom-right stack, 250 ms fade, auto-dismiss after 6 s except danger, which stays until dismissed. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastMessage[]>([]);
  const dismiss = useCallback((id: number) => setItems((prev) => prev.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (tone: ToastTone, title: string, detail?: string) => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      const item: ToastMessage = detail === undefined ? { id, tone, title } : { id, tone, title, detail };
      setItems((prev) => [...prev, item]);
      if (tone !== 'danger') setTimeout(() => dismiss(id), 6000);
    },
    [dismiss],
  );
  const api = useMemo(() => ({ push, dismiss }), [push, dismiss]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="ep-toast-stack" role="region" aria-label="Notifications" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`ep-toast ep-toast--${t.tone}`} role={t.tone === 'danger' ? 'alert' : 'status'}>
            <div className="ep-toast__text">
              <strong>{t.title}</strong>
              {t.detail ? <div>{t.detail}</div> : null}
            </div>
            <button type="button" className="ep-toast__close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}
