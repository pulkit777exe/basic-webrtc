interface HandRaiseProps {
  isRaised: boolean;
  onToggle: () => void;
}

export function HandRaise({ isRaised, onToggle }: HandRaiseProps) {
  return (
    <button
      onClick={onToggle}
      className={`p-4 rounded-full transition-all ${
        isRaised 
          ? 'bg-gradient-to-r from-yellow-500 to-orange-500 shadow-lg shadow-yellow-500/25' 
          : 'bg-white/5 border border-purple-500/30 hover:bg-purple-500/10 hover:border-purple-500/50'
      }`}
      title={isRaised ? 'Lower Hand' : 'Raise Hand'}
    >
      <span className="text-2xl"></span>
    </button>
  );
}