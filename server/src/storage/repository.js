import fs from 'node:fs/promises';
import path from 'node:path';
import { paths } from './paths.js';
import { readJson, writeJson, writeText, appendLine, withLock, exists, removeFile } from './fsx.js';
import { errors } from '../utils/errors.js';
import { ulid, nowIso, isUlid } from '../utils/ids.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { PRESET_CATEGORIES } from './presets.js';

/**
 * 数据仓库：data/ 目录的唯一读写出口（docs/02 §3.2）。
 * 约定：单文件原子写不加锁；跨文件 read-modify-write 一律 withLock 串行。
 */

const CONFIG_DEFAULTS = {
  /**
   * 会话有效期（分钟）。这是**唯一**的会话时长来源：
   * 既用于 GET /auth/session 的展示值，也是签发访问令牌时的实际 TTL（docs/03 §1.3）。
   * 首次启动的初值由环境变量 ACCESS_TOKEN_TTL（秒）折算，写入 config.json 后即以配置为准。
   */
  lockMinutes: Math.max(1, Math.round(config.accessTokenTtl / 60)),
  failedAttempts: 5,
  lockMinutesAfterBan: 15,
  minPasswordLength: 10,
  defaultCategoryId: '_default',
  historyKeep: 50,
};

const DEFAULT_CATEGORY = {
  id: '_default',
  name: '默认分类',
  icon: 'folder',
  sortOrder: 0,
  protected: true,
};

// ===================== 系统配置 =====================

export async function readConfig() {
  const saved = await readJson(paths.configFile, {});
  return { ...CONFIG_DEFAULTS, ...saved };
}

export async function updateConfig(patch) {
  return withLock(async () => {
    const current = await readConfig();
    const next = { ...current, ...patch, updatedAt: nowIso() };
    await writeJson(paths.configFile, next);
    return next;
  });
}

// ===================== 主密码状态 =====================

export async function readMaster() {
  return readJson(paths.masterFile, null);
}

/** 复合更新 master.json（失败计数等），串行防并发丢失 */
export async function mutateMaster(mutator) {
  return withLock(async () => {
    const master = await readJson(paths.masterFile, null);
    if (!master) return null;
    const next = await mutator(master);
    if (next) await writeJson(paths.masterFile, next);
    return next;
  });
}

// ===================== 分类 =====================

async function readCategoriesDoc() {
  return (await readJson(paths.categoriesFile, null)) || { categories: [], updatedAt: null };
}

/** 初始化默认分类与其条目文件（仅首次） */
export async function ensureDefaultCategory() {
  return withLock(async () => {
    const doc = await readCategoriesDoc();
    if (!doc.categories.some((c) => c.id === '_default')) {
      doc.categories.unshift({ ...DEFAULT_CATEGORY, createdAt: nowIso(), updatedAt: nowIso() });
      doc.updatedAt = nowIso();
      await writeJson(paths.categoriesFile, doc);
    }
    const file = paths.entryFile('_default');
    if (!(await exists(file))) {
      await writeJson(file, { categoryId: '_default', updatedAt: nowIso(), items: [] });
    }
    return doc;
  });
}

/**
 * 写入内置分类（docs/01 §4.2）。**只执行一次**：
 * 播种后置 `presetsSeeded: true`，此后即便用户删掉这些分类也不会在重启时复活。
 * 同名分类已存在则跳过，保证对已有数据的库幂等。
 */
