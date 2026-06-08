import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';

interface ErrorFallbackProps {
  onReset: () => void;
}

function ErrorFallback({ onReset }: ErrorFallbackProps) {
  const navigate = useNavigate();
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-(--room-border) bg-(--room-surface) px-4 py-2">
      <span className="text-xs text-(--room-muted)">Controls error</span>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs"
        onClick={onReset}
      >
        Retry
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="h-7 w-7 text-rose-400 hover:text-rose-300"
        onClick={() => navigate('/dashboard', { replace: true })}
      >
        <LogOut className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ControlsErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Controls] Error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return <ErrorFallback onReset={() => this.setState({ hasError: false })} />;
    }

    return this.props.children;
  }
}
