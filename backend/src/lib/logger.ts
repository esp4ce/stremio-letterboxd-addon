import pino from 'pino';
import { config } from '../config/index.js';

const redactPaths = [
  'password',
  'client_secret',
  'access_token',
  'refresh_token',
  'encrypted_refresh_token',
  'req.headers.authorization',
  'req.body.password',
  'req.body.client_secret',
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
