'use client';
/** The MobiAI chat window on every page of this website but the full Assistant page (docs/design/92 phase C). */
import { AssistantWindow } from '@edupro/ui';
import { usePathname } from 'next/navigation';
import { windowAsk, windowConversation, windowStart } from '@/lib/assistant-window';

export function AssistantDock({ lang }: { lang: 'en' | 'hi' }) {
  const path = usePathname();
  if (path === '/assistant' || path.startsWith('/assistant?')) return null;
  return (
    <AssistantWindow
      lang={lang}
      fullPageHref="/assistant"
      start={windowStart}
      ask={windowAsk}
      conversation={windowConversation}
    />
  );
}
