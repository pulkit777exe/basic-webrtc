import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App crashed', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center px-4">
          <Card className="w-full max-w-md rounded-2xl border-[var(--meet-border)] bg-[var(--meet-surface)]/90 py-0">
            <CardHeader className="p-6 pb-2">
              <CardTitle>App Error</CardTitle>
              <CardDescription>Something unexpected happened. Reload to continue.</CardDescription>
            </CardHeader>
            <CardContent className="p-6 pt-3">
              <Button
                className="w-full rounded-xl bg-[var(--meet-accent)] text-white hover:bg-blue-600"
                onClick={() => window.location.reload()}
              >
                Reload app
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
