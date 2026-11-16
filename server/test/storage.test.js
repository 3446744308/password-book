import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createTestEnv } from './helpers.js';
// fsx 仅依赖 errors.js，可静态导入；一切触及 config 的模块必须在 env 设置后动态导入
import { withLock, writeJson, readJson, exists } from '../src/storage/fsx.js';

let env;
let paths;
let ensureSchema;
let ensureDataDirs;
let createBackup;

beforeAll(async () => {
  env = await createTestEnv();
  ({ paths } = await import('../src/storage/paths.js'));
  ({ ensureSchema, ensureDataDirs } = await import('../src/storage/migrate.js'));
  ({ createBackup } = await import('../src/storage/backup.js'));
});
afterAll(async () => {
  await env.cleanup();
});

describe('原子写与写队列', () => {
  it('writeJson/readJson 往返 + 不残留临时文件', async () => {
    const file = path.join(env.dir, 'sample.json');
    await writeJson(file, { hello: '世界', n: 42 });
    expect(await readJson(file, null)).toEqual({ hello: '世界', n: 42 });
    const names = await fs.readdir(env.dir);
    expect(names.filter((n) => n.endsWith('.tmp'))).toHaveLength(0);
  });

  it('readJson 对不存在文件返回 fallback', async () => {
    expect(await readJson(path.join(env.dir, 'nope.json'), { d: 1 })).toEqual({ d: 1 });
  });

  it('50 个并发读改写经写队列后计数完整（无丢失更新）', async () => {
    const file = path.join(env.dir, 'counter.json');
    await writeJson(file, { n: 0 });
    await Promise.all(
      Array.from({ length: 50 }, () =>
        withLock(async () => {
          const data = await readJson(file, { n: 0 });
          data.n += 1;
          await writeJson(file, data);
        }),
      ),
    );
    const final = await readJson(file, { n: 0 });
    expect(final.n).toBe(50);
  });
});

describe('数据结构与迁移', () => {
  it('ensureDataDirs 创建全部约定目录', async () => {
    await ensureDataDirs();
    for (const dir of [paths.entriesDir, paths.historyDir, paths.logsDir, paths.backupsDir]) {
      expect(await exists(dir)).toBe(true);
    }
  });

  it('ensureSchema：删除 meta 后重建为 v1，再次调用幂等', async () => {
    // app bootstrap 已创建 meta，这里删除以覆盖“首次创建”分支
    await fs.rm(paths.metaFile, { force: true });
    const first = await ensureSchema();
    expect(first.created).toBe(true);
    expect(await exists(paths.metaFile)).toBe(true);
    const second = await ensureSchema();
    expect(second.created).toBe(false);
    const meta = await readJson(paths.metaFile, null);
    expect(meta.schemaVersion).toBe(1);
  });
});

describe('路径安全（防目录穿越）', () => {
  it('非法分类 ID 直接拒绝', () => {
    expect(() => paths.entryFile('../secrets')).toThrow();
    expect(() => paths.entryFile('..')).toThrow();
    expect(() => paths.entryFile('/etc/passwd')).toThrow();
    expect(() => paths.entryFile('a/b')).toThrow();
  });

  it('合法 ID 通过（ULID 与 _default）', () => {
    expect(paths.entryFile('_default')).toMatch(/_default\.json$/);
    expect(paths.entryFile('01JD8Z8G9QK3M2N7P5R6T8WXYZ')).toMatch(/\.json$/);
  });

  it('非 ULID 条目 ID 读历史被拒绝', () => {
    expect(() => paths.historyFile('../../x')).toThrow();
    expect(() => paths.historyFile('not-ulid')).toThrow();
  });
});

describe('备份', () => {
  it('createBackup 归档 data/ 且不包含 backups 自身', async () => {
    await ensureDataDirs();
    const result = await createBackup('test');
    expect(result.backupId).toMatch(/^\d{8}-\d{6}$/);
    expect(result.fileCount).toBeGreaterThan(0);
    const dest = path.join(paths.backupsDir, result.backupId);
    expect(await exists(dest)).toBe(true);
    // 归档内容里不应再嵌套 backups
    expect(await exists(path.join(dest, 'backups'))).toBe(false);
  });
});
