import { paths } from './paths.js';
import { readJson, writeJson, exists } from './fsx.js';
import { SCHEMA_VERSION } from '../version.js';
import { errors } from '../utils/errors.js';
import { nowIso } from '../utils/ids.js';
import { logger } from '../logger.js';

/**
 * 数据结构版本迁移（docs/01 §4.9）：
 * 启动时对比 meta.schemaVersion 与代码内 LATEST，逐版本执行迁移函数；
 * 迁移前自动快照，失败拒绝启动。
 */
const MIGRATIONS = {
  // 1 → 2 示例：在此注册 async (meta) => { ... }
};

export async function ensureSchema() {
  const meta = await readJson(paths.metaFile, null);

  if (!meta) {
    const fresh = {
      schemaVersion: SCHEMA_VERSION,
      createdAt: nowIso(),
      lastMigrationAt: null,
      migrations: [],
    };
    await writeJson(paths.metaFile, fresh);
    return { created: true, from: 0, to: SCHEMA_VERSION };
  }

  if (typeof meta.schemaVersion !== 'number') {
    throw errors.unavailable('meta.json 损坏：缺少 schemaVersion');
  }
  if (meta.schemaVersion === SCHEMA_VERSION) {
    return { created: false, from: SCHEMA_VERSION, to: SCHEMA_VERSION };
  }
  if (meta.schemaVersion > SCHEMA_VERSION) {
    throw errors.unavailable('数据结构版本高于当前程序支持版本，请升级程序后再启动');
  }

  // 迁移前快照（失败可依据快照回滚）
  const { createBackup } = await import('./backup.js');
  const snapshot = await createBackup(`pre-migration-v${meta.schemaVersion}`);
  logger.info('migration.snapshot', { backupId: snapshot.backupId });

  for (let from = meta.schemaVersion; from < SCHEMA_VERSION; from++) {
    const fn = MIGRATIONS[from];
    if (!fn) throw errors.unavailable(`缺少迁移脚本 v${from} → v${from + 1}`);
    await fn(meta);
    meta.migrations = [...(meta.migrations || []), { from, to: from + 1, at: nowIso() }];
    logger.info('migration.step', { from, to: from + 1 });
  }

  meta.schemaVersion = SCHEMA_VERSION;
  meta.lastMigrationAt = nowIso();
  await writeJson(paths.metaFile, meta);
  logger.info('migration.done', { schemaVersion: SCHEMA_VERSION });
  return { created: false, from: meta.migrations[0]?.from ?? SCHEMA_VERSION, to: SCHEMA_VERSION };
}

/** 启动时确保数据目录结构存在 */
export async function ensureDataDirs() {
  const { default: config } = await import('../config.js');
  const fs = await import('node:fs/promises');
  for (const dir of [
    config.dataDir,
    paths.entriesDir,
    paths.historyDir,
    paths.historyTrashDir,
    paths.logsDir,
    paths.backupsDir,
  ]) {
    await fs.mkdir(dir, { recursive: true });
  }
}

/** 清理超过 7 天的历史垃圾文件（删除条目时移入 .trash） */
export async function cleanupTrash(maxAgeMs = 7 * 24 * 3600 * 1000) {
  const fs = await import('node:fs/promises');
  let files;
  try {
    files = await fs.readdir(paths.historyTrashDir);
  } catch (err) {
    if (err.code === 'ENOENT') return 0;
    throw err;
  }
  const now = Date.now();
  let removed = 0;
  for (const name of files) {
    const file = `${paths.historyTrashDir}/${name}`;
    try {
      const stat = await fs.stat(file);
      if (now - stat.mtimeMs > maxAgeMs) {
        await fs.rm(file);
        removed++;
      }
    } catch {
      /* 忽略单文件错误 */
    }
  }
  return removed;
}

export { exists };
