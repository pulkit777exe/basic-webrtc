import { useState, useEffect } from 'react';

interface FloatingReaction {
  id: string;
  emoji: string;
  x: number;
}

interface ReactionsProps {
  onSendReaction: (emoji: string) => void;
}

const EMOJIS = ['👍', '❤️', '😂', '🎉', '👏', '🔥'];

export function Reactions({ onSendReaction }: ReactionsProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);

  useEffect(() => {
    const interval = setInterval(() => {
      setFloatingReactions(prev => prev.filter(r => Date.now() - parseInt(r.id) < 3000));
    }, 100);

    return () => clearInterval(interval);
  }, []);

  const handleReaction = (emoji: string) => {
    onSendReaction(emoji);
    addFloatingReaction(emoji);
    setShowPicker(false);
  };

  const addFloatingReaction = (emoji: string) => {
    const id = Date.now().toString();
    const x = Math.random() * 80 + 10; // 10-90% of width
    setFloatingReactions(prev => [...prev, { id, emoji, x }]);
  };

  return (
    <>
      <div className="fixed inset-0 pointer-events-none z-40">
        {floatingReactions.map(reaction => (
          <div
            key={reaction.id}
            className="absolute bottom-20 text-4xl animate-float-up"
            style={{ left: `${reaction.x}%` }}
          >
            {reaction.emoji}
          </div>
        ))}
      </div>

      <div className="relative">
        {showPicker && (
          <div className="absolute bottom-16 left-0 bg-gray-800 rounded-lg p-3 shadow-xl flex gap-2">
            {EMOJIS.map(emoji => (
              <button
                key={emoji}
                onClick={() => handleReaction(emoji)}
                className="text-3xl hover:scale-125 transition-transform"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => setShowPicker(!showPicker)}
          className="p-4 rounded-full bg-gray-700 hover:bg-gray-600"
          title="Send Reaction"
        >
          <span className="text-2xl">😊</span>
        </button>
      </div>
    </>
  );
}