import pino from 'pino';
import { config } from '@/config';

/**
 * Structured logging. Person level data must never be logged: the ledger is the
 * record of what we know about a person, and a log file is not a lawful place
 * to duplicate it. Log identifiers, not attributes.
 */
export const logger = pino({
  level: config.LOG_LEVEL,
  base: { service: 'searchical' },
  redact: {
    paths: ['*.email', '*.value', '*.displayName', '*.full_name', '*.raw'],
    censor: '[redacted]',
  },
});

export type Logger = typeof logger;
