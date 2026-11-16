import * as repo from '../storage/repository.js';
import { cryptoService } from '../crypto/index.js';
import { errors } from '../utils/errors.js';
import { ulid, nowIso, isUlid } from '../utils/ids.js';
import { validate } from '../utils/validate.js';

const URL_RE = /^https?:\/\/.+/i;
const MAX_PASSWORD = 500;

function entryRules(partial) {
  return [
    { field: 'title', label: '标题', required: !partial, minLength: 1, maxLength: 100 },
    { field: 'username', label: '账号', maxLength: 200 },
    { field: 'notes', label: '备注', maxLength: 2000 },
    {
      field: 'url',
      label: '网址',
      maxLength: 500,
      pattern: URL_RE,
      patternMessage: '网址需以 http:// 或 https:// 开头',
    },
    { field: 'categoryId', label: '分类', maxLength: 50 },
    { field: 'favorite', type: 'bool' },
    { field: 'tags', type: 'stringArray', maxItems: 10, itemMaxLength: 20 },
    { field: 'changeNote', label: '变更备注', maxLength: 100 },
  ];
}

/** 从 body 中分离 password 字段（undefined=不变，null=清空，string=设置） */
function extractPassword(body) {
  if (
    !body ||
    typeof body !== 'object' ||
    !Object.prototype.hasOwnProperty.call(body, 'password')
  ) {
    return { present: false };
  }
  const value = body.password;
  if (value === null) return { present: true, value: null };
  if (typeof value === 'string') {
    if (value.length > MAX_PASSWORD) {
      throw errors.validation([{ field: 'password', message: `密码最多 ${MAX_PASSWORD} 个字符` }]);
    }
    return { present: true, value };
  }
  throw errors.validation([{ field: 'password', message: '密码格式错误' }]);
}

async function assertCategory(categoryId) {
  const cat = await repo.getCategory(categoryId);
  if (!cat) throw errors.notFound('分类不存在');
  return cat;
}

