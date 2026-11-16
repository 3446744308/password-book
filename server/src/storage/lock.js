import fs from 'node:fs/promises';
import { paths } from './paths.js';
import { logger } from '../logger.js';

/**
 * 单实例锁（docs/01 §4.7 / 风险表）：
 * 启动时写 data/.server.lock（含 pid），检测到存活进程即拒绝启动；退出时清理。
 */

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

export async function acquireLock() {
  try {
    const raw = await fs.readFile(paths.lockFile, 'utf8');
    const info = JSON.parse(raw);
    if (info.pid && info.pid !== process.pid && pidAlive(info.pid)) {
      throw new Error(
        `另一个密码本实例正在运行（pid=${info.pid}），请勿同时启动多个实例写同一 data 目录`,
      );
    }
    logger.warn('lock.stale', { pid: info.pid });
  } catch (err) {
    if (err.code !== 'ENOENT' && !(err instanceof SyntaxError)) throw err;
  }
  await fs.mkdir(paths.root, { recursive: true });
  await fs.writeFile(
    paths.lockFile,
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2),
    'utf8',
  );
}

export async function releaseLock() {
  try {
    const raw = await fs.readFile(paths.lockFile, 'utf8');
    const info = JSON.parse(raw);
    if (info.pid === process.pid) await fs.rm(paths.lockFile, { force: true });
  } catch {
    /* 忽略清理失败 */
  }
}
