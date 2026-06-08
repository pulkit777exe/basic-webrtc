import { Component, type ErrorInfo, type ReactNode } from 'react';
import { MessageSquare } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ChatErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Chat] Error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center">
            <MessageSquare className="h-8 w-8 text-(--room-muted)" />
            <div>
              <p className="text-sm font-medium text-(--room-text)">Chat unavailable</p>
              <p className="text-xs text-(--room-muted)">Other features still work</p>
            </div>
            <button
              onClick={() => this.setState({ hasError: false })}
              className="text-xs text-(--room-muted) underline hover:text-(--room-text)"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
