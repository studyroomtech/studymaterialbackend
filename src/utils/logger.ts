// Structured backend logger.
//
// Emits single-line JSON log records, each carrying an ISO 8601 `timestamp`, so
// that unexpected server errors and persistence failures are recorded with a
// machine-readable time as required by Req 8.5 (and reused for Req 9.4 / 12.14).
//
// The logger deliberately exposes plain functions rather than a stateful
// instance so it can be imported and called from any layer (middleware,
// services, startup) without wiring. Records are written to the standard
// streams: `error` -> stderr, everything else -> stdout.

import type { LogEntry, LogFields, LogLevel } from './logger.types';

/**
 * Build a structured log record for the given level, stamping it with the
 * current time in ISO 8601 format (Req 8.5). Any caller-supplied `fields` are
 * merged in; the reserved keys (`level`, `message`, `timestamp`) always win so
 * the record shape stays stable.
 */
function buildEntry(
  level: LogLevel,
  message: string,
  fields?: LogFields,
): LogEntry {
  return {
    ...(fields ?? {}),
    level,
    message,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Serialize and write a log record to the appropriate stream. Serialization is
 * guarded so that a non-serializable field (for example a circular reference)
 * never throws out of a logging call.
 */
function write(entry: LogEntry): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(entry);
  } catch {
    serialized = JSON.stringify({
      level: entry.level,
      message: entry.message,
      timestamp: entry.timestamp,
      note: 'log fields omitted: not serializable',
    });
  }

  if (entry.level === 'error') {
    console.error(serialized);
  } else {
    console.log(serialized);
  }
}

/**
 * Log an informational event with an ISO 8601 timestamp.
 */
export function logInfo(message: string, fields?: LogFields): void {
  write(buildEntry('info', message, fields));
}

/**
 * Log a warning (a recoverable anomaly) with an ISO 8601 timestamp.
 */
export function logWarn(message: string, fields?: LogFields): void {
  write(buildEntry('warn', message, fields));
}

/**
 * Log an error with an ISO 8601 timestamp. Used to record unexpected server
 * errors (Req 8.5) and persistence failures (Req 9.4, Req 12.14). Callers pass
 * error details via `fields`; secrets and internal identifiers destined for the
 * client MUST NOT be logged here.
 */
export function logError(message: string, fields?: LogFields): void {
  write(buildEntry('error', message, fields));
}
