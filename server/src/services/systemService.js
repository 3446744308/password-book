import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { config } from '../config.js';
import * as repo from '../storage/repository.js';
import { cryptoService } from '../crypto/index.js';
import { createBackup } from '../storage/backup.js';
import { PRESET_CATEGORIES, PRESET_TAGS } from '../storage/presets.js';
import { VERSION, SCHEMA_VERSION } from '../version.js';
import { validate } from '../utils/validate.js';
import { errors } from '../utils/errors.js';

const CONFIG_FIELDS = [
  'lockMinutes',
  'failedAttempts',
  'lockMinutesAfterBan',
  'minPasswordLength',
  'defaultCategoryId',
  'historyKeep',
];

function pickConfig(cfg) {
  const out = {};
  for (const f of CONFIG_FIELDS) out[f] = cfg[f];
  return out;
}

export const systemService = {
  async health() {
    let dataDirWritable = true;
    try {
      await fs.access(config.dataDir, constants.W_OK);
    } catch {
      dataDirWritable = false;
    }
    return {
      status: 'ok',
      version: VERSION,
      schemaVersion: SCHEMA_VERSION,
      initialized: cryptoService.initialized,
      dataDirWritable,
      uptimeSeconds: Math.floor(process.uptime()),
    };
  },

  getConfig() {
    return repo.readConfig().then(pickConfig);
  },

  /**
   * GET /system/presets：内置分类/标签候选（docs/03 §6.7）。
   * 分类是"播种时用过的模板"，实际分类以 GET /categories 为准；
   * 标签在数据模型里只是条目上的字符串，这里提供客户端做快捷选择。
   */
  presets() {
    return {
      categories: PRESET_CATEGORIES.map((c) => ({ ...c })),
      tags: [...PRESET_TAGS],
    };
  },

  async updateConfig(body, ip) {
    const v = validate(body, [
      { field: 'lockMinutes', type: 'int', min: 1, max: 1440 },
      { field: 'failedAttempts', type: 'int', min: 3, max: 10 },
      { field: 'lockMinutesAfterBan', type: 'int', min: 1, max: 1440 },
      { field: 'minPasswordLength', type: 'int', min: 10, max: 32 },
      { field: 'historyKeep', type: 'int', min: 10, max: 500 },
    ]);
    if (!Object.keys(v).length)
      throw errors.validation([{ field: '_', message: '没有可更新的字段' }]);
    await repo.updateConfig(v);
    await repo.appendAudit('CONFIG_UPDATE', { ip, detail: Object.keys(v).join(',') });
    return pickConfig(await repo.readConfig());
  },

  listAudit(query) {
    const v = validate(query, [
      { field: 'page', type: 'int', min: 1, max: 100000 },
      { field: 'size', type: 'int', min: 1, max: 200 },
      { field: 'event', label: '事件', maxLength: 50 },
    ]);
    return repo.listAudit({ page: v.page || 1, size: v.size || 50, event: v.event });
  },

  async backup(ip) {
    const result = await createBackup('manual');
    await repo.appendAudit('BACKUP_CREATE', { ip, detail: `id=${result.backupId}` });
    return result;
  },
};

export default systemService;
