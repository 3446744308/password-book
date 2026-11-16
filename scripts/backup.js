#!/usr/bin/env node
/**
 * 手动备份脚本：将 data/ 归档到 data/backups/<YYYYMMDD-HHmmss>/
 * 用法：npm --prefix server run backup   或   node scripts/backup.js
 */
import { createBackup } from '../server/src/storage/backup.js';

try {
  const result = await createBackup('manual');
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error('[backup] 失败：', err.message);
  process.exitCode = 1;
}
