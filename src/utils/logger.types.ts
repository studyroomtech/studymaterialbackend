// Types for the backend structured logger.
//
// The logger emits structured, single-line JSON records carrying an ISO 8601
// timestamp so that unexpected server errors and other notable events are
// recorded with a machine-readable time (Req 8.5, Req 9.4, Req 12.14).

/**
 * The severity levels supported by the logger. `info` for routine events,
 * `warn` for recoverable anomalies, and `error` for failures (including the
 * unexpected server errors that MUST be logged with a timestamp, Req 8.5).
 */
export type LogLevel = 'info' | 'warn' | 'error';

/**
 * Arbitrary structured context merged into a log record (for example an error
 * code, request path, or serialized error details). Values are serialized as
 * JSON; callers MUST NOT place secrets here.
 */
export interface LogFields {
  [key: string]: unknown;
}

/**
 * A single structured log record as emitted by the logger. `timestamp` is an
 * ISO 8601 string identifying when the event was logged (Req 8.5).
 */
export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  [key: string]: unknown;
}
