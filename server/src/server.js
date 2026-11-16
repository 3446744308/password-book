import app from './app.js';
import { config } from './config.js';
import { logger, flushLogs } from './logger.js';
import { acquireLock, releaseLock } from './storage/lock.js';

/** 单实例锁：data 目录禁止多进程并发写（docs/01 §4.7） */
try {
  await acquireLock();
} catch (err) {
  logger.error('lock.failed', { message: err.message });
  process.exit(1);
}

const server = app.listen(config.port, config.host, () => {
  logger.info('server.started', {
    url: `http://${config.host}:${config.port}`,
    mode: config.authMode,
    dataDir: config.dataDir,
    env: config.isProd ? 'production' : 'development',
  });
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('server.stopping', { signal });
  server.close(async () => {
    await releaseLock();
    await flushLogs();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', async (err) => {
  logger.error('uncaught.exception', { message: err.message, stack: err.stack });
  await releaseLock();
  await flushLogs();
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled.rejection', { reason: String(reason) });
});
