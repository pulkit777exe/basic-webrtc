interface HandRaiseProps {
  isRaised: boolean;
  onToggle: () => void;
}

export function HandRaise({ isRaised, onToggle }: HandRaiseProps) {
  return (
    <button
      onClick={onToggle}
      className={`p-4 rounded-full ${isRaised ? 'bg-yellow-600' : 'bg-gray-700 hover:bg-gray-600'}`}
      title={isRaised ? 'Lower Hand' : 'Raise Hand'}
    >
      <span className="text-2xl">✋</span>
    </button>
  );
}