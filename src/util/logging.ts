/**
 * Safe logger for gtkrypt.
 *
 * Outputs timestamped, level-prefixed messages to stderr.
 * The API intentionally accepts only a pre-formatted message string
 * to prevent accidental logging of passphrases, keys, or plaintext.
 *
 * Verbosity is controlled by the GTKRYPT_LOG_LEVEL environment variable
 * (values: debug, info, warn, error). Defaults to "info".
 */

import GLib from "gi://GLib";

/** Supported log levels ordered by increasing severity. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Numeric severity for each log level (higher = more severe). */
const LEVEL_SEVERITY: Readonly<Record<LogLevel, number>> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** All valid log level strings for validation. */
const VALID_LEVELS = new Set<string>(["debug", "info", "warn", "error"]);

/**
 * Determine the minimum log level from the environment.
 *
 * Reads GTKRYPT_LOG_LEVEL once and caches the result. Falls back
 * to "info" if the variable is unset or contains an invalid value.
 */
function resolveMinLevel(): LogLevel {
  const envValue = GLib.getenv("GTKRYPT_LOG_LEVEL");
  if (envValue !== null) {
    const normalized = envValue.toLowerCase().trim();
    if (VALID_LEVELS.has(normalized)) {
      return normalized as LogLevel;
    }
  }
  return "info";
}

let cachedMinLevel: LogLevel | null = null;

function getMinLevel(): LogLevel {
  if (cachedMinLevel === null) {
    cachedMinLevel = resolveMinLevel();
  }
  return cachedMinLevel;
}

/**
 * Format an ISO-8601 timestamp for the current moment.
 */
function timestamp(): string {
  const now = GLib.DateTime.new_now_local();
  if (now === null) {
    return new Date().toISOString();
  }
  return now.format("%Y-%m-%dT%H:%M:%S") ?? new Date().toISOString();
}

/**
 * Log a message to stderr with a timestamp and level prefix.
 *
 * Messages below the configured minimum level are silently dropped.
 * This function intentionally accepts only a single message string
 * -- never pass sensitive data such as passphrases, keys, or file
 * contents as the message.
 *
 * @param level - Severity of the message.
 * @param message - Human-readable log message (must not contain secrets).
 */
export function log(level: LogLevel, message: string): void {
  const minLevel = getMinLevel();
  if (LEVEL_SEVERITY[level] < LEVEL_SEVERITY[minLevel]) {
    return;
  }

  const prefix = level.toUpperCase().padEnd(5);
  const line = `[${timestamp()}] ${prefix} ${message}`;
  printerr(line);
}
