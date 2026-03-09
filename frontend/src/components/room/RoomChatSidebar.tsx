import { useState, useRef, useEffect } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { useAtomValue } from 'jotai';
import { canManageAtom, chatAtom, chatReactionsAtom, pinnedChatMessageAtom, reactionsEnabledAtom } from '@/store/atoms';
import { WSManager } from '@/lib/ws-manager';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ArrowDown, Pin, X } from 'lucide-react';

function renderFormattedMessage(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|_[^_]+_|https?:\/\/\S+)/g);
  return parts.map((part, index) => {
    if (!part) return null;
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={`${part}-${index}`} className="rounded bg-black/25 px-1 py-0.5 font-mono text-[12px]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('_') && part.endsWith('_')) {
      return <em key={`${part}-${index}`}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith('http://') || part.startsWith('https://')) {
      return (
        <a
          key={`${part}-${index}`}
          href={part}
          target="_blank"
          rel="noreferrer"
          className="underline decoration-cyan-300 underline-offset-2"
        >
          {part}
        </a>
      );
    }
    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

export function RoomChatSidebar({ onClose }: { onClose: () => void }) {
  const [input, setInput] = useState('');
  const messages = useAtomValue(chatAtom);
  const pinnedMessage = useAtomValue(pinnedChatMessageAtom);
  const chatReactions = useAtomValue(chatReactionsAtom);
  const reactionsEnabled = useAtomValue(reactionsEnabledAtom);
  const canManage = useAtomValue(canManageAtom);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
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
    const frame = requestAnimationFrame(() => {
      const el = listRef.current;
      if (!el) return;
      const threshold = 80;
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
      if (isNearBottom) {
        el.scrollTop = el.scrollHeight;
        setShowJumpToLatest(false);
        setNewMessageCount(0);
        return;
      }
      setShowJumpToLatest(true);
      setNewMessageCount((count) => count + 1);
    });
    return () => cancelAnimationFrame(frame);
  }, [messages.length]);

  function scrollToLatest() {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setShowJumpToLatest(false);
    setNewMessageCount(0);
  }

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
      {pinnedMessage && (
        <div className="mx-4 mt-4 rounded-xl border border-cyan-400/35 bg-cyan-500/10 px-3 py-2 sm:mx-5">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-cyan-300">
            <Pin className="h-3.5 w-3.5" />
            Pinned
          </div>
          <p className="text-xs text-[var(--room-text)]">{pinnedMessage.text}</p>
          <p className="mt-1 text-[10px] text-[var(--room-muted)]">by {pinnedMessage.authorName}</p>
        </div>
      )}
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
        {messages.map((m) => (
          <div
            key={m.id}
            className={m.type === 'system' ? 'rounded-xl bg-[var(--room-elevated)] px-3 py-2 text-center text-xs text-[var(--room-muted)]' : 'group'}
          >
            {m.type === 'system' ? (
              m.content
            ) : (
              <div className="rounded-xl bg-[var(--room-elevated)] px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-cyan-300">{m.userName ?? 'User'}</span>
                  <div className="flex items-center gap-1">
                    {reactionsEnabled && (
                      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        {['👍', '❤️', '😂'].map((emoji) => (
                          <Button
                            key={emoji}
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="h-6 w-6 rounded-full text-sm"
                            onClick={() => WSManager.send({ type: 'chat_reaction', messageId: m.id, emoji })}
                            title={`React with ${emoji}`}
                          >
                            {emoji}
                          </Button>
                        ))}
                      </div>
                    )}
                    {canManage && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="h-6 w-6 rounded-full opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={() => {
                          WSManager.send({
                            type: 'chat_pin',
                            messageId: m.id,
                            text: m.content,
                            authorName: m.userName ?? 'User',
                          });
                        }}
                        title="Pin message"
                      >
                        <Pin className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-sm text-[var(--room-text)]">{renderFormattedMessage(m.content)}</p>
                {reactionsEnabled && chatReactions[m.id] && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {Object.entries(chatReactions[m.id]).map(([emoji, count]) => (
                      <span
                        key={`${m.id}-${emoji}`}
                        className="inline-flex items-center gap-1 rounded-full border border-[var(--room-border)] bg-black/20 px-2 py-0.5 text-[11px] text-[var(--room-text)]"
                      >
                        <span>{emoji}</span>
                        <span>{count}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {showJumpToLatest && (
        <div className="pointer-events-none absolute bottom-24 right-6 z-10 sm:bottom-28">
          <Button
            type="button"
            size="sm"
            className="pointer-events-auto h-8 rounded-full bg-cyan-500/90 px-3 text-white hover:bg-cyan-500"
            onClick={scrollToLatest}
          >
            <ArrowDown className="mr-1 h-3.5 w-3.5" />
            {newMessageCount > 0 ? `${newMessageCount} new` : 'New messages'}
          </Button>
        </div>
      )}
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