export async function seedPresetCategories() {
  return withLock(async () => {
    const doc = await readCategoriesDoc();
    if (doc.presetsSeeded) return { seeded: 0, alreadySeeded: true };

    const existingNames = new Set(doc.categories.map((c) => c.name));
    let seeded = 0;
    for (const preset of PRESET_CATEGORIES) {
      if (existingNames.has(preset.name)) continue;
      const cat = {
        id: ulid(),
        name: preset.name,
        icon: preset.icon,
        sortOrder: preset.sortOrder,
        protected: false,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      doc.categories.push(cat);
      // 与 createCategory 保持一致：每个分类一个条目文件
      await writeJson(paths.entryFile(cat.id), {
        categoryId: cat.id,
        updatedAt: nowIso(),
        items: [],
      });
      seeded += 1;
    }

    doc.presetsSeeded = true;
    doc.updatedAt = nowIso();
    await writeJson(paths.categoriesFile, doc);
    return { seeded, alreadySeeded: false };
  });
}

/** 分类列表（含条目数） */
export async function listCategories() {
  const doc = await readCategoriesDoc();
  const sorted = [...doc.categories].sort(
    (a, b) => a.sortOrder - b.sortOrder || String(a.createdAt).localeCompare(String(b.createdAt)),
  );
  const result = [];
  for (const cat of sorted) {
    const file = await readJson(paths.entryFile(cat.id), null);
    result.push({ ...cat, entryCount: file?.items?.length || 0 });
  }
  return result;
}

export async function getCategory(id) {
  const doc = await readCategoriesDoc();
  const cat = doc.categories.find((c) => c.id === id);
  if (!cat) return null;
  const file = await readJson(paths.entryFile(cat.id), null);
  return { ...cat, entryCount: file?.items?.length || 0 };
}

export async function createCategory({ name, icon, sortOrder }) {
  return withLock(async () => {
    const doc = await readCategoriesDoc();
    if (doc.categories.some((c) => c.name === name)) throw errors.conflict('同名分类已存在');
    const cat = {
      id: ulid(),
      name,
      icon: icon || 'folder',
      sortOrder: sortOrder ?? 999,
      protected: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    doc.categories.push(cat);
    doc.updatedAt = nowIso();
    await writeJson(paths.categoriesFile, doc);
    await writeJson(paths.entryFile(cat.id), {
      categoryId: cat.id,
      updatedAt: nowIso(),
      items: [],
    });
    return { ...cat, entryCount: 0 };
  });
}

export async function updateCategory(id, patch) {
  return withLock(async () => {
    const doc = await readCategoriesDoc();
    const cat = doc.categories.find((c) => c.id === id);
    if (!cat) throw errors.notFound('分类不存在');
    if (patch.name !== undefined) {
      if (cat.protected && patch.name !== cat.name)
        throw errors.protectedResource('默认分类不可改名');
      if (doc.categories.some((c) => c.id !== id && c.name === patch.name)) {
        throw errors.conflict('同名分类已存在');
      }
      cat.name = patch.name;
    }
    if (patch.icon !== undefined) cat.icon = patch.icon;
    if (patch.sortOrder !== undefined) cat.sortOrder = patch.sortOrder;
    cat.updatedAt = nowIso();
    doc.updatedAt = nowIso();
    await writeJson(paths.categoriesFile, doc);
    const file = await readJson(paths.entryFile(id), null);
    return { ...cat, entryCount: file?.items?.length || 0 };
  });
}

/** 删除分类：条目先迁移到默认分类（不级联删除，docs/01 §4.3） */
export async function deleteCategory(id) {
  return withLock(async () => {
    const doc = await readCategoriesDoc();
    const cat = doc.categories.find((c) => c.id === id);
    if (!cat) throw errors.notFound('分类不存在');
    if (cat.protected || id === '_default') throw errors.protectedResource('默认分类不可删除');

    const srcFile = paths.entryFile(id);
    const src = await readJson(srcFile, null);
    const moved = (src?.items || []).map((item) => ({
      ...item,
      categoryId: '_default',
      updatedAt: nowIso(),
    }));

    const defFile = paths.entryFile('_default');
    const def = (await readJson(defFile, null)) || {
      categoryId: '_default',
      updatedAt: nowIso(),
      items: [],
    };
    def.items.push(...moved);
    def.updatedAt = nowIso();
    await writeJson(defFile, def);

    await removeFile(srcFile);
    doc.categories = doc.categories.filter((c) => c.id !== id);
    doc.updatedAt = nowIso();
    await writeJson(paths.categoriesFile, doc);
    return { deleted: true, movedEntries: moved.length };
  });
}

/** 批量转移条目到目标分类 */
export async function transferEntries(sourceCatId, targetCatId, entryIds) {
  return withLock(async () => {
    const srcFile = paths.entryFile(sourceCatId);
    const tgtFile = paths.entryFile(targetCatId);
    const src = await readJson(srcFile, null);
    if (!src) throw errors.notFound('源分类不存在');

    const idSet = new Set(entryIds);
    const moving = src.items.filter((i) => idSet.has(i.id));
    const missing = entryIds.filter((id) => !moving.some((i) => i.id === id));
    if (missing.length) {
      throw errors.notFound('部分条目不存在或不属于该分类', [
        { field: 'entryIds', message: `条目 ${missing[0]} 不属于该分类` },
      ]);
    }

    const tgt = (await readJson(tgtFile, null)) || {
      categoryId: targetCatId,
      updatedAt: nowIso(),
      items: [],
    };
    const stamp = nowIso();
    for (const item of moving) {
      item.categoryId = targetCatId;
      item.updatedAt = stamp;
    }
    tgt.items.push(...moving);
    tgt.updatedAt = stamp;
    src.items = src.items.filter((i) => !idSet.has(i.id));
    src.updatedAt = stamp;
    await writeJson(srcFile, src);
    await writeJson(tgtFile, tgt);
    return { transferred: moving.length, targetCategoryId: targetCatId };
  });
}

// ===================== 条目 =====================

async function listEntryCatIds() {
  try {
    const names = await fs.readdir(paths.entriesDir);
    return names.filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

export async function readEntryFile(catId) {
  return (
    (await readJson(paths.entryFile(catId), null)) || {
      categoryId: catId,
      updatedAt: null,
      items: [],
    }
  );
}

/** 列表 DTO：不含任何密文（docs/03 §4.1） */
function toListDto(item) {
  return {
    id: item.id,
    categoryId: item.categoryId,
    title: item.title,
    username: item.username || '',
    url: item.url || '',
    hasPassword: Boolean(item.passwordEnc),
    favorite: Boolean(item.favorite),
    tags: item.tags || [],
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

/** 条目列表：跨文件检索 + 筛选 + 排序 + 分页 */
export async function listEntries(query = {}) {
  const catIds = await listEntryCatIds();
  let all = [];
  for (const catId of catIds) {
    if (query.categoryId && catId !== query.categoryId) continue;
    const data = await readJson(paths.entryFile(catId), null);
    if (data?.items?.length) all.push(...data.items);
  }

  if (query.favorite === true) all = all.filter((i) => i.favorite === true);
  if (query.tag) all = all.filter((i) => (i.tags || []).includes(query.tag));
  if (query.keyword) {
    const kw = String(query.keyword).toLowerCase();
    all = all.filter(
      (i) =>
        String(i.title || '')
          .toLowerCase()
          .includes(kw) ||
        String(i.username || '')
          .toLowerCase()
          .includes(kw) ||
        String(i.url || '')
          .toLowerCase()
          .includes(kw) ||
        (i.tags || []).some((t) => String(t).toLowerCase().includes(kw)),
    );
  }

  const sortKey = ['updatedAt', 'createdAt', 'title'].includes(query.sort)
    ? query.sort
    : 'updatedAt';
  const dir = query.order === 'asc' ? 1 : -1;
  all.sort((a, b) => {
    const av = a[sortKey] ?? '';
    const bv = b[sortKey] ?? '';
    if (av < bv) return -dir;
    if (av > bv) return dir;
    return 0;
  });

  const total = all.length;
  const page = Math.max(1, Number(query.page) || 1);
  const size = Math.min(100, Math.max(1, Number(query.size) || 20));
  const list = all.slice((page - 1) * size, page * size).map(toListDto);
  return { list, pagination: { page, size, total } };
}

/** 查找条目（返回原始对象与所在分类） */
export async function findEntry(id) {
  if (!isUlid(id)) return null;
  for (const catId of await listEntryCatIds()) {
    const data = await readJson(paths.entryFile(catId), null);
    const item = data?.items?.find((i) => i.id === id);
    if (item) return { entry: item, categoryId: catId };
  }
  return null;
}

export async function insertEntry(entry) {
  return withLock(async () => {
    const file = paths.entryFile(entry.categoryId);
    const data = (await readJson(file, null)) || {
      categoryId: entry.categoryId,
      updatedAt: null,
      items: [],
    };
    data.items.push(entry);
    data.updatedAt = nowIso();
    await writeJson(file, data);
    return entry;
  });
}

/**
 * 复合更新条目：在写锁内查找到条目后交给 mutator 处理。
 * mutator(entry, categoryId) 可为 async，返回 false 表示放弃写入。
 * 返回更新后的条目；不存在返回 null。
 */
export async function mutateEntry(id, mutator) {
  return withLock(async () => {
    if (!isUlid(id)) return null;
    for (const catId of await listEntryCatIds()) {
      const file = paths.entryFile(catId);
      const data = await readJson(file, null);
      if (!data?.items) continue;
      const idx = data.items.findIndex((i) => i.id === id);
      if (idx < 0) continue;
      // 传副本：mutator 中途抛错不影响原数据
      const result = await mutator({ ...data.items[idx] }, catId);
      if (result === false) return false;
      const updated = result || data.items[idx];
      const targetCat = updated.categoryId;
      if (targetCat && targetCat !== catId) {
        // 分类变更：同一写锁内跨文件移动（目标文件已由业务层校验存在）
        const targetFile = paths.entryFile(targetCat);
        const target = (await readJson(targetFile, null)) || {
          categoryId: targetCat,
          updatedAt: null,
          items: [],
        };
        target.items.push(updated);
        target.updatedAt = nowIso();
        data.items.splice(idx, 1);
        data.updatedAt = nowIso();
        await writeJson(targetFile, target);
        await writeJson(file, data);
      } else {
        data.items[idx] = updated;
        data.updatedAt = nowIso();
        await writeJson(file, data);
      }
      return updated;
    }
    return null;
  });
}

/** 删除条目（单次写锁完成）；历史文件移入 .trash（7 天后清理） */
export async function deleteEntry(id) {
  const item = await withLock(async () => {
    if (!isUlid(id)) return null;
    for (const catId of await listEntryCatIds()) {
      const file = paths.entryFile(catId);
      const data = await readJson(file, null);
      if (!data?.items) continue;
      const idx = data.items.findIndex((i) => i.id === id);
      if (idx < 0) continue;
      const [removed] = data.items.splice(idx, 1);
      data.updatedAt = nowIso();
      await writeJson(file, data);
      return removed;
    }
    return null;
  });
  if (item) await trashHistory(id);
  return item;
}

/** strict 模式更换主密码：全量重加密所有密文字段，返回重加密条数 */
export async function reencryptAll(transform) {
  let count = 0;
  for (const catId of await listEntryCatIds()) {
    const file = paths.entryFile(catId);
    const data = await readJson(file, null);
    if (!data?.items?.length) continue;
    let touched = false;
    for (const item of data.items) {
      if (item.passwordEnc) {
        item.passwordEnc = transform(item.passwordEnc);
        count++;
        touched = true;
      }
      if (item.notesEnc) {
        item.notesEnc = transform(item.notesEnc);
        count++;
        touched = true;
      }
    }
    if (touched) {
      data.updatedAt = nowIso();
      await writeJson(file, data);
    }
  }
  // 历史版本文件（不含 .trash，旧密钥密文删除即可，无需重加密）
  try {
    const names = await fs.readdir(paths.historyDir);
    for (const name of names.filter((n) => n.endsWith('.json'))) {
      const file = path.join(paths.historyDir, name);
      const data = await readJson(file, null);
      if (!data?.versions?.length) continue;
      let touched = false;
      for (const version of data.versions) {
        if (version.passwordEnc) {
          version.passwordEnc = transform(version.passwordEnc);
          count++;
          touched = true;
        }
      }
      if (touched) await writeJson(file, data);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return count;
}

// ===================== 密码历史 =====================

export async function readHistory(entryId) {
  return (await readJson(paths.historyFile(entryId), null)) || { entryId, versions: [] };
}

export async function writeHistory(entryId, history) {
  return writeJson(paths.historyFile(entryId), history);
}

export async function trashHistory(entryId) {
  const src = paths.historyFile(entryId);
  if (!(await exists(src))) return;
  await fs.mkdir(paths.historyTrashDir, { recursive: true });
  await fs.rename(src, path.join(paths.historyTrashDir, `${entryId}.json`));
}

// ===================== 审计日志 =====================

const AUDIT_KEEP = 1000;
let auditLineCount = -1;

async function countAuditLines() {
  try {
    const text = await fs.readFile(paths.auditFile, 'utf8');
    return text.split(/\r?\n/).filter(Boolean).length;
  } catch (err) {
    if (err.code === 'ENOENT') return 0;
    throw err;
  }
}

/** 追加审计事件（绝不含密码明文，超 1000 条轮转） */
export async function appendAudit(event, { ip, detail } = {}) {
  try {
    if (auditLineCount < 0) auditLineCount = await countAuditLines();
    await appendLine(paths.auditFile, {
      ts: nowIso(),
      event,
      ip: ip || null,
      detail: detail || null,
    });
    auditLineCount++;
    if (auditLineCount > AUDIT_KEEP) {
      const text = await fs.readFile(paths.auditFile, 'utf8');
      const lines = text.split(/\r?\n/).filter(Boolean);
      await writeText(paths.auditFile, `${lines.slice(-AUDIT_KEEP).join('\n')}\n`);
      auditLineCount = AUDIT_KEEP;
    }
  } catch (err) {
    logger.warn('audit.write.failed', { message: err.message });
  }
}

export async function listAudit({ page = 1, size = 50, event } = {}) {
  let items = [];
  try {
    const text = await fs.readFile(paths.auditFile, 'utf8');
    items = text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse(); // 新在前
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (event) items = items.filter((i) => i.event === event);
  const total = items.length;
  const start = (page - 1) * size;
  return { list: items.slice(start, start + size), pagination: { page, size, total } };
}

// ===================== 统计 =====================

export async function counts() {
  const doc = await readCategoriesDoc();
  let entryCount = 0;
  const catIds = new Set([...doc.categories.map((c) => c.id), ...(await listEntryCatIds())]);
  for (const catId of catIds) {
    const file = await readJson(paths.entryFile(catId), null);
    entryCount += file?.items?.length || 0;
  }
  return { entryCount, categoryCount: doc.categories.length };
}
