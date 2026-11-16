import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestEnv, api, setupLogin } from './helpers.js';
import { PRESET_CATEGORIES, PRESET_TAGS } from '../src/storage/presets.js';

let env;
let srv;
let base;
let token;
let repo;

beforeAll(async () => {
  env = await createTestEnv();
  ({ base, server: srv } = await env.start());
  repo = await import('../src/storage/repository.js');
  token = await setupLogin(base);
});

afterAll(async () => {
  await new Promise((resolve) => srv.close(resolve));
  await env.cleanup();
});

async function listCategories() {
  const res = await api(base, '/api/v1/categories', { token });
  expect(res.status).toBe(200);
  return res.body.data;
}

describe('内置分类播种', () => {
  it('初始化后分类列表包含全部内置分类 + 默认分类', async () => {
    const categories = await listCategories();
    const names = categories.map((c) => c.name);

    expect(names).toContain('默认分类');
    for (const preset of PRESET_CATEGORIES) expect(names).toContain(preset.name);
    expect(categories).toHaveLength(PRESET_CATEGORIES.length + 1);
  });

  it('内置分类都是可编辑的普通分类，且各自有条目文件', async () => {
    const categories = await listCategories();
    const presets = categories.filter((c) => c.id !== '_default');

    for (const cat of presets) {
      expect(cat.protected).toBe(false);
      expect(cat.entryCount).toBe(0);
      // 与 createCategory 一致：每个分类都有独立的 entries/<id>.json
      const file = await repo.readEntryFile(cat.id);
      expect(file.categoryId).toBe(cat.id);
      expect(file.items).toEqual([]);
    }
  });

  it('排序值来自预设，默认分类仍排在最前', async () => {
    const categories = await listCategories();
    expect(categories[0].id).toBe('_default');
    const byName = new Map(categories.map((c) => [c.name, c.sortOrder]));
    for (const preset of PRESET_CATEGORIES) {
      expect(byName.get(preset.name)).toBe(preset.sortOrder);
    }
  });

  it('重复播种是幂等的（不会产生重名分类）', async () => {
    const again = await repo.seedPresetCategories();
    expect(again.seeded).toBe(0);
    expect(again.alreadySeeded).toBe(true);

    const categories = await listCategories();
    expect(categories).toHaveLength(PRESET_CATEGORIES.length + 1);
  });

  it('用户删掉内置分类后，重启不会被重新播种', async () => {
    const categories = await listCategories();
    const target = categories.find((c) => c.name === '影音娱乐');
    expect(target).toBeTruthy();

    const del = await api(base, `/api/v1/categories/${target.id}`, { method: 'DELETE', token });
    expect(del.status).toBe(200);

    // 模拟再次启动时的播种调用
    await repo.seedPresetCategories();

    const after = await listCategories();
    expect(after.map((c) => c.name)).not.toContain('影音娱乐');
  });
});

describe('GET /system/presets', () => {
  it('未携带令牌 → 401 TOKEN_MISSING', async () => {
    const res = await api(base, '/api/v1/system/presets');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_MISSING');
  });

  it('返回内置标签与分类模板', async () => {
    const res = await api(base, '/api/v1/system/presets', { token });
    expect(res.status).toBe(200);

    expect(res.body.data.tags).toEqual(PRESET_TAGS);
    expect(res.body.data.categories).toHaveLength(PRESET_CATEGORIES.length);
    expect(res.body.data.categories[0]).toMatchObject({
      name: PRESET_CATEGORIES[0].name,
      icon: PRESET_CATEGORIES[0].icon,
      sortOrder: PRESET_CATEGORIES[0].sortOrder,
    });
    // 模板本身不带 id，避免客户端误当成已存在的分类
    expect(res.body.data.categories[0].id).toBeUndefined();
  });

  it('标签都在条目标签的长度约束内（≤20 字符）', async () => {
    const res = await api(base, '/api/v1/system/presets', { token });
    for (const tag of res.body.data.tags) {
      expect(typeof tag).toBe('string');
      expect(tag.length).toBeGreaterThan(0);
      expect(tag.length).toBeLessThanOrEqual(20);
    }
  });
});
