import pino from 'pino';
import { config } from '../config/index.js';

// fast-redact paths are matched exactly, and `*` spans a single level only — so each
// secret needs both its top-level and one-level-nested form. Payloads are hand-built
// everywhere, so these cover whole objects passed as a single field (`{ result }`).
export const redactPaths = [
  'password',
  '*.password',
  'client_secret',
  '*.client_secret',
  'access_token',
  '*.access_token',
  'refresh_token',
  '*.refresh_token',
  'encrypted_refresh_token',
  '*.encrypted_refresh_token',
  'totp',
  '*.totp',
  'emailAddress',
  '*.emailAddress',
  '*.*.emailAddress',
  'err.body',
  'error.body',
  'headers.authorization',
  'headers.cookie',
];

export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: redactPaths,
    censor: '[REDACTED]',
  },
  transport:
    process.env['NODE_ENV'] !== 'production'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
});

export function createChildLogger(name: string) {
  return logger.child({ module: name });
}
