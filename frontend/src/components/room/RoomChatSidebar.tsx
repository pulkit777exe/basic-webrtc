import { useState, useRef, useEffect } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { useAtomValue } from 'jotai';
import { chatAtom } from '@/store/atoms';
import { WSManager } from '@/lib/ws-manager';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { X } from 'lucide-react';

export function RoomChatSidebar({ onClose }: { onClose: () => void }) {
  const [input, setInput] = useState('');
  const messages = useAtomValue(chatAtom);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const isMobile = window.matchMedia('(max-width: 639px)').matches;
      gsap.fromTo(panelRef.current, isMobile ? { y: 420 } : { x: 360 }, isMobile ? { y: 0, duration: 0.35, ease: 'power3.out' } : { x: 0, duration: 0.35, ease: 'power3.out' });
    },
    { scope: panelRef }
  );

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  function send() {
    const text = input.trim();
    if (!text) return;
    WSManager.send({ type: 'chat', content: text, timestamp: Date.now() });
    setInput('');
  }

  return (
    <div
      ref={panelRef}
      className="fixed inset-x-0 bottom-0 z-30 flex h-[70vh] flex-col border-t border-[var(--room-border)] bg-[var(--room-surface)] backdrop-blur-xl sm:inset-y-0 sm:left-auto sm:h-full sm:w-[360px] sm:border-l sm:border-t-0"
    >
      <div className="flex items-center justify-between p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-[var(--room-text)]">Chat</h3>
          <Badge variant="secondary" className="h-5 rounded-full border-0 bg-[var(--room-elevated)] px-2 text-[10px] text-[var(--room-text)] hover:bg-[var(--room-elevated)]">
            {messages.length}
          </Badge>
        </div>
        <Button variant="ghost" size="icon-sm" className="rounded-full text-[var(--room-text)] hover:bg-[var(--room-elevated)] hover:text-[var(--room-text)]" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <Separator className="bg-[var(--room-border)]" />
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
        {messages.map((m) => (
          <div
            key={m.id}
            className={m.type === 'system' ? 'rounded-xl bg-[var(--room-elevated)] px-3 py-2 text-center text-xs text-[var(--room-muted)]' : ''}
          >
            {m.type === 'system' ? (
              m.content
            ) : (
              <div className="rounded-xl bg-[var(--room-elevated)] px-3 py-2">
                <span className="text-[11px] font-medium text-cyan-300">{m.userName ?? 'User'}</span>
                <p className="mt-1 text-sm text-[var(--room-text)]">{m.content}</p>
              </div>
            )}
          </div>
        ))}
      </div>
      <Separator className="bg-[var(--room-border)]" />
      <div className="p-4 sm:p-5">
        <Textarea
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
          rows={2}
          className="mb-2 min-h-20 resize-none rounded-xl border-[var(--room-border)] bg-[var(--room-elevated)] text-[var(--room-text)] placeholder:text-[var(--room-muted)]"
        />
        <Button
          variant="secondary"
          size="sm"
          className="h-10 w-full rounded-xl bg-cyan-500/85 text-white hover:bg-cyan-500"
          onClick={send}
        >
          Send
        </Button>
      </div>
    </div>
  );
}
