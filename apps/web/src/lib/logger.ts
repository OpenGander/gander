import pino from 'pino';

// In development, use pino-pretty as a synchronous destination stream
// instead of pino's `transport` option. The transport option spawns a
// worker_threads thread that gets killed when Next.js recycles its API
// route workers, causing "the worker has exited" crashes on subsequent
// logger calls.
function createLogger() {
  const opts: pino.LoggerOptions = {
    name: 'opengander-web',
    level: process.env.LOG_LEVEL || 'info',
  };

  if (process.env.NODE_ENV !== 'production') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pretty = require('pino-pretty');
      return pino(opts, pretty({ colorize: true }));
    } catch {
      // pino-pretty not installed — fall through to plain JSON
    }
  }

  return pino(opts);
}

const logger = createLogger();

export default logger;
