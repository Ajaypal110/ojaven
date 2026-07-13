import pino from "pino";

/**
 * Shared across packages/server and any Next.js server code (webhooks,
 * route handlers) that needs structured logging. Never use console.log —
 * this is the one logger.
 *
 * Deliberately plain JSON output, no pino-pretty transport — pino-pretty's
 * transport is worker-thread-based, and that worker thread can't reliably
 * resolve its own script when webpack-bundled by Next.js ("Cannot find
 * module '...worker.js'" / "the worker has exited"). This hit in practice
 * inside app/api/webhooks/clerk/route.ts: a logger.error() call in a catch
 * block crashed the process instead of just logging, turning an expected,
 * handled error into an unhandled one. Next's documented fix
 * (experimental.serverComponentsExternalPackages) did NOT resolve it here.
 * For a webhook handler, reliability matters more than colorized terminal
 * output — if you want pretty output for local dev, pipe the dev script
 * through pino-pretty at the shell level instead (`next dev | pino-pretty`),
 * which keeps the transport out of the bundled process entirely.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
});
