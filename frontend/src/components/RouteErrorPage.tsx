import { isRouteErrorResponse, useRouteError, Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function RouteErrorPage() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Something went wrong.';

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md rounded-2xl border-[var(--meet-border)] bg-[var(--meet-surface)]/90 py-0">
        <CardHeader className="p-6 pb-2">
          <CardTitle>Unexpected Error</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2 p-6 pt-3">
          <Button asChild className="flex-1 rounded-xl bg-[var(--meet-accent)] text-white hover:bg-blue-600">
            <Link to="/">Go home</Link>
          </Button>
          <Button variant="outline" className="flex-1 rounded-xl border-[var(--meet-border)]" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
