import { logger } from './logger';

/**
 * Process-level safety net.
 *
 * This module is imported *first* by server.ts, so the handlers below are
 * registered before the rest of the module graph is evaluated. That ordering is
 * the point: `lib/rate-limiters` constructs its stores at import time and those
 * constructors kick off Redis calls as fire-and-forget promises, which can
 * reject while other modules are still loading. With no handler attached yet,
 * Bun treats that as fatal — it prints a crash report and exits, taking the
 * server (and every open call) with it. Registering here closes that window.
 */

type ShutdownHook = (signal: string) => void;

let shutdownHook: ShutdownHook | null = null;

/** server.ts calls this once `gracefulShutdown` exists. */
export function setShutdownHook(hook: ShutdownHook): void {
  shutdownHook = hook;
}

// Nothing in this process should leave a promise rejection unobserved: an
// unhandled rejection in Bun/Node terminates the process by default, taking
// every open call with it. Log it, keep serving.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { err: String(reason) });
});

process.on('uncaughtException', (err) => {
  // Shut down rather than carry on. Once an exception has escaped, the process
  // state is undefined — a half-applied DB write, a poisoned connection pool, a
  // half-mutated room roster — and a video server that keeps accepting calls on
  // top of that can hand a participant a corrupted room while reporting itself
  // healthy. Logging and continuing (which is right for a rejection) is not right
  // here: the platform restarts us, every open call is told 1001, and clients
  // reconnect to a process that is actually consistent.
  logger.error('Uncaught exception, shutting down', { err: String(err) });
  if (shutdownHook) {
    shutdownHook('uncaughtException');
  } else {
    // The hook is only wired from server.ts's body; an exception before that
    // point has no graceful path to take.
    process.exit(1);
  }
});
