import fs from 'node:fs/promises';
import path from 'node:path';
import { errors } from '../utils/errors.js';

/**
 * 文件读写基础设施：
 * - readJson: 不存在返回 fallback，损坏抛 503
 * - writeJson/writeText: 原子写（临时文件 + fsync + rename），崩溃不产生半截文件（docs/01 §4.7）
 * - withLock: 进程内写串行队列，保证 read-modify-write 不被并发穿插
 */

let chain = Promise.resolve();
let tmpSeq = 0;

/** 复合写操作串行化执行 */
export function withLock(fn) {
  const run = chain.then(() => fn());
  chain = run.catch(() => {});
  return run;
}

export async function readJson(file, fallback = null) {
  try {
    const text = await fs.readFile(file, 'utf8');
    return JSON.parse(text);
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    if (err instanceof SyntaxError) {
      throw errors.unavailable(`数据文件损坏：${path.basename(file)}`);
    }
    throw err;
  }
}

async function atomicWrite(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${tmpSeq++}.tmp`;
  const handle = await fs.open(tmp, 'w');
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, file);
}

/** 原子写 JSON（缩进 2 空格，便于人工查看与备份） */
export function writeJson(file, data) {
  return atomicWrite(file, JSON.stringify(data, null, 2));
}

/** 原子写纯文本（审计日志轮转用） */
export function writeText(file, content) {
  return atomicWrite(file, content);
}

/** 追加一行（JSONL 审计日志） */
export async function appendLine(file, obj) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${JSON.stringify(obj)}\n`, 'utf8');
}

export async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export async function removeFile(file) {
  try {
    await fs.rm(file);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}
