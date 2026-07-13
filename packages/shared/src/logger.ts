import pino from "pino";

/**
 * Shared across packages/server and any Next.js server code (webhooks,
 * route handlers) that needs structured logging. Never use console.log —
 * this is the one logger.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});
