import path from 'node:path';
import { config } from '../config.js';
import { errors } from '../utils/errors.js';
import { assertSafeId, isUlid, SAFE_ID_RE } from '../utils/ids.js';

/** 数据目录内所有约定路径（docs/01 §4.1） */
export const paths = {
  root: config.dataDir,
  metaFile: path.join(config.dataDir, 'meta.json'),
  configFile: path.join(config.dataDir, 'config.json'),
  masterFile: path.join(config.dataDir, 'master.json'),
  secretsFile: path.join(config.dataDir, 'secrets.json'),
  categoriesFile: path.join(config.dataDir, 'categories.json'),
  entriesDir: path.join(config.dataDir, 'entries'),
  historyDir: path.join(config.dataDir, 'history'),
  historyTrashDir: path.join(config.dataDir, 'history', '.trash'),
  logsDir: path.join(config.dataDir, 'logs'),
  auditFile: path.join(config.dataDir, 'logs', 'audit.jsonl'),
  backupsDir: path.join(config.dataDir, 'backups'),
  lockFile: path.join(config.dataDir, '.server.lock'),
  jwtSecretFile: config.jwtSecretFile,

  /** 条目文件：data/entries/<categoryId>.json（ID 白名单校验防路径穿越） */
  entryFile(categoryId) {
    assertSafeId(categoryId, '分类 ID');
    const file = path.join(paths.entriesDir, `${categoryId}.json`);
    const base = paths.entriesDir + path.sep;
    if (!file.startsWith(base)) throw errors.notFound('非法分类 ID');
    return file;
  },

  /** 历史文件：data/history/<entryId>.json（仅允许 ULID） */
  historyFile(entryId) {
    if (!isUlid(entryId)) throw errors.notFound('非法条目 ID');
    return path.join(paths.historyDir, `${entryId}.json`);
  },
};

export { SAFE_ID_RE };
export default paths;
