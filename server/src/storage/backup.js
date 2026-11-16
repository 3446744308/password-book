import fs from 'node:fs/promises';
import path from 'node:path';
import { paths } from './paths.js';
import { errors } from '../utils/errors.js';

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * 手写递归拷贝（而非 fs.cp）：
 * 1) Node 的 fs.cp 禁止将目录拷贝进自身子目录（data/ -> data/backups/ 会 EINVAL）；
 * 2) 拷贝过程中同步统计文件数与字节数。
 * 根级排除：backups 子目录、进程锁文件；全局排除 *.tmp。
 */
async function copyTree(src, dest, stats, isRoot) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.endsWith('.tmp')) continue;
    if (isRoot && (entry.name === 'backups' || entry.name === '.server.lock')) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyTree(from, to, stats, false);
    } else if (entry.isFile()) {
      await fs.copyFile(from, to);
      const stat = await fs.stat(to);
      stats.fileCount += 1;
      stats.sizeBytes += stat.size;
    }
  }
}

/** 备份 data/ 到 data/backups/<YYYYMMDD-HHmmss>/（标签前缀可选） */
export async function createBackup(label = 'manual') {
  const backupId = timestamp();
  const dest = path.join(paths.backupsDir, backupId);
  const stats = { fileCount: 0, sizeBytes: 0 };
  try {
    await copyTree(paths.root, dest, stats, true);
  } catch (err) {
    await fs.rm(dest, { recursive: true, force: true });
    if (err.code === 'ENOSPC') throw errors.storageFull();
    throw errors.unavailable(`备份失败：${err.message}`);
  }

  return {
    backupId,
    label,
    path: `data/backups/${backupId}`,
    fileCount: stats.fileCount,
    sizeBytes: stats.sizeBytes,
    createdAt: new Date().toISOString(),
  };
}
