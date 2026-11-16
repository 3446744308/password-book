import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTestEnv } from './helpers.js';

let env;
let logger;
let flushLogs;
let cleanupOldLogs;
let paths;

const LOG_FILE_RE = /^app-\d{8}\.log$/;

/** 汇总当天全部日志文件内容（轮转后可能不止一个文件） */
async function readAllLogs() {
  const names = (await fs.readdir(paths.logsDir)).filter((n) => LOG_FILE_RE.test(n));
  const parts = await Promise.all(names.map((n) => fs.readFile(path.join(paths.logsDir, n), 'utf8')));
  return parts.join('');
}

beforeAll(async () => {
  // helpers 把 LOG_LEVEL 设为 error：info/warn 不落盘，正好可用来验证级别过滤
  env = await createTestEnv();
  ({ logger, flushLogs, cleanupOldLogs } = await import('../src/logger.js'));
  ({ paths } = await import('../src/storage/paths.js'));
});

afterAll(async () => {
  await flushLogs();
  await env.cleanup();
});

describe('结构化日志落盘（docs/02 §11.3）', () => {
  it('error 级日志写入 data/logs/app-YYYYMMDD.log，且为单行 JSON', async () => {
    logger.error('test.event', { foo: 'bar' });
    await flushLogs();

    const names = (await fs.readdir(paths.logsDir)).filter((n) => LOG_FILE_RE.test(n));
    expect(names.length).toBeGreaterThan(0);

    const text = await readAllLogs();
    expect(text.endsWith('\n')).toBe(true);

    const records = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const hit = records.find((r) => r.event === 'test.event');
    expect(hit).toBeTruthy();
    expect(hit.level).toBe('error');
    expect(hit.foo).toBe('bar');
    expect(typeof hit.ts).toBe('string');
  });

  it('敏感字段名一律打码，明文不入日志', async () => {
    logger.error('test.redact', { password: 'plain-secret', token: 'jwt-value', safe: 'keep-me' });
    await flushLogs();

    const text = await readAllLogs();
    expect(text).not.toContain('plain-secret');
    expect(text).not.toContain('jwt-value');

    const hit = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .find((r) => r.event === 'test.redact');
    expect(hit.password).toBe('[REDACTED]');
    expect(hit.token).toBe('[REDACTED]');
    expect(hit.safe).toBe('keep-me');
  });

  it('低于 LOG_LEVEL 的日志不落盘', async () => {
    logger.info('test.info.noise', { a: 1 });
    logger.warn('test.warn.noise', { a: 1 });
    await flushLogs();
    const text = await readAllLogs();
    expect(text).not.toContain('test.info.noise');
    expect(text).not.toContain('test.warn.noise');
  });

  it('cleanupOldLogs 删除超期文件、保留当天文件', async () => {
    const oldFile = path.join(paths.logsDir, 'app-20000101.log');
    await fs.writeFile(oldFile, '{"event":"ancient"}\n', 'utf8');

    const removed = await cleanupOldLogs();
    expect(removed).toBe(1);

    const names = await fs.readdir(paths.logsDir);
    expect(names).not.toContain('app-20000101.log');
    expect(names.some((n) => LOG_FILE_RE.test(n))).toBe(true);
  });

  it('非日志文件不被 cleanupOldLogs 误删', async () => {
    const audit = path.join(paths.logsDir, 'audit.jsonl');
    await fs.writeFile(audit, '', 'utf8');
    await cleanupOldLogs();
    expect(await fs.readdir(paths.logsDir)).toContain('audit.jsonl');
  });
});
