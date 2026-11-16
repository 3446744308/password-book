import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { paths } from './storage/paths.js';

/**
 * 结构化日志（docs/02 §11.3）：
 * - 控制台输出单行 JSON（开发期可直接读，生产期可被容器收集）
 * - 同时追加到 <DATA_DIR>/logs/app-YYYYMMDD.log，按天轮转，超过保留期由 cleanupOldLogs 清理
 * - 字段名含敏感词一律打码，杜绝密码/密钥泄漏
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[config.logLevel] ?? LEVELS.info;
const LOG_FILE_RE = /^app-(\d{4})(\d{2})(\d{2})\.log$/;

/** 写入串行链：保证文件内容顺序与调用顺序一致，也便于测试/退出时 flush */
let chain = Promise.resolve();
let fileDisabled = !config.logToFile;
let failureReported = false;

/** 脱敏兜底：字段名含敏感词的一律打码 */
function sanitize(fields) {
  const out = { ...fields };
  for (const key of Object.keys(out)) {
    if (/pass|secret|token|dek|kek|verifier|authorization/i.test(key) && out[key] !== '[REDACTED]') {
      out[key] = '[REDACTED]';
    }
  }
  return out;
}

function dayStamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`;
}

function logFileFor(stamp) {
  return path.join(paths.logsDir, `app-${stamp}.log`);
}

/** 追加一行到当天日志文件；失败即关闭文件输出并只报告一次，绝不因日志影响业务 */
function queueFileWrite(line) {
  if (fileDisabled) return;
  chain = chain
    .then(async () => {
      await fs.mkdir(paths.logsDir, { recursive: true });
      await fs.appendFile(logFileFor(dayStamp()), `${line}\n`, 'utf8');
    })
    .catch((err) => {
      fileDisabled = true;
      if (!failureReported) {
        failureReported = true;
        console.error(
          JSON.stringify({
            ts: new Date().toISOString(),
            level: 'error',
            event: 'log.file.disabled',
            message: err.message,
          }),
        );
      }
    });
}

/** 等待已排队的日志写入完成（测试与优雅退出用） */
export async function flushLogs() {
  await chain;
}

/** 清理超出保留天数的日志文件，返回删除数量 */
export async function cleanupOldLogs(now = Date.now()) {
  let names;
  try {
    names = await fs.readdir(paths.logsDir);
  } catch (err) {
    if (err.code === 'ENOENT') return 0;
    throw err;
  }
  const maxAgeMs = config.logRetentionDays * 24 * 3600 * 1000;
  let removed = 0;
  for (const name of names) {
    const m = LOG_FILE_RE.exec(name);
    if (!m) continue;
    const fileTime = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
    if (!Number.isFinite(fileTime) || now - fileTime > maxAgeMs) {
      await fs.rm(path.join(paths.logsDir, name), { force: true });
      removed++;
    }
  }
  return removed;
}

function emit(level, event, fields) {
  if (LEVELS[level] < MIN_LEVEL) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...sanitize(fields || {}) });
  if (level === 'error') console.error(line);
  else console.log(line);
  queueFileWrite(line);
}

export const logger = {
  debug: (event, fields) => emit('debug', event, fields),
  info: (event, fields) => emit('info', event, fields),
  warn: (event, fields) => emit('warn', event, fields),
  error: (event, fields) => emit('error', event, fields),
};

export default logger;