/** 详情 DTO：notes 解密返回，password 明文仅 reveal 可取（docs/03 §4.3/4.4） */
function toDetail(entry) {
  return {
    id: entry.id,
    categoryId: entry.categoryId,
    title: entry.title,
    username: entry.username || '',
    url: entry.url || '',
    notes: entry.notesEnc ? cryptoService.decrypt(entry.notesEnc) : null,
    favorite: Boolean(entry.favorite),
    tags: entry.tags || [],
    hasPassword: Boolean(entry.passwordEnc),
    passwordVersion: entry.passwordVersion || 0,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

export const entryService = {
  list(query) {
    return repo.listEntries(query);
  },

  async detail(id) {
    const found = await repo.findEntry(id);
    if (!found) throw errors.notFound('条目不存在');
    return toDetail(found.entry);
  },

  async create(body, ip) {
    const v = validate(body, entryRules(false));
    const categoryId = v.categoryId || '_default';
    await assertCategory(categoryId);
    const pw = extractPassword(body);

    const entry = {
      id: ulid(),
      categoryId,
      title: v.title,
      username: v.username || '',
      passwordEnc: pw.present && pw.value ? cryptoService.encrypt(pw.value) : null,
      url: v.url || '',
      notesEnc: v.notes ? cryptoService.encrypt(v.notes) : null,
      favorite: Boolean(v.favorite),
      tags: v.tags || [],
      passwordVersion: pw.present && pw.value ? 1 : 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await repo.insertEntry(entry);
    await repo.appendAudit('ENTRY_CREATE', { ip, detail: `id=${entry.id}` });
    return toDetail(entry);
  },

  /**
   * 更新条目（PUT 全量 / PATCH 局部共用）
   * - password 省略=不变；null=清空（旧密码入历史）；字符串=设置（不同则旧密码入历史）
   */
  async update(id, body, ip, { partial = false } = {}) {
    const exists = await repo.findEntry(id);
    if (!exists) throw errors.notFound('条目不存在');
    if (partial && (!body || typeof body !== 'object' || Object.keys(body).length === 0)) {
      throw errors.validation([{ field: '_', message: '至少提交一个待更新字段' }]);
    }

    const v = validate(body, entryRules(partial));
    if (partial && Object.prototype.hasOwnProperty.call(body, 'title') && !v.title) {
      throw errors.validation([{ field: 'title', message: '标题不能为空' }]);
    }
    const pw = extractPassword(body);
    if (v.categoryId !== undefined && v.categoryId !== exists.categoryId) {
      await assertCategory(v.categoryId);
    }
    const cfg = await repo.readConfig();

    const updated = await repo.mutateEntry(id, async (entry) => {
      const next = { ...entry };
      if (v.title !== undefined) next.title = v.title;
      if (v.username !== undefined) next.username = v.username || '';
      if (v.url !== undefined) next.url = v.url || '';
      if (v.tags !== undefined) next.tags = v.tags;
      if (v.favorite !== undefined) next.favorite = v.favorite;
      if (v.categoryId !== undefined) next.categoryId = v.categoryId;
      if (v.notes !== undefined) next.notesEnc = v.notes ? cryptoService.encrypt(v.notes) : null;

      if (pw.present) {
        const currentPlain = entry.passwordEnc ? cryptoService.decrypt(entry.passwordEnc) : null;
        const willChange =
          pw.value === null ? Boolean(entry.passwordEnc) : pw.value !== currentPlain;
        if (willChange) {
          // 先归档旧密码（崩溃时最坏情况为历史多一条同版本记录，可恢复）
          if (entry.passwordEnc) {
            const history = await repo.readHistory(entry.id);
            history.versions.push({
              version: entry.passwordVersion || 1,
              passwordEnc: entry.passwordEnc,
              username: entry.username || '',
              changedAt: nowIso(),
              changeNote: v.changeNote || null,
            });
            if (history.versions.length > cfg.historyKeep) {
              history.versions = history.versions.slice(-cfg.historyKeep);
            }
            await repo.writeHistory(entry.id, history);
            next.passwordVersion = (entry.passwordVersion || 1) + 1;
          } else {
            next.passwordVersion = (entry.passwordVersion || 0) + 1;
          }
          next.passwordEnc = pw.value === null ? null : cryptoService.encrypt(pw.value);
        }
      }
      next.updatedAt = nowIso();
      return next;
    });

    if (!updated || updated === false) throw errors.notFound('条目不存在');
    await repo.appendAudit('ENTRY_UPDATE', { ip, detail: `id=${id}` });
    return toDetail(updated);
  },

  /** GET /entries/:id/reveal：密码明文（写审计） */
  async reveal(id, ip) {
    const found = await repo.findEntry(id);
    if (!found) throw errors.notFound('条目不存在');
    const entry = found.entry;
    if (!entry.passwordEnc) throw errors.noPassword();
    const password = cryptoService.decrypt(entry.passwordEnc);
    await repo.appendAudit('ENTRY_REVEAL', { ip, detail: `id=${id}` });
    return {
      id,
      password,
      notes: entry.notesEnc ? cryptoService.decrypt(entry.notesEnc) : null,
      fetchedAt: nowIso(),
    };
  },

  /** PATCH /entries/:id/favorite */
  async setFavorite(id, favorite, ip) {
    const updated = await repo.mutateEntry(id, (entry) => ({
      ...entry,
      favorite,
      updatedAt: nowIso(),
    }));
    if (!updated) throw errors.notFound('条目不存在');
    await repo.appendAudit('ENTRY_UPDATE', { ip, detail: `id=${id},favorite=${favorite}` });
    return { id, favorite };
  },

  async remove(id, ip) {
    const removed = await repo.deleteEntry(id);
    if (!removed) throw errors.notFound('条目不存在');
    await repo.appendAudit('ENTRY_DELETE', { ip, detail: `id=${id}` });
  },

  // ===================== 密码历史 =====================

  async history(id, { page = 1, size = 20 } = {}) {
    const found = await repo.findEntry(id);
    if (!found) throw errors.notFound('条目不存在');
    const history = await repo.readHistory(id);
    const all = [...history.versions].sort((a, b) => b.version - a.version);
    const total = all.length;
    const start = (page - 1) * size;
    const list = all.slice(start, start + size).map((v) => ({
      version: v.version,
      changedAt: v.changedAt,
      changeNote: v.changeNote || null,
      restorable: true,
    }));
    return { list, pagination: { page, size, total } };
  },

  async historyReveal(id, version, ip) {
    const found = await repo.findEntry(id);
    if (!found) throw errors.notFound('条目不存在');
    const history = await repo.readHistory(id);
    const target = history.versions.find((v) => v.version === version);
    if (!target) throw errors.notFound('历史版本不存在');
    await repo.appendAudit('HISTORY_REVEAL', { ip, detail: `id=${id},v=${version}` });
    return {
      version: target.version,
      password: cryptoService.decrypt(target.passwordEnc),
      changedAt: target.changedAt,
    };
  },

  /** POST /entries/:id/restore-password：恢复指定历史版本（当前版本先归档） */
  async restorePassword(id, version, ip) {
    const cfg = await repo.readConfig();
    const updated = await repo.mutateEntry(id, async (entry) => {
      const history = await repo.readHistory(id);
      const target = history.versions.find((v) => v.version === version);
      if (!target) throw errors.notFound('历史版本不存在');
      const next = { ...entry };
      if (entry.passwordEnc) {
        history.versions.push({
          version: entry.passwordVersion || 1,
          passwordEnc: entry.passwordEnc,
          username: entry.username || '',
          changedAt: nowIso(),
          changeNote: '恢复前自动备份',
        });
        if (history.versions.length > cfg.historyKeep) {
          history.versions = history.versions.slice(-cfg.historyKeep);
        }
      }
      next.passwordEnc = target.passwordEnc;
      next.passwordVersion = Math.max(entry.passwordVersion || 0, target.version) + 1;
      next.updatedAt = nowIso();
      await repo.writeHistory(id, history);
      return next;
    });
    if (!updated || updated === false) throw errors.notFound('条目不存在');
    await repo.appendAudit('HISTORY_RESTORE', { ip, detail: `id=${id},from=v${version}` });
    return {
      id,
      restoredVersion: version,
      currentVersion: updated.passwordVersion,
      updatedAt: updated.updatedAt,
    };
  },
};

export { isUlid };
export default entryService;
